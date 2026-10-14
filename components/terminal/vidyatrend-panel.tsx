'use client'

import { useEffect, useMemo, useState } from 'react'
import { BellRing, ChevronDown, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPct, formatPrice } from '@/lib/format'
import type { VtApi } from '@/hooks/use-vt'
import { VT_PAIRS, VT_TFS, VT_TF_LABEL, vtStats, type VtLogEntry, type VtRow, type VtStatus, type VtTf, type VtTfSnap } from '@/lib/vidyatrend'
import { fmtLevel, fmtTime } from './vt-popup'

const PAGE = 20
type Sub = 'scanner' | 'log' | 'settings'
type Filter = 'ALL' | 'CONFIRMED' | 'EARLY' | 'FAKE' | 'INVALID'
type SortKey = 'STRENGTH' | 'NEWEST' | 'NAME'

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const isActive = (r: VtRow) => r.status === 'FULL BULLISH ALIGNMENT' || r.status === 'FULL BEARISH ALIGNMENT' || r.status === 'SIGNAL WEAKENED'
const isEarly = (r: VtRow) =>
  r.status === 'EARLY REVERSAL — NOT CONFIRMED' || r.status === '3M SETUP CONFIRMED' || r.status === 'WAITING FOR 5M CONFIRMATION' || r.status.startsWith('WAITING FOR VALID')

function statusCls(r: VtRow): string {
  const buy = r.side === 'BUY'
  if (isActive(r) && r.status !== 'SIGNAL WEAKENED') return buy ? 'border-bull bg-bull text-bull-foreground' : 'border-bear bg-bear text-bear-foreground'
  if (r.status === 'SIGNAL WEAKENED' || r.status === 'POSSIBLE FAKE REVERSAL') return 'border-warn/50 bg-warn/10 text-warn'
  if (isEarly(r)) return buy ? 'border-bull/40 bg-bull/10 text-bull' : 'border-bear/40 bg-bear/10 text-bear'
  if (r.status === 'SIGNAL INVALIDATED') return 'border-bear/40 bg-bear/10 text-bear'
  return 'border-border bg-muted text-muted-foreground'
}

const dirCls = (d: string) => (d === 'BULLISH' || d === 'BULL' ? 'border-bull/30 bg-bull/15 text-bull' : d === 'BEARISH' || d === 'BEAR' ? 'border-bear/30 bg-bear/15 text-bear' : 'border-border bg-muted text-muted-foreground')
const arrow = (d: string) => (d === 'BULLISH' ? '▲' : d === 'BEARISH' ? '▼' : '•')

function Chip({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold', cls)}>
      {children}
    </span>
  )
}

const TF_MIN: Record<VtTf, number> = { '1m': 1, '3m': 3, '5m': 5, '15m': 15 }

function TfLine({ t }: { t: VtTfSnap }) {
  const since = t.barsSinceFlip >= 0 ? `${t.barsSinceFlip * TF_MIN[t.tf]}m` : '>history'
  return (
    <div className="flex flex-wrap items-center gap-1 py-1.5">
      <span className="w-8 shrink-0 font-mono text-sm font-bold">{VT_TF_LABEL[t.tf]}</span>
      <Chip cls={dirCls(t.dir)} title="Volumatic VIDYA 14 / 9 / 1.5 on the last CLOSED candle">
        {arrow(t.dir)} {t.dir}
      </Chip>
      <Chip cls={t.lifecycle === 'NEW' ? 'border-primary/40 bg-primary/15 text-primary' : t.lifecycle === 'WEAKENING' ? 'border-warn/40 bg-warn/10 text-warn' : t.lifecycle === 'INVALIDATED' ? 'border-bear/40 bg-bear/10 text-bear' : 'border-border bg-muted text-muted-foreground'}>
        {t.lifecycle}
      </Chip>
      <Chip cls="border-border bg-muted text-muted-foreground" title="Closed bars since the VIDYA direction changed">
        flip {since} ago
      </Chip>
      <Chip cls="border-border bg-muted text-muted-foreground" title="Close vs the VIDYA flip bands">
        {t.priceVs}
      </Chip>
      <Chip cls={dirCls(t.momentum)} title="Chande momentum, 9 closes">
        MOM {t.cmoPct > 0 ? '+' : ''}
        {t.cmoPct.toFixed(0)}%
      </Chip>
    </div>
  )
}

