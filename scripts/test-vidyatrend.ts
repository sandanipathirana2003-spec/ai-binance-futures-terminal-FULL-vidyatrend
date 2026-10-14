// Run: npx tsx scripts/test-vidyatrend.ts
import type { Candle } from '../lib/binance'
import { resampleAligned } from '../lib/reversal'
import { buildVtRow, vtStats, type VtLogEntry, type VtRow } from '../lib/vidyatrend'

function rng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 }
function make(n: number, endOpen: number, drift: (i: number) => number, seed = 1, noise = 0.0016): Candle[] {
  const r = rng(seed); const out: Candle[] = []; let p = 100
  for (let i = 0; i < n; i++) {
    const o = p; p = Math.max(1, p * (1 + drift(i) + (r() - 0.5) * noise))
    out.push({ openTime: endOpen - (n - i) * 60000, open: o, high: Math.max(o, p) * 1.0006, low: Math.min(o, p) * 0.9994, close: p, volume: 100 + r() * 50 })
  }
  return out
}
function row(all: Candle[], end: number): VtRow | null {
  const m = all.slice(0, end)
  const now = m[m.length - 1].openTime + 60000
  return buildVtRow({ symbol: 'T', price: m[m.length - 1].close, change24h: 0, k1: m.slice(-400), k3: resampleAligned(m, 3).slice(-300), k5: resampleAligned(m, 5).slice(-300), k15: resampleAligned(m, 15).slice(-300), now })
}
let fails = 0
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const START = Date.UTC(2026, 9, 7, 0, 0)
const N = 4200, TURN = N - 250   // the 1M window is 400 bars, so the turn must sit inside it; 15M gets ~280 bars of history
const scen = (name: string, drift: (i: number) => number, seed: number, noise: number) => {
  const c = make(N, START + N * 60000, drift, seed, noise)
  const r = row(c, N)!
  console.log(`== ${name}: status=${r.status} | ${r.headline} | log=${r.log.map((e) => e.kind + ':' + e.side + (e.outcome ? '/' + e.outcome : '')).join(', ')}`)
  return { c, r }
}

// 1) bullish reversal out of a mild downtrend (several seeds: at least one must confirm; none may break the rules)
const NOISE = 0.004
const upRuns = [5, 7, 8, 9, 10, 11, 12, 13].map((sd) => scen(`BULLISH reversal seed ${sd}`, (i) => (i < TURN ? -0.0002 : 0.0006), sd, NOISE))
const upC = upRuns.flatMap((x) => x.r.log.filter((e) => e.kind === 'CONFIRMED'))
ok(upC.length >= 1 && upC.every((e) => e.side === 'BUY'), `BUY: confirmed BUY signals appear and are all BUY (${upC.length} over ${upRuns.length} seeds)`)
ok(upRuns.every((x) => new Set(x.r.log.map((e) => e.id)).size === x.r.log.length && x.r.log.filter((e) => e.kind === 'CONFIRMED').length <= 1), 'BUY: at most ONE confirmed alert per setup, no duplicate ids')
const up = upRuns.find((x) => x.r.log.some((e) => e.kind === 'CONFIRMED')) ?? upRuns[0]
// 2) bearish mirror
const dnRuns = [5, 7, 8, 9, 10, 11, 12, 13].map((sd) => scen(`BEARISH reversal seed ${sd}`, (i) => (i < TURN ? 0.0002 : -0.0006), sd, NOISE))
const dnC = dnRuns.flatMap((x) => x.r.log.filter((e) => e.kind === 'CONFIRMED'))
ok(dnC.length >= 1 && dnC.every((e) => e.side === 'SELL'), `SELL: confirmed SELL signals appear and are all SELL (${dnC.length} over ${dnRuns.length} seeds)`)
const dn = dnRuns.find((x) => x.r.log.some((e) => e.kind === 'CONFIRMED')) ?? dnRuns[0]
// 3) fake bounce inside a strong downtrend
const fkRuns = [5, 9, 11].map((sd) => scen(`FAKE bounce seed ${sd}`, (i) => (i < TURN ? -0.0005 : i < TURN + 9 ? 0.0012 : -0.0009), sd, NOISE))
ok(fkRuns.every((x) => !x.r.log.some((e) => e.kind === 'CONFIRMED' && e.side === 'BUY')), 'FAKE: a short bounce in a strong downtrend never produces a confirmed BUY')
// 3b) strong V-reversal against a strong 15M downtrend: blocked by the 15M rule, and the reason says so
const vRuns = [5, 7].map((sd) => scen(`STRONG V vs 15M seed ${sd}`, (i) => (i < TURN ? -0.0006 : 0.0010), sd, 0.0016))
ok(vRuns.every((x) => !x.r.log.some((e) => e.kind === 'CONFIRMED' && e.time < x.c[TURN + 80].openTime)) && vRuns.some((x) => x.r.log.some((e) => e.kind === 'REJECTED' && /15M/.test(e.reason))), '15M FILTER: early V-reversal against a strong 15M downtrend is not confirmed and the rejection names 15M')
// 4) steady trend: no fresh setup => no confirmed signal from the tail alone
const sd = scen('STEADY uptrend', () => 0.0004, 3, 0.0016)
ok(!sd.r.active, 'STEADY: no active confirmed signal without a fresh trend start')

