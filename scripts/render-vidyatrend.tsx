// Run: npx tsx scripts/render-vidyatrend.tsx   (server-render smoke test of the panel + popup on synthetic candles)
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import type { Candle } from '../lib/binance'
import { resampleAligned } from '../lib/reversal'
import { buildVtRow, DEFAULT_VT_CONFIG, type VtRow } from '../lib/vidyatrend'
import { VidyaTrendPanel } from '../components/terminal/vidyatrend-panel'
import { VtPopups } from '../components/terminal/vt-popup'
import { DEFAULT_VT_SETTINGS, mergeVtLog, type VtApi } from '../hooks/use-vt'

function rng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 }
function make(n: number, endOpen: number, drift: (i: number) => number, seed: number): Candle[] {
  const r = rng(seed); const out: Candle[] = []; let p = 100
  for (let i = 0; i < n; i++) { const o = p; p = p * (1 + drift(i) + (r() - 0.5) * 0.004); out.push({ openTime: endOpen - (n - i) * 60000, open: o, high: Math.max(o, p) * 1.0006, low: Math.min(o, p) * 0.9994, close: p, volume: 100 + r() * 50 }) }
  return out
}
const N = 4200, TURN = N - 250, END = Date.UTC(2026, 9, 7) + N * 60000
const rows: VtRow[] = []
for (const [i, seed] of [9, 5, 7, 8, 10, 11].entries()) {
  const c = make(N, END, (k) => (i % 2 === 0 ? (k < TURN ? -0.0002 : 0.0006) : (k < TURN ? 0.0002 : -0.0006)), seed)
  const r = buildVtRow({ symbol: `C${seed}USDT`, price: c[N - 1].close, change24h: 1.2, k1: c.slice(-400), k3: resampleAligned(c, 3).slice(-300), k5: resampleAligned(c, 5).slice(-300), k15: resampleAligned(c, 15).slice(-300), now: END, config: DEFAULT_VT_CONFIG })
  if (r) rows.push(r)
}
const log = rows.flatMap((r) => r.log)
const m1 = mergeVtLog([], log, END)
const m2 = mergeVtLog(m1.merged, log.map((e) => ({ ...e, entry: e.entry !== undefined ? e.entry * 1.5 : undefined, time: e.time + 60000 })), END)
console.log('merge: first pass fresh =', m1.fresh.length, '| second pass fresh =', m2.fresh.length, '| entry frozen =', m2.merged.filter((e) => e.entry).every((e) => log.some((o) => o.id === e.id && o.entry === e.entry)))
const vt = { data: { rows, computedAt: END, live: true, source: 'test', config: DEFAULT_VT_CONFIG, windowHours: 5.7 }, rows, isLoading: false, isError: false, error: undefined, settings: DEFAULT_VT_SETTINGS, setSettings() {}, log: m1.merged, clearLog() {}, popups: [], dismissPopup() {}, permission: 'default', requestPermission: async () => {}, testAlert() {} } as unknown as VtApi
const html = renderToString(createElement(VidyaTrendPanel, { vt, onOpen() {} }))
console.log('panel html bytes', html.length, '| statuses:', rows.map((r) => r.status).join(' / '))
const conf = log.find((e) => e.kind === 'CONFIRMED')
const pop = renderToString(createElement(VtPopups, { popups: conf ? [conf] : [], onDismiss() {} }))
console.log('popup html bytes', pop.length, /Fully confirmed/.test(pop) ? 'has fields' : 'EMPTY')
if (!html.includes('Scanner') || (conf && !pop.includes('Risk / reward'))) process.exit(1)