function CrossTable({ t }: { t: VtTfSnap }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full table-fixed text-left font-mono text-[10px]">
        <thead className="bg-secondary/40 text-muted-foreground uppercase">
          <tr>
            <th className="w-[19%] px-1.5 py-1">Pair</th>
            <th className="w-[15%] px-1 py-1">Dir</th>
            <th className="w-[20%] px-1 py-1">Cross</th>
            <th className="w-[18%] px-1 py-1">Status</th>
            <th className="w-[14%] px-1 py-1">VIDYA</th>
            <th className="w-[14%] px-1 py-1">Price</th>
          </tr>
        </thead>
        <tbody>
          {t.crosses.map((c) => (
            <tr key={c.pair} className="border-border/60 border-t">
              <td className="px-1.5 py-1 font-bold">
                {c.pair}
                {c.zone ? <span className="text-muted-foreground block text-[9px] font-normal">{c.zone}</span> : null}
              </td>
              <td className={cn('px-1 py-1 font-bold', c.state === 'BULL' ? 'text-bull' : 'text-bear')}>{c.state}</td>
              <td className="px-1 py-1">
                {c.barsAgo >= 0 ? (
                  <>
                    {c.barsAgo * TF_MIN[t.tf]}m ago
                    <span className="text-muted-foreground block text-[9px]">{fmtTime(c.time ?? undefined).slice(-8)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">none in data</span>
                )}
              </td>
              <td className="px-1 py-1">{c.status === 'NONE' ? '—' : c.status === 'CONFIRMED' ? 'Confirmed' : 'Developing'}</td>
              <td className={cn('px-1 py-1 font-bold', c.vidyaAgrees ? 'text-bull' : 'text-muted-foreground')}>{c.vidyaAgrees ? 'agrees' : 'no'}</td>
              <td className={cn('px-1 py-1 font-bold', c.priceConfirms ? 'text-bull' : 'text-muted-foreground')}>{c.priceConfirms ? 'beyond' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!t.sufficientData ? <p className="text-muted-foreground border-t px-1.5 py-1 text-[9px]">Fewer than 200 closed {VT_TF_LABEL[t.tf]} bars: EMA 100/200 are still warming up.</p> : null}
    </div>
  )
}

function Levels({ e, openR, price }: { e: VtLogEntry; openR: number | null; price: number }) {
  const buy = e.side === 'BUY'
  return (
    <div className="bg-secondary/40 rounded-lg border p-2">
      <div className="grid grid-cols-4 gap-1 text-center font-mono">
        <div>
          <div className="text-muted-foreground text-[9px] uppercase">Entry</div>
          <div className="text-xs font-bold">{fmtLevel(e.entry)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[9px] uppercase">SL</div>
          <div className="text-bear text-xs font-bold">{fmtLevel(e.sl)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[9px] uppercase">TP</div>
          <div className="text-bull text-xs font-bold">{fmtLevel(e.tp)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[9px] uppercase">R:R</div>
          <div className="text-xs font-bold">1:{e.rr?.toFixed(2)}</div>
        </div>
      </div>
      <div className="text-muted-foreground mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono text-[10px]">
        <span>SL: {e.slSource}</span>
        <span>
          1.5R {fmtLevel(e.tp15)} · 2R {fmtLevel(e.tp20)}
        </span>
        <span>
          {buy ? 'Long' : 'Short'} · closed {fmtTime(e.time)} · trigger {e.triggerTf}
          {e.oneMinConfirmed ? ' · 1M timing ✓' : ' · 1M timing ✗'}
        </span>
        {openR !== null ? (
          <span className={cn('font-bold', openR >= 0 ? 'text-bull' : 'text-bear')}>
            Open {openR >= 0 ? '+' : ''}
            {openR.toFixed(2)}R @ {fmtLevel(price)} (before fees)
          </span>
        ) : null}
      </div>
    </div>
  )
}

function VtCard({ row, now, onOpen }: { row: VtRow; now: number; onOpen: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const [dtf, setDtf] = useState<VtTf>('5m')
  const active = row.active && (row.active.status === 'CONFIRMED' || row.active.status === 'WEAKENED') ? row.active : null
  return (
    <article className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-xl border p-3">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-base font-bold">
          {row.symbol.replace('USDT', '')}
          <span className="text-muted-foreground text-xs font-normal">/USDT</span>
        </h3>
        <span className="font-mono text-xs">
          ${formatPrice(row.price)} <span className={row.change24h >= 0 ? 'text-bull' : 'text-bear'}>{formatPct(row.change24h)}</span>
        </span>
      </header>

      <div className={cn('rounded-lg border px-3 py-2.5 text-center', statusCls(row))}>
        <div className="text-lg font-extrabold leading-tight tracking-wide sm:text-xl">{row.status}</div>
        <div className="mt-1 font-mono text-[11px] font-semibold uppercase leading-snug opacity-90">{row.headline}</div>
        {row.setupWindowLeftMin !== null ? <div className="mt-0.5 font-mono text-[10px] opacity-80">setup window: {row.setupWindowLeftMin} min left</div> : null}
      </div>
      <p className="text-muted-foreground font-mono text-[11px] leading-snug">{row.reason}</p>

      {active ? <Levels e={active} openR={row.activeOpenR} price={row.price} /> : null}

      <div className="divide-border/60 divide-y">
        {VT_TFS.map((tf) => (
          <TfLine key={tf} t={row.tfs[tf]} />
        ))}
      </div>
      <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px]">
        <span>
          15M trend:{' '}
          <b className={row.trend15 === 'BULLISH' ? 'text-bull' : row.trend15 === 'BEARISH' ? 'text-bear' : ''}>{row.trend15}</b>
        </span>
        <span>candle closed {ago(now - row.asOf)} ago</span>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} className="border-border text-muted-foreground active:bg-accent/40 flex h-11 w-full items-center justify-center gap-1.5 rounded-md border text-xs font-semibold">
        EMA ribbon &amp; crossovers
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-1.5">
            {VT_TFS.map((tf) => (
              <button key={tf} type="button" onClick={() => setDtf(tf)} className={cn('h-9 rounded-md border font-mono text-xs font-bold', dtf === tf ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
                {VT_TF_LABEL[tf]}
              </button>
            ))}
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px]">
            {([9, 20, 21, 50, 100, 200] as const).map((p) => (
              <span key={p}>
                EMA{p} <b className="text-foreground">{fmtLevel(row.tfs[dtf].emas[p])}</b>
              </span>
            ))}
            <span>
              VIDYA <b className="text-foreground">{fmtLevel(row.tfs[dtf].vidyaLine)}</b>
            </span>
            <span>
              boundary <b className="text-foreground">{fmtLevel(row.tfs[dtf].boundary)}</b>
            </span>
          </div>
          <CrossTable t={row.tfs[dtf]} />
        </div>
      ) : null}

      <button type="button" onClick={() => onOpen(row.symbol)} className="border-border text-muted-foreground active:bg-accent/40 h-11 w-full rounded-md border text-xs font-semibold">
        Open {row.symbol.replace('USDT', '')} in Terminal
      </button>
    </article>
  )
}

// ----------------------------------------------------------------------------- scanner

function Scanner({ vt, onOpen, now }: { vt: VtApi; onOpen: (s: string) => void; now: number }) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [sort, setSort] = useState<SortKey>('STRENGTH')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [filter, sort, query])

  const rows = vt.rows
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((r) => r.symbol.toLowerCase().includes(q)) : rows
  }, [rows, query])
  const counts = useMemo(
    () => ({
      ALL: searched.length,
      CONFIRMED: searched.filter(isActive).length,
      EARLY: searched.filter(isEarly).length,
      FAKE: searched.filter((r) => r.status === 'POSSIBLE FAKE REVERSAL').length,
      INVALID: searched.filter((r) => r.status === 'SIGNAL INVALIDATED').length,
    }),
    [searched],
  )
  const sorted = useMemo(() => {
    const list = searched.filter((r) =>
      filter === 'ALL' ? true : filter === 'CONFIRMED' ? isActive(r) : filter === 'EARLY' ? isEarly(r) : filter === 'FAKE' ? r.status === 'POSSIBLE FAKE REVERSAL' : r.status === 'SIGNAL INVALIDATED',
    )
    return [...list].sort((a, b) => {
      if (sort === 'NAME') return a.symbol.localeCompare(b.symbol)
      if (sort === 'NEWEST') return (b.log[0]?.time ?? 0) - (a.log[0]?.time ?? 0) || b.rank - a.rank
      return b.rank - a.rank || a.symbol.localeCompare(b.symbol)
    })
  }, [searched, filter, sort])
  const visible = sorted.slice(0, limit)

  const FILTERS: Array<{ key: Filter; label: string; cls: string }> = [
    { key: 'ALL', label: 'All', cls: 'border-primary/40 bg-primary/10 text-primary' },
    { key: 'CONFIRMED', label: 'Confirmed', cls: 'border-bull/40 bg-bull/15 text-bull' },
    { key: 'EARLY', label: 'Early', cls: 'border-warn/40 bg-warn/15 text-warn' },
    { key: 'FAKE', label: 'Fake?', cls: 'border-warn/40 bg-warn/15 text-warn' },
    { key: 'INVALID', label: 'Invalid', cls: 'border-bear/40 bg-bear/15 text-bear' },
  ]
  const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'STRENGTH', label: 'Strength' },
    { key: 'NEWEST', label: 'Newest' },
    { key: 'NAME', label: 'A–Z' },
  ]

  return (
    <>
      <div className="grid grid-cols-5 gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={cn('flex h-14 flex-col items-center justify-center rounded-md border font-mono transition-colors', filter === f.key ? f.cls : 'border-border text-muted-foreground')}>
            <span className="text-[10px] font-semibold uppercase">{f.label}</span>
            <span className="text-base font-bold">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search coins…" inputMode="search" autoCapitalize="characters" className="border-border bg-secondary/50 focus:ring-ring h-11 w-full rounded-md border pl-9 pr-3 text-base outline-none focus:ring-2 sm:text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:w-72">
          {SORTS.map((s) => (
            <button key={s.key} type="button" onClick={() => setSort(s.key)} className={cn('h-11 rounded-md border font-mono text-xs font-bold transition-colors', sort === s.key ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {vt.isLoading && rows.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center font-mono text-sm">Loading 1M / 3M / 5M / 15M candles…</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center font-mono text-sm">{rows.length === 0 ? 'Waiting for market data…' : 'No coins match these filters.'}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((r) => (
              <VtCard key={r.symbol} row={r} now={now} onOpen={onOpen} />
            ))}
          </div>
          {sorted.length > visible.length ? (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="border-border bg-card h-12 w-full rounded-md border font-mono text-xs font-bold">
              Show {Math.min(PAGE, sorted.length - visible.length)} more ({sorted.length - visible.length} left)
            </button>
          ) : null}
        </>
      )}
    </>
  )
}

// ----------------------------------------------------------------------------- log + backtest

type StatusF = 'ALL' | 'EARLY' | 'CONFIRMED' | 'INVALIDATED' | 'REJECTED'
const TAG_FILTERS: Array<{ key: string; label: string; test: (e: VtLogEntry) => boolean }> = [
  { key: 'vidya', label: 'VIDYA-only', test: (e) => e.tags.includes('VIDYA') && !e.tags.includes('COMBINED') },
  { key: '921', label: 'EMA 9/21', test: (e) => e.tags.includes('EMA 9/21') },
  { key: '2150', label: 'EMA 21/50', test: (e) => e.tags.includes('EMA 21/50') },
  { key: '2050', label: 'EMA 20/50', test: (e) => e.tags.includes('EMA 20/50') },
  { key: 'comb', label: 'VIDYA + MA', test: (e) => e.tags.includes('COMBINED') },
  { key: 'full', label: 'Full 3M+5M', test: (e) => e.tags.includes('FULL 3M+5M') },
  { key: '15m', label: '15M aligned', test: (e) => e.tags.includes('15M ALIGNED') },
  { key: 'sl3', label: '3M SL', test: (e) => e.tags.includes('SL 3M') },
  { key: 'sl5', label: '5M SL', test: (e) => e.tags.includes('SL 5M') },
]

function statusOf(e: VtLogEntry): StatusF {
  if (e.kind === 'EARLY') return 'EARLY'
  if (e.kind === 'REJECTED') return 'REJECTED'
  return e.status === 'INVALIDATED' || e.outcome === 'INVALIDATED' ? 'INVALIDATED' : 'CONFIRMED'
}

function outcomeLabel(e: VtLogEntry): { text: string; cls: string } {
  if (e.kind !== 'CONFIRMED') return { text: e.kind === 'EARLY' ? 'warning only' : 'no entry', cls: 'text-muted-foreground' }
  if (e.outcome === 'TP') return { text: `TP hit ${e.rNet !== undefined ? (e.rNet >= 0 ? '+' : '') + e.rNet.toFixed(2) + 'R' : ''}`, cls: 'text-bull' }
  if (e.outcome === 'SL') return { text: `SL hit ${e.rNet !== undefined ? e.rNet.toFixed(2) + 'R' : ''}`, cls: 'text-bear' }
  if (e.outcome === 'INVALIDATED') return { text: `exit on invalidation ${e.rNet !== undefined ? (e.rNet >= 0 ? '+' : '') + e.rNet.toFixed(2) + 'R' : ''}`, cls: (e.rNet ?? 0) >= 0 ? 'text-bull' : 'text-bear' }
  if (e.outcome === 'UNRESOLVED') return { text: 'unresolved (left data window)', cls: 'text-muted-foreground' }
  return { text: e.status === 'WEAKENED' ? 'open · weakened' : 'open', cls: 'text-warn' }
}

function LogRow({ e }: { e: VtLogEntry }) {
  const [open, setOpen] = useState(false)
  const buy = e.side === 'BUY'
  const oc = outcomeLabel(e)
  return (
    <li className="border-border bg-card rounded-lg border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left">
        <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] font-extrabold', buy ? 'border-bull/40 bg-bull/15 text-bull' : 'border-bear/40 bg-bear/15 text-bear')}>{e.side}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm font-bold">
            {e.symbol.replace('USDT', '')} <span className="text-muted-foreground text-[10px] font-normal">{statusOf(e)}</span>
          </span>
          <span className="text-muted-foreground block font-mono text-[10px]">{fmtTime(e.time)}</span>
        </span>
        <span className={cn('shrink-0 text-right font-mono text-[10px] font-bold', oc.cls)}>{oc.text}</span>
        <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="border-border/60 flex flex-col gap-1.5 border-t px-3 py-2 font-mono text-[11px]">
          <div className="font-semibold">{e.label}</div>
          <div className="text-muted-foreground leading-snug">{e.reason}</div>
          {e.entry ? (
            <div>
              Entry {fmtLevel(e.entry)} · SL {fmtLevel(e.sl)} ({e.slSource}) · TP {fmtLevel(e.tp)} · RR 1:{e.rr?.toFixed(2)}
            </div>
          ) : null}
          <div>
            VIDYA {VT_TFS.map((tf) => `${VT_TF_LABEL[tf]} ${e.vidya[tf].slice(0, 4)}`).join(' · ')} · 15M trend {e.trend15}
          </div>
          <div className="flex flex-wrap gap-x-3">
            {(['3m', '5m'] as const).map((tf) => (
              <span key={tf}>
                {VT_TF_LABEL[tf]}: {VT_PAIRS.map((p) => `${p} ${e.ma[tf][p]?.[0] ?? '?'}`).join(' ')}
              </span>
            ))}
          </div>
          <div>
            Trigger {e.triggerTf} · after candle close · {e.crossTf ? `latest cross ${e.crossTf} ${e.crossPair} @ ${fmtTime(e.crossTime)}` : 'no recent 20/50 cross (structure already confirmed)'}
          </div>
          {e.outcomeTime ? (
            <div>
              Outcome @ {fmtTime(e.outcomeTime)} · exit {fmtLevel(e.exitPrice)}
            </div>
          ) : null}
          <div className="text-muted-foreground">{e.tags.join(' · ')}</div>
        </div>
      ) : null}
    </li>
  )
}

