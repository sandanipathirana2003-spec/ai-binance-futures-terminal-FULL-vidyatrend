'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import type { ReversalResponse } from '@/lib/reversal'
import { DEFAULT_VT_CONFIG, type VtLogEntry, type VtRow } from '@/lib/vidyatrend'

export interface VtSettings {
  sl: '5m' | '3m'
  buf: number
  rr: number
  swing: boolean
  risk: number
  win: number
  popup: boolean
  sound: boolean
  notify: boolean
  earlyNotify: boolean
}

export const DEFAULT_VT_SETTINGS: VtSettings = {
  sl: DEFAULT_VT_CONFIG.slSource,
  buf: DEFAULT_VT_CONFIG.atrBuffer,
  rr: DEFAULT_VT_CONFIG.minRR,
  swing: DEFAULT_VT_CONFIG.slBeyondSwing,
  risk: DEFAULT_VT_CONFIG.maxRiskAtr,
  win: DEFAULT_VT_CONFIG.setupWindowMin,
  popup: true,
  sound: true,
  notify: true,
  earlyNotify: false,
}

const SETTINGS_KEY = 'vt-settings-v1'
const LOG_KEY = 'vt-log-v1'
const LOG_EVT = 'vt-log-changed'
const SET_EVT = 'vt-settings-changed'
const MAX_LOG = 1500
/** The engine only replays ~6h of 1M candles; an OPEN trade that is no longer reported after this long can't be resolved. */
const STALE_OPEN_MS = 8 * 3_600_000
const FRESH_ALERT_MS = 10 * 60_000
const SAME_SIGNAL_MS = 20 * 60_000

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown, evt: string) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full / blocked: the live data still works, only persistence is lost
  }
  window.dispatchEvent(new Event(evt))
}

const FROZEN_DONE = new Set(['TP', 'SL', 'INVALIDATED'])

/**
 * Merge freshly computed entries into the stored log.
 * A signal's time, entry, SL, TP and indicator snapshot are frozen the first time it is seen (never rewritten later);
 * only its lifecycle (status / outcome) can move forward. Returns the merged log and the entries seen for the first time.
 */
export function mergeVtLog(stored: VtLogEntry[], incoming: VtLogEntry[], now: number): { merged: VtLogEntry[]; fresh: VtLogEntry[] } {
  const byId = new Map(stored.map((e) => [e.id, e]))
  const fresh: VtLogEntry[] = []
  const seenIds = new Set<string>()
  for (const inc of incoming) {
    let ex = byId.get(inc.id)
    if (!ex) {
      // The same real event can shift by a bar when the candle window moves; treat near-identical signals as one.
      ex = stored.find((s) => s.symbol === inc.symbol && s.kind === inc.kind && s.side === inc.side && Math.abs(s.time - inc.time) <= SAME_SIGNAL_MS)
    }
    if (!ex) {
      byId.set(inc.id, inc)
      seenIds.add(inc.id)
      fresh.push(inc)
      continue
    }
    seenIds.add(ex.id)
    const final = ex.outcome && FROZEN_DONE.has(ex.outcome)
    byId.set(ex.id, {
      ...ex,
      status: final && inc.status === 'CONFIRMED' ? ex.status : inc.status,
      outcome: final ? ex.outcome : inc.outcome,
      outcomeTime: final ? ex.outcomeTime : inc.outcomeTime,
      exitPrice: final ? ex.exitPrice : inc.exitPrice,
      rNet: final ? ex.rNet : inc.rNet,
      weakenedAt: ex.weakenedAt ?? inc.weakenedAt,
      invalidatedAt: ex.invalidatedAt ?? inc.invalidatedAt,
      reason: final ? ex.reason : inc.reason,
    })
  }
  for (const [id, e] of byId) {
    if (!seenIds.has(id) && e.kind === 'CONFIRMED' && e.outcome === 'OPEN' && now - e.time > STALE_OPEN_MS) byId.set(id, { ...e, outcome: 'UNRESOLVED' })
  }
  const merged = [...byId.values()].sort((a, b) => b.time - a.time).slice(0, MAX_LOG)
  return { merged, fresh }
}

function chime(side: 'BUY' | 'SELL') {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const notes = side === 'BUY' ? [660, 880, 1100] : [880, 660, 440]
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      const t0 = ctx.currentTime + i * 0.16
      gain.gain.setValueAtTime(0.001, t0)
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.3)
    })
    setTimeout(() => void ctx.close(), 1200)
  } catch {
    // the browser may block audio until the page has had a tap/click; alerts still show
  }
}

const fetcher = async (url: string): Promise<ReversalResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load VIDYA trend data')
  return res.json()
}