// 5) every confirmed entry satisfies the rules; SL/TP geometry and RR
const all: VtLogEntry[] = [...upRuns, ...dnRuns, ...fkRuns, ...vRuns, sd].flatMap((x) => x.r.log)
let bad = 0
for (const e of all.filter((x) => x.kind === 'CONFIRMED')) {
  const b = e.side === 'BUY'; const want = b ? 'BULLISH' : 'BEARISH'; const mw = b ? 'BULL' : 'BEAR'
  const geo = b ? e.sl! < e.entry! && e.tp! > e.entry! : e.sl! > e.entry! && e.tp! < e.entry!
  const rr = Math.abs(e.tp! - e.entry!) / Math.abs(e.entry! - e.sl!)
  if (e.vidya['3m'] !== want || e.vidya['5m'] !== want || e.ma['3m']['20/50'] !== mw || e.ma['5m']['20/50'] !== mw || !geo || Math.abs(rr - e.rr!) > 1e-6 || e.rr! < 1 || !e.afterCandleClose) bad++
}
ok(bad === 0, `INVARIANT: confirmed entries have 3M+5M VIDYA and 20/50 aligned, valid SL/TP side, RR matches prices (${all.filter((x) => x.kind === 'CONFIRMED').length} checked, ${bad} bad)`)

// 6) no look-ahead: a prefix run reports the same signals (id, time, entry, sl, tp) as the full run up to that time
const full = up.c; const cut = TURN + 150
// same candle arrays, only `now` moves: the engine must only use bars that had closed by `now`
const k1 = full.slice(-400), k3 = resampleAligned(full, 3).slice(-300), k5 = resampleAligned(full, 5).slice(-300), k15 = resampleAligned(full, 15).slice(-300)
const at = (end: number) => buildVtRow({ symbol: 'T', price: 1, change24h: 0, k1, k3, k5, k15, now: full[end - 1].openTime + 60000 })!
const rp = at(cut); const rf = at(N)
const sig = (e: VtLogEntry) => `${e.id}|${e.time}|${e.entry}|${e.sl}|${e.tp}`
const prefixSigs = rp.log.filter((e) => e.kind !== 'REJECTED').map(sig)
const fullSigs = new Set(rf.log.filter((e) => e.kind !== 'REJECTED').map(sig))
ok(prefixSigs.every((x) => fullSigs.has(x)), `NO LOOK-AHEAD: all ${prefixSigs.length} signals visible at minute ${cut} are identical (time, entry, SL, TP) in the later run`)

// 7) confirmed alerts are one per setup, and stats run
const st = vtStats(all)
console.log('stats', JSON.stringify(st))
ok(st.trades >= 0 && Number.isFinite(st.expectancy) && st.maxDrawdownR >= 0, 'STATS: finite expectancy and drawdown')
// 8) 1M reversal alone never confirms: pure 1M noise flip on top of an old trend
const bounce = make(N, START + N * 60000, (i) => (i < N - 12 ? -0.0005 : i < N - 6 ? 0.0010 : -0.0005), 11, NOISE)
const rb = row(bounce, N)!
ok(!rb.log.some((e) => e.kind === 'CONFIRMED' && e.time > bounce[N - 30].openTime && e.side === 'BUY'), '1M-ONLY: a brief 1M bounce in a downtrend gives no confirmed BUY')
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0)