function LogTab({ vt }: { vt: VtApi }) {
  const [status, setStatus] = useState<StatusF>('ALL')
  const [tags, setTags] = useState<string[]>([])
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [status, tags])
  const filtered = useMemo(() => {
    const tests = TAG_FILTERS.filter((t) => tags.includes(t.key))
    return vt.log.filter((e) => (status === 'ALL' || statusOf(e) === status) && tests.every((t) => t.test(e)))
  }, [vt.log, status, tags])
  const stats = useMemo(() => vtStats(filtered), [filtered])
  const STATUS: StatusF[] = ['ALL', 'EARLY', 'CONFIRMED', 'INVALIDATED', 'REJECTED']

  const tile = (k: string, v: string, cls = '') => (
    <div className="border-border bg-card rounded-lg border p-2 text-center">
      <div className="text-muted-foreground font-mono text-[9px] uppercase">{k}</div>
      <div className={cn('font-mono text-base font-bold', cls)}>{v}</div>
    </div>
  )
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {tile('Tested trades', String(stats.trades))}
        {tile('Win rate', stats.trades ? `${stats.winRate.toFixed(0)}%` : '—')}
        {tile('Avg planned R:R', stats.trades ? `1:${stats.avgPlannedRR.toFixed(2)}` : '—')}
        {tile('Expectancy', stats.trades ? `${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)}R` : '—', stats.expectancy >= 0 ? 'text-bull' : 'text-bear')}
        {tile('Max drawdown', stats.trades ? `${stats.maxDrawdownR.toFixed(2)}R` : '—')}
        {tile('Open now', String(stats.open))}
      </div>
      {stats.trades > 0 && stats.trades < 30 ? <p className="text-warn font-mono text-[11px]">Only {stats.trades} resolved trades: too few to say anything reliable about win rate or expectancy.</p> : null}

      <div className="grid grid-cols-5 gap-1.5">
        {STATUS.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn('h-10 rounded-md border font-mono text-[10px] font-bold uppercase', status === s ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
            {s === 'INVALIDATED' ? 'Invalid' : s === 'CONFIRMED' ? 'Confirm' : s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TAG_FILTERS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTags((c) => (c.includes(t.key) ? c.filter((x) => x !== t.key) : [...c, t.key]))} className={cn('h-9 rounded-full border px-3 font-mono text-[11px] font-bold', tags.includes(t.key) ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center font-mono text-sm">{vt.log.length === 0 ? 'No signals logged yet.' : 'Nothing matches these filters.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.slice(0, limit).map((e) => (
            <LogRow key={e.id} e={e} />
          ))}
        </ul>
      )}
      {filtered.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="border-border bg-card h-12 w-full rounded-md border font-mono text-xs font-bold">
          Show {Math.min(PAGE, filtered.length - limit)} more
        </button>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Delete the saved VIDYA Trend log from this browser?')) vt.clearLog()
          }}
          className="text-muted-foreground flex h-10 items-center gap-1.5 rounded-md px-3 font-mono text-[11px]"
        >
          <Trash2 className="size-3.5" /> Clear saved log
        </button>
      </div>
      <p className="text-muted-foreground px-1 text-[10px] leading-relaxed">
        <b>How these numbers are made.</b> Every bar of the loaded history (about {vt.data?.windowHours ?? 6} hours of 1M candles per coin) is replayed with the same rules, seeing only candles that had already closed. Entry = close of the trigger 1M candle. Stop and target are checked on the following 1M candles; if both are touched in one candle the stop is assumed first.
        An open trade is closed at the candle close when 3M/5M VIDYA or 20/50 turns against it. Costs: {vt.data?.config.feePct ?? 0.05}% fee + {vt.data?.config.slippagePct ?? 0.02}% slippage per side, charged in R. Win rate / expectancy / drawdown count only resolved trades.
        The log is saved in this browser and keeps growing; a signal&apos;s time, entry, SL and TP are frozen when first seen. A short window and few trades mean a small sample, so none of this predicts future results.
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- settings

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="border-border flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? <span className="text-muted-foreground block text-[11px] leading-snug">{hint}</span> : null}
      </span>
      <span className={cn('flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors', on ? 'bg-primary' : 'bg-muted')}>
        <span className={cn('bg-background size-5 rounded-full transition-transform', on && 'translate-x-5')} />
      </span>
    </button>
  )
}