export function useVt(enabled: boolean) {
  const [settings, setSettingsState] = useState<VtSettings>(DEFAULT_VT_SETTINGS)
  const [log, setLog] = useState<VtLogEntry[]>([])
  const [popups, setPopups] = useState<VtLogEntry[]>([])
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    setSettingsState({ ...DEFAULT_VT_SETTINGS, ...readJson<Partial<VtSettings>>(SETTINGS_KEY, {}) })
    setLog(readJson<VtLogEntry[]>(LOG_KEY, []))
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
    const syncLog = () => setLog(readJson<VtLogEntry[]>(LOG_KEY, []))
    const syncSet = () => setSettingsState({ ...DEFAULT_VT_SETTINGS, ...readJson<Partial<VtSettings>>(SETTINGS_KEY, {}) })
    window.addEventListener(LOG_EVT, syncLog)
    window.addEventListener(SET_EVT, syncSet)
    window.addEventListener('storage', syncLog)
    return () => {
      window.removeEventListener(LOG_EVT, syncLog)
      window.removeEventListener(SET_EVT, syncSet)
      window.removeEventListener('storage', syncLog)
    }
  }, [])

  const setSettings = useCallback((patch: Partial<VtSettings>) => {
    const next = { ...settingsRef.current, ...patch }
    setSettingsState(next)
    writeJson(SETTINGS_KEY, next, SET_EVT)
  }, [])

  const s = settings
  const url = `/api/reversal?vt=1&sl=${s.sl}&buf=${s.buf}&rr=${s.rr}&swing=${s.swing ? 1 : 0}&risk=${s.risk}&win=${s.win}`
  const { data, error, isLoading } = useSWR<ReversalResponse>(enabled ? url : null, fetcher, {
    refreshInterval: 20000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
  const vt = data?.vt
  const rows: VtRow[] = useMemo(() => vt?.rows ?? [], [vt])

  const notify = useCallback((e: VtLogEntry, early: boolean) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const coin = e.symbol.replace('USDT', '')
    try {
      new Notification(early ? `${coin} · EARLY ${e.side} (not confirmed)` : `${coin} · ${e.side} confirmed`, {
        body: early ? e.reason : `Entry ${e.entry} · SL ${e.sl?.toPrecision(6)} · TP ${e.tp?.toPrecision(6)} · RR 1:${e.rr?.toFixed(2)}`,
        tag: e.id,
      })
    } catch {
      // some mobile browsers only allow notifications from a service worker
    }
  }, [])

  // Merge each refresh into the persistent log and raise alerts for brand-new, fresh signals only.
  useEffect(() => {
    if (!vt || !vt.live) return
    const incoming = rows.flatMap((r) => r.log)
    const { merged, fresh } = mergeVtLog(readJson<VtLogEntry[]>(LOG_KEY, []), incoming, vt.computedAt)
    writeJson(LOG_KEY, merged, LOG_EVT)
    const cfg = settingsRef.current
    const recent = fresh.filter((e) => vt.computedAt - e.time <= FRESH_ALERT_MS)
    const confirmed = recent.filter((e) => e.kind === 'CONFIRMED')
    if (confirmed.length) {
      if (cfg.popup) setPopups((p) => [...confirmed, ...p].slice(0, 8))
      if (cfg.sound) chime(confirmed[0].side)
      if (cfg.notify) confirmed.forEach((e) => notify(e, false))
    }
    if (cfg.earlyNotify && cfg.notify) recent.filter((e) => e.kind === 'EARLY').forEach((e) => notify(e, true))
  }, [vt, rows, notify])

  const dismissPopup = useCallback((id: string) => setPopups((p) => p.filter((x) => x.id !== id)), [])
  const clearLog = useCallback(() => writeJson(LOG_KEY, [], LOG_EVT), [])
  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }, [])
  const testAlert = useCallback(() => {
    const now = Date.now()
    const demo = {
      id: `demo-${now}`,
      symbol: 'DEMOUSDT',
      side: 'BUY',
      kind: 'CONFIRMED',
      status: 'CONFIRMED',
      time: now,
      afterCandleClose: true,
      triggerTf: '5M',
      label: 'TEST ALERT — NOT A MARKET SIGNAL',
      reason: 'This is only a test of your popup / sound / notification settings. The prices are placeholders, not market data.',
      vidya: { '1m': 'NEUTRAL', '3m': 'NEUTRAL', '5m': 'NEUTRAL', '15m': 'NEUTRAL' },
      ma: {},
      trend15: 'MIXED',
      tags: ['TEST'],
    } as unknown as VtLogEntry
    if (settingsRef.current.popup) setPopups((p) => [demo, ...p].slice(0, 8))
    if (settingsRef.current.sound) chime('BUY')
  }, [])

  return {
    data: vt,
    rows,
    isLoading,
    isError: Boolean(error),
    error: data && !data.live ? data.error : undefined,
    settings,
    setSettings,
    log,
    clearLog,
    popups,
    dismissPopup,
    permission,
    requestPermission,
    testAlert,
  }
}

export type VtApi = ReturnType<typeof useVt>