function NumField({ label, hint, value, min, max, step, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground block text-[11px] leading-snug">{hint}</span>
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="border-border bg-secondary/50 h-11 w-24 shrink-0 rounded-md border px-2 text-right font-mono text-base outline-none"
      />
    </label>
  )
}

function SettingsTab({ vt }: { vt: VtApi }) {
  const { settings: s, setSettings } = vt
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Stop-loss &amp; target</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {(['5m', '3m'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setSettings({ sl: k })} className={cn('h-12 rounded-md border font-mono text-xs font-bold', s.sl === k ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
            SL from {k.toUpperCase()} VIDYA boundary{k === '5m' ? ' (default)' : ''}
          </button>
        ))}
      </div>
      <NumField label="ATR buffer" hint="× ATR(14) of 5M added beyond the stop level" value={s.buf} min={0} max={3} step={0.05} onChange={(v) => setSettings({ buf: v })} />
      <NumField label="Minimum reward : risk" hint="to the first 5M structure target; below this no entry is confirmed" value={s.rr} min={0.5} max={5} step={0.1} onChange={(v) => setSettings({ rr: v })} />
      <NumField label="Widest stop (× ATR 5M)" hint="a wider stop is treated as unsuitable and the fallback is tried" value={s.risk} min={1} max={20} step={0.5} onChange={(v) => setSettings({ risk: v })} />
      <NumField label="Setup window (minutes)" hint="how long a 3M/5M VIDYA trend start may wait for the full alignment" value={s.win} min={15} max={360} step={5} onChange={(v) => setSettings({ win: v })} />
      <Toggle on={s.swing} onChange={(v) => setSettings({ swing: v })} label="Place stop beyond the 5M swing" hint="if the latest confirmed 5M swing low/high is further away than the VIDYA boundary" />

      <h3 className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
        <BellRing className="size-4" /> Alerts
      </h3>
      <Toggle on={s.popup} onChange={(v) => setSettings({ popup: v })} label="Popup on confirmed signal" />
      <Toggle on={s.sound} onChange={(v) => setSettings({ sound: v })} label="Sound" hint="Rising tones for BUY, falling for SELL. Browsers only allow sound after you have tapped the page once." />
      <Toggle on={s.notify} onChange={(v) => setSettings({ notify: v })} label="Browser notification on confirmed signal" />
      <Toggle on={s.earlyNotify} onChange={(v) => setSettings({ earlyNotify: v })} label="Notify on EARLY warnings too" hint="Early warnings are never confirmed entries." />
      <div className="flex gap-2">
        <button type="button" onClick={vt.requestPermission} disabled={vt.permission === 'granted' || vt.permission === 'unsupported'} className="border-border bg-secondary h-11 flex-1 rounded-md border text-sm font-semibold disabled:opacity-60">
          {vt.permission === 'granted' ? 'Notifications allowed' : vt.permission === 'denied' ? 'Blocked in browser settings' : vt.permission === 'unsupported' ? 'Not supported here' : 'Allow notifications'}
        </button>
        <button type="button" onClick={vt.testAlert} className="border-border bg-secondary h-11 flex-1 rounded-md border text-sm font-semibold">
          Test popup + sound
        </button>
      </div>
      <p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
        Alerts fire while this page is open (the market feed refreshes every ~20 s and signals are evaluated on closed candles). True background push to a phone with the app closed needs a push server and subscription keys that this project does not have, so it is not claimed here. On iPhone, browser notifications only work once the site is added to the Home Screen.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------------------- panel

export function VidyaTrendPanel({ vt, onOpen }: { vt: VtApi; onOpen: (symbol: string) => void }) {
  const [sub, setSub] = useState<Sub>('scanner')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  const d = vt.data
  const SUBS: Array<{ key: Sub; label: string }> = [
    { key: 'scanner', label: 'Scanner' },
    { key: 'log', label: `Log (${vt.log.length})` },
    { key: 'settings', label: 'Settings' },
  ]
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3">
      <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="size-4" /> VIDYA Trend · 3M start → 5M confirm → 15M context · 1M timing
          </h2>
          <p className="text-muted-foreground mt-0.5 font-mono text-[11px] leading-relaxed">
            Volumatic VIDYA 14 · 9 · 1.5 | EMA 9 · 20 · 21 · 50 · 100 · 200 | closed candles only
            {d ? ` | ${d.source} | updated ${ago(now - d.computedAt)} ago` : ''}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {SUBS.map((s) => (
            <button key={s.key} type="button" onClick={() => setSub(s.key)} className={cn('h-11 rounded-md border font-mono text-xs font-bold transition-colors', sub === s.key ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {vt.error || (vt.isError && !d) ? (
        <div className="border-bear/30 bg-bear/10 text-bear rounded-md border px-3 py-2 text-center font-mono text-xs">
          Binance data is unavailable ({vt.error ?? 'request failed'}). Nothing fake is shown — retrying automatically.
        </div>
      ) : null}

      {sub === 'scanner' ? <Scanner vt={vt} onOpen={onOpen} now={now} /> : sub === 'log' ? <LogTab vt={vt} /> : <SettingsTab vt={vt} />}

      {sub === 'scanner' ? (
        <p className="text-muted-foreground px-1 text-[10px] leading-relaxed">
          <b>Sequence:</b> 3M VIDYA turns → 3M EMA 20/50 (+9/21, 21/50 support, price beyond VIDYA line and EMA 21) = <b>EARLY, not a trade</b> → 5M VIDYA agrees → 5M EMA 20/50 and price confirm → 15M not strongly opposing → a valid VIDYA-boundary stop and a 5M-structure target with the minimum reward:risk → <b>one</b> confirmed entry. 1M only labels the entry as timed or not; it never overrides a 3M/5M disagreement.
          The 15M trend adds EMA 20/50, 50/100 and 100/200 to the VIDYA direction and only blocks when it is strongly against the trade. A new setup needs a fresh 3M (or 5M) VIDYA trend start. Stops use the VIDYA lower band (buys) / upper band (sells) as the trend boundary, plus an ATR buffer. Nothing here is guaranteed; a filter lowers noise, it does not remove losses.
          {d && d.rows.some((r) => r.warmup) ? ' EMA 200 on 5M needs ~17 hours of closed candles; some coins still have less, so their slow EMAs are approximate.' : ''}
        </p>
      ) : null}
    </div>
  )
}
