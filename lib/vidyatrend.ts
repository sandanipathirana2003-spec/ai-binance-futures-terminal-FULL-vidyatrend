// VIDYA Trend engine: Volumatic VIDYA + EMA ribbon, 1M / 3M / 5M / 15M staged reversal-to-trend entries.
//
//   3M VIDYA trend start -> 3M EMA 20/50 -> 5M VIDYA alignment -> 5M EMA 20/50 -> 15M not opposing
//   -> valid 5M-based TP and VIDYA-based SL -> ONE confirmed signal per setup.
//
// Pure functions only (no I/O). The same replay runs live (last bar) and as the backtest (every earlier bar), and every
// bar only ever sees candles that had CLOSED at that moment, so there is no look-ahead. Nothing here is a guarantee.
import type { Candle } from './binance'
import { atrSeries, emaSeries, vidyaBandSeries } from './indicators'
import { closedOnly } from './reversal'

// --------------------------------------------------------------------------- constants & types

export const VT_VIDYA = { length: 14, momentum: 9, bandFactor: 1.5 } as const
export const VT_TFS = ['1m', '3m', '5m', '15m'] as const
export type VtTf = (typeof VT_TFS)[number]
export const VT_TF_LABEL: Record<VtTf, string> = { '1m': '1M', '3m': '3M', '5m': '5M', '15m': '15M' }
const TF_MS: Record<VtTf, number> = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000 }

export const VT_PAIRS = ['9/21', '20/50', '21/50', '50/100', '100/200'] as const
export type VtPair = (typeof VT_PAIRS)[number]
const PAIR_PERIODS: Record<VtPair, [number, number]> = { '9/21': [9, 21], '20/50': [20, 50], '21/50': [21, 50], '50/100': [50, 100], '100/200': [100, 200] }
/** Zone names from the spec: EMA 20-50 = Middle, EMA 100-200 = Strong. */
export const VT_PAIR_ZONE: Partial<Record<VtPair, 'Middle' | 'Strong'>> = { '20/50': 'Middle', '100/200': 'Strong' }
const EMA_PERIODS = [9, 20, 21, 50, 100, 200] as const

export type VtSide = 'BUY' | 'SELL'
export type VtDirName = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export interface VtConfig {
  /** Which VIDYA boundary the stop uses first. The other one is the fallback when this one is unsuitable. */
  slSource: '5m' | '3m'
  /** ATR(14, 5M) multiple added beyond the stop level. */
  atrBuffer: number
  /** Minimum reward : risk for the structural 5M target. Below it the entry is withheld. */
  minRR: number
  /** Reference targets shown next to the structural TP. */
  rrTargets: [number, number]
  /** Also place the stop beyond the latest confirmed 5M swing if that is further than the VIDYA boundary. */
  slBeyondSwing: boolean
  /** Reject a stop wider than this many ATR(5M). */
  maxRiskAtr: number
  /** A setup (3M/5M VIDYA trend start) may wait this long for the other conditions before it is rejected. */
  setupWindowMin: number
  /** Taker fee per side, percent. */
  feePct: number
  /** Assumed slippage per side, percent. */
  slippagePct: number
}

export const DEFAULT_VT_CONFIG: VtConfig = {
  slSource: '5m',
  atrBuffer: 0.25,
  minRR: 1.0,
  rrTargets: [1.5, 2],
  slBeyondSwing: false,
  maxRiskAtr: 6,
  setupWindowMin: 120,
  feePct: 0.05,
  slippagePct: 0.02,
}

export function sanitizeVtConfig(raw: Partial<Record<keyof VtConfig, unknown>>): VtConfig {
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d
  }
  const d = DEFAULT_VT_CONFIG
  return {
    ...d,
    slSource: raw.slSource === '3m' ? '3m' : '5m',
    atrBuffer: num(raw.atrBuffer, 0, 3, d.atrBuffer),
    minRR: num(raw.minRR, 0.5, 5, d.minRR),
    slBeyondSwing: raw.slBeyondSwing === true || raw.slBeyondSwing === '1' || raw.slBeyondSwing === 'true',
    maxRiskAtr: num(raw.maxRiskAtr, 1, 20, d.maxRiskAtr),
    setupWindowMin: num(raw.setupWindowMin, 15, 360, d.setupWindowMin),
  }
}

export type VtStatus =
  | 'WAITING FOR ALIGNMENT'
  | 'EARLY REVERSAL — NOT CONFIRMED'
  | 'POSSIBLE FAKE REVERSAL'
  | 'MIXED TREND — WAIT FOR ALIGNMENT'
  | '3M SETUP CONFIRMED'
  | 'WAITING FOR 5M CONFIRMATION'
  | 'FULL BULLISH ALIGNMENT'
  | 'FULL BEARISH ALIGNMENT'
  | 'WAITING FOR VALID 5M STRUCTURE'
  | 'WAITING FOR VALID SL — NO CONFIRMED ENTRY'
  | 'WAITING FOR VALID 5M TP — NO CONFIRMED ENTRY'
  | 'SIGNAL WEAKENED'
  | 'SIGNAL INVALIDATED'

export type VtCrossStatus = 'DEVELOPING' | 'CONFIRMED' | 'NONE'
export interface VtCross {
  pair: VtPair
  zone?: 'Middle' | 'Strong'
  state: 'BULL' | 'BEAR'
  /** Closed bars since the crossover; -1 = no crossover inside the loaded history. */
  barsAgo: number
  time: number | null
  status: VtCrossStatus
  vidyaAgrees: boolean
  priceConfirms: boolean
}

export type VtLifecycle = 'NEW' | 'CONTINUING' | 'WEAKENING' | 'INVALIDATED' | 'NONE'
export interface VtTfSnap {
  tf: VtTf
  close: number
  dir: VtDirName
  justFlipped: boolean
  barsSinceFlip: number
  flipTime: number | null
  /** Direction is known on a closed candle (every reading here uses closed candles only). */
  closedConfirmed: boolean
  vidyaLine: number
  /** The VIDYA trend boundary on the trend side: lower band (support) in an uptrend, upper band (resistance) in a downtrend. */
  boundary: number | null
  priceVs: 'ABOVE BANDS' | 'BELOW BANDS' | 'INSIDE BANDS'
  momentum: VtDirName
  cmoPct: number
  lifecycle: VtLifecycle
  emas: Record<(typeof EMA_PERIODS)[number], number>
  crosses: VtCross[]
  /** EMA 200 needs ~200 closed bars to be trustworthy. */
  sufficientData: boolean
}

export type VtKind = 'EARLY' | 'CONFIRMED' | 'REJECTED'
export type VtEntryStatus = 'EARLY' | 'CONFIRMED' | 'WEAKENED' | 'INVALIDATED' | 'REJECTED' | 'COMPLETED'
export type VtOutcome = 'TP' | 'SL' | 'INVALIDATED' | 'OPEN' | 'UNRESOLVED'

export interface VtLogEntry {
  id: string
  symbol: string
  side: VtSide
  kind: VtKind
  status: VtEntryStatus
  /** Candle close time of the bar that produced the signal (ms). Never rewritten after the fact. */
  time: number
  /** Always true: signals are only produced on closed candles. */
  afterCandleClose: boolean
  triggerTf: '1M' | '3M' | '5M'
  label: string
  reason: string
  entry?: number
  sl?: number
  tp?: number
  rr?: number
  tp15?: number
  tp20?: number
  slSource?: string
  oneMinConfirmed?: boolean
  outcome?: VtOutcome
  outcomeTime?: number
  exitPrice?: number
  /** Net R multiple after fees and slippage. */
  rNet?: number
  crossTf?: string
  crossPair?: string
  crossTime?: number
  vidya: Record<VtTf, VtDirName>
  ma: Record<VtTf, Record<VtPair, 'BULL' | 'BEAR'>>
  trend15: VtDirName | 'MIXED'
  tags: string[]
  weakenedAt?: number
  invalidatedAt?: number
}

export interface VtRow {
  symbol: string
  price: number
  change24h: number
  status: VtStatus
  headline: string
  reason: string
  side: VtSide | null
  phase: 'NONE' | 'PENDING' | 'EARLY' | 'ACTIVE'
  fakeReasons: string[]
  tfs: Record<VtTf, VtTfSnap>
  trend15: VtDirName | 'MIXED'
  /** The live confirmed signal (also present in `log`). */
  active: VtLogEntry | null
  /** Unrealised R of the active signal at the last closed 1M candle. */
  activeOpenR: number | null
  setupStartedAt: number | null
  setupWindowLeftMin: number | null
  log: VtLogEntry[]
  rank: number
  /** Latest closed 1M candle close time used for this row. */
  asOf: number
  warmup: boolean
}

export interface VtResponse {
  rows: VtRow[]
  computedAt: number
  live: boolean
  source: string
  config: VtConfig
  windowHours: number
  error?: string
}

// --------------------------------------------------------------------------- per-timeframe series

interface TfData {
  tf: VtTf
  ms: number
  c: Candle[]
  n: number
  up: (boolean | null)[]
  line: number[]
  upper: number[]
  lower: number[]
  cmo: number[]
  atr: number[]
  ema: Record<number, number[]>
  flipAt: Int32Array
  pairState: Record<VtPair, Int8Array>
  pairCross: Record<VtPair, Int32Array>
}

function prepare(tf: VtTf, c: Candle[]): TfData | null {
  const n = c.length
  if (n < 30) return null
  const vb = vidyaBandSeries(c, { length: VT_VIDYA.length, momentum: VT_VIDYA.momentum, bandFactor: VT_VIDYA.bandFactor, seed: true })
  if (!vb) return null
  const cl = c.map((x) => x.close)

  // Signed Chande momentum over the VIDYA momentum window.
  const cmo: number[] = new Array(n).fill(0)
  const m = VT_VIDYA.momentum
  for (let i = m; i < n; i++) {
    let p = 0
    let q = 0
    for (let j = i - m + 1; j <= i; j++) {
      const d = cl[j] - cl[j - 1]
      if (d > 0) p += d
      else q -= d
    }
    cmo[i] = p + q === 0 ? 0 : (p - q) / (p + q)
  }

  const ema: Record<number, number[]> = {}
  for (const p of EMA_PERIODS) ema[p] = emaSeries(cl, p)

  const flipAt = new Int32Array(n).fill(-1)
  for (let i = 1; i < n; i++) {
    const a = vb.up[i - 1]
    const b = vb.up[i]
    flipAt[i] = a !== null && b !== null && a !== b ? i : flipAt[i - 1]
  }

  const pairState = {} as Record<VtPair, Int8Array>
  const pairCross = {} as Record<VtPair, Int32Array>
  for (const pair of VT_PAIRS) {
    const [f, s] = PAIR_PERIODS[pair]
    const st = new Int8Array(n)
    const cr = new Int32Array(n).fill(-1)
    for (let i = 0; i < n; i++) {
      st[i] = ema[f][i] > ema[s][i] ? 1 : -1
      if (i > 0) cr[i] = st[i] !== st[i - 1] && i >= s ? i : cr[i - 1]
    }
    pairState[pair] = st
    pairCross[pair] = cr
  }
  return { tf, ms: TF_MS[tf], c, n, up: vb.up, line: vb.line, upper: vb.upper, lower: vb.lower, cmo, atr: atrSeries(c, 14), ema, flipAt, pairState, pairCross }
}

const dirOf = (d: TfData, i: number): 1 | -1 | 0 => (d.up[i] === true ? 1 : d.up[i] === false ? -1 : 0)
const dirName = (x: number): VtDirName => (x > 0 ? 'BULLISH' : x < 0 ? 'BEARISH' : 'NEUTRAL')
const st = (d: TfData, pair: VtPair, i: number): 1 | -1 => d.pairState[pair][i] as 1 | -1
const atrAt = (d: TfData, i: number): number => {
  const a = d.atr[i]
  if (Number.isFinite(a) && a > 0) return a
  let sum = 0
  let cnt = 0
  for (let j = Math.max(0, i - 13); j <= i; j++) {
    sum += d.c[j].high - d.c[j].low
    cnt++
  }
  return cnt ? sum / cnt : 0
}

/** Closed price supports the move: beyond the VIDYA line and beyond EMA 21 (mirror for sells). */
const priceSupports = (d: TfData, i: number, s: number) => s * (d.c[i].close - d.line[i]) > 0 && s * (d.c[i].close - d.ema[21][i]) > 0
/** 20/50 structure on the side AND price beyond the 50 (not just a stale cross). */
const ma2050 = (d: TfData, i: number, s: number) => st(d, '20/50', i) === s && s * (d.c[i].close - d.ema[50][i]) > 0

/** Pivot high/low with `r` bars each side; the pivot is only known `r` bars after it printed. */
function pivots(d: TfData, i: number, kind: 'high' | 'low', lookback: number, r = 3): Array<{ idx: number; price: number }> {
  const out: Array<{ idx: number; price: number }> = []
  for (let p = i - r; p >= Math.max(r, i - lookback); p--) {
    let ok = true
    const v = kind === 'high' ? d.c[p].high : d.c[p].low
    for (let j = p - r; j <= p + r && ok; j++) {
      if (j === p) continue
      const w = kind === 'high' ? d.c[j].high : d.c[j].low
      if (kind === 'high' ? w > v || (j < p && w === v) : w < v || (j < p && w === v)) ok = false
    }
    if (ok) out.push({ idx: p, price: v })
  }
  return out
}

function trend15Of(d: TfData, i: number): { label: VtDirName | 'MIXED'; dir: number } {
  const dir = dirOf(d, i)
  let sum = dir + st(d, '20/50', i) + st(d, '50/100', i)
  if (i >= 200) sum += st(d, '100/200', i)
  const label = sum >= 3 ? 'BULLISH' : sum <= -3 ? 'BEARISH' : 'MIXED'
  return { label, dir }
}

// --------------------------------------------------------------------------- risk levels

interface Risk {
  ok: boolean
  /** Why no valid risk levels exist. */
  blocker: 'SL' | 'TP' | 'STRUCTURE' | null
  why: string
  sl: number
  tp: number
  rr: number
  slSource: string
  tp15: number
  tp20: number
}

function calcRisk(s: 1 | -1, entry: number, d3: TfData, i3: number, d5: TfData, i5: number, cfg: VtConfig): Risk {
  const bad = (blocker: Risk['blocker'], why: string): Risk => ({ ok: false, blocker, why, sl: NaN, tp: NaN, rr: NaN, slSource: '', tp15: NaN, tp20: NaN })
  const atr5 = atrAt(d5, i5)
  if (!(atr5 > 0) || i5 < 30) return bad('STRUCTURE', '5M structure not available yet (not enough closed candles / ATR)')
  const buf = cfg.atrBuffer * atr5

  // --- stop: VIDYA trend boundary (lower band for buys, upper band for sells) ---
  const boundary = (d: TfData, i: number) => {
    const b = s > 0 ? d.lower[i] : d.upper[i]
    return Number.isFinite(b) ? b : NaN
  }
  const stopFrom = (b: number) => (s > 0 ? b - buf : b + buf)
  const suitable = (sl: number) => Number.isFinite(sl) && s * (entry - sl) > 0.2 * atr5 && s * (entry - sl) <= cfg.maxRiskAtr * atr5
  const order: Array<{ src: string; b: number }> =
    cfg.slSource === '5m'
      ? [
          { src: '5M VIDYA', b: boundary(d5, i5) },
          { src: '3M VIDYA', b: boundary(d3, i3) },
        ]
      : [
          { src: '3M VIDYA', b: boundary(d3, i3) },
          { src: '5M VIDYA', b: boundary(d5, i5) },
        ]
  let sl = NaN
  let slSource = ''
  for (const o of order) {
    const cand = stopFrom(o.b)
    if (suitable(cand)) {
      sl = cand
      slSource = o.src
      break
    }
  }
  const swings = pivots(d5, i5, s > 0 ? 'low' : 'high', 60).filter((p) => s * (entry - p.price) > 0.2 * atr5)
  const swingStop = swings.length ? stopFrom(swings[0].price) : NaN // pivots() is newest first
  if (!Number.isFinite(sl) && suitable(swingStop)) {
    sl = swingStop
    slSource = '5M SWING'
  } else if (cfg.slBeyondSwing && Number.isFinite(sl) && Number.isFinite(swingStop) && suitable(swingStop) && s * (sl - swingStop) > 0) {
    sl = swingStop
    slSource += ' + SWING'
  }
  if (!Number.isFinite(sl)) return bad('SL', 'no VIDYA boundary or swing gives a stop that is neither too tight nor wider than the risk cap')
  const risk = s * (entry - sl)

  // --- target: first significant 5M swing beyond entry (end of the current leg / next resistance or support) ---
  const minDist = 0.5 * atr5
  const targets = pivots(d5, i5, s > 0 ? 'high' : 'low', 150)
    .filter((p) => s * (p.price - entry) > minDist)
    .map((p) => p.price)
  if (!targets.length) return bad('TP', 'no 5M swing high/low beyond the entry to use as a target')
  const tp = s > 0 ? Math.min(...targets) : Math.max(...targets)
  const rr = (s * (tp - entry)) / risk
  if (rr < cfg.minRR) return { ...bad('TP', `reward too small: 1:${rr.toFixed(2)} to the first 5M structure (min 1:${cfg.minRR})`), sl, slSource, tp, rr }
  return { ok: true, blocker: null, why: '', sl, tp, rr, slSource, tp15: entry + s * risk * cfg.rrTargets[0], tp20: entry + s * risk * cfg.rrTargets[1] }
}

// --------------------------------------------------------------------------- build one row

export interface VtInput {
  symbol: string
  price: number
  change24h: number
  k1: Candle[]
  k3: Candle[]
  k5: Candle[]
  k15: Candle[]
  now: number
  config?: VtConfig
}

interface Setup {
  id: string
  s: 1 | -1
  originTf: '3M' | '5M'
  startedAt: number
  phase: 'PENDING' | 'EARLY' | 'ACTIVE' | 'ENDED'
  fakeSeen: string[]
  lastBlock: string
  early?: VtLogEntry
  signal?: VtLogEntry
  entryStep?: number
  risk?: number
}

const sideName = (s: number): VtSide => (s > 0 ? 'BUY' : 'SELL')
const FAKE_FADE_MS = 30 * 60_000
export const VT_MAX_LOG = 30

export function buildVtRow(inp: VtInput): VtRow | null {
  const cfg = inp.config ?? DEFAULT_VT_CONFIG
  const D1 = prepare('1m', closedOnly(inp.k1, inp.now, TF_MS['1m']))
  const D3 = prepare('3m', closedOnly(inp.k3, inp.now, TF_MS['3m']))
  const D5 = prepare('5m', closedOnly(inp.k5, inp.now, TF_MS['5m']))
  const D15 = prepare('15m', closedOnly(inp.k15, inp.now, TF_MS['15m']))
  if (!D1 || !D3 || !D5 || !D15 || D1.n < 80 || D3.n < 60 || D5.n < 60 || D15.n < 40) return null

  const windowMs = cfg.setupWindowMin * 60_000
  const log: VtLogEntry[] = []
  let setup: Setup | null = null
  let recentInvalid: { s: number; time: number; reason: string } | null = null
  const p = { i3: -1, i5: -1, i15: -1 }
  const advance = (d: TfData, cur: number, t: number) => {
    let x = cur
    while (x + 1 < d.n && d.c[x + 1].openTime + d.ms <= t) x++
    return x
  }

  const snapshot = (i1: number, i3: number, i5: number, i15: number) => {
    const idx: Record<VtTf, [TfData, number]> = { '1m': [D1, i1], '3m': [D3, i3], '5m': [D5, i5], '15m': [D15, i15] }
    const vidya = {} as VtLogEntry['vidya']
    const ma = {} as VtLogEntry['ma']
    for (const tf of VT_TFS) {
      const [d, i] = idx[tf]
      vidya[tf] = dirName(dirOf(d, i))
      const o = {} as Record<VtPair, 'BULL' | 'BEAR'>
      for (const pair of VT_PAIRS) o[pair] = st(d, pair, i) > 0 ? 'BULL' : 'BEAR'
      ma[tf] = o
    }
    return { vidya, ma, trend15: trend15Of(D15, i15).label }
  }

  // Stage A: 3M setup (VIDYA + 20/50 + 9/21 + 21/50 + price).
  const stageA = (s: 1 | -1, i3: number) => {
    const gap = (i: number) => D3.ema[21][i] - D3.ema[50][i]
    const improving = i3 >= 3 && s * (gap(i3) - gap(i3 - 3)) > 0
    return {
      vidya: dirOf(D3, i3) === s,
      price: priceSupports(D3, i3, s),
      ma2050: ma2050(D3, i3, s),
      ma921: st(D3, '9/21', i3) === s,
      ma2150: st(D3, '21/50', i3) === s || improving,
    }
  }
  const aOk = (a: ReturnType<typeof stageA>) => a.vidya && a.price && a.ma2050 && a.ma921 && a.ma2150

  const fakeFor = (s: 1 | -1, i3: number, i5: number, i15: number): string[] => {
    const out: string[] = []
    const t15 = trend15Of(D15, i15)
    if (t15.label === dirName(-s) && t15.dir === -s) out.push(`15M trend is strongly ${t15.label.toLowerCase()} against this ${sideName(s)}`)
    if (s * (D3.c[i3].close - D3.line[i3]) < 0) out.push('price fell back through the 3M VIDYA line (not holding the new direction)')
    return out
  }

  const nrAt = (s: number, entry: number, exit: number, risk: number) => {
    const cost = (entry * (2 * cfg.feePct + 2 * cfg.slippagePct)) / 100
    return (s * (exit - entry) - cost) / risk
  }

  const reject = (su: Setup, t: number, why: string) => {
    if (su.phase === 'ACTIVE' || su.phase === 'ENDED') return
    const snap = snapshot(curI1, p.i3, p.i5, p.i15)
    log.push({
      id: `${inp.symbol}|R|${su.id}`,
      symbol: inp.symbol,
      side: sideName(su.s),
      kind: 'REJECTED',
      status: 'REJECTED',
      time: t,
      afterCandleClose: true,
      triggerTf: su.originTf === '3M' ? '3M' : '5M',
      label: `${sideName(su.s)} SETUP REJECTED`,
      reason: [why, su.fakeSeen.length ? `Seen: ${su.fakeSeen.join('; ')}` : '', su.lastBlock ? `Last blocker: ${su.lastBlock}` : ''].filter(Boolean).join(' · '),
      ...snap,
      tags: tagsFor(su.s, snap, 'REJECTED'),
    })
    su.phase = 'ENDED'
  }

  const tagsFor = (s: number, snap: ReturnType<typeof snapshot>, kind: VtKind, extra: string[] = []): string[] => {
    const t: string[] = [...extra]
    const side = s > 0 ? 'BULLISH' : 'BEARISH'
    const want = s > 0 ? 'BULL' : 'BEAR'
    if (snap.vidya['3m'] === side) t.push('VIDYA')
    if (snap.ma['3m']['9/21'] === want || snap.ma['5m']['9/21'] === want) t.push('EMA 9/21')
    if (snap.ma['3m']['21/50'] === want || snap.ma['5m']['21/50'] === want) t.push('EMA 21/50')
    const m2050 = snap.ma['3m']['20/50'] === want && (kind === 'CONFIRMED' ? snap.ma['5m']['20/50'] === want : true)
    if (m2050) t.push('EMA 20/50')
    if (t.includes('VIDYA') && m2050) t.push('COMBINED')
    if (kind === 'EARLY') t.push('EARLY')
    if (kind === 'CONFIRMED') t.push('FULL 3M+5M')
    if (snap.trend15 === side) t.push('15M ALIGNED')
    return t
  }

  const latestCross = (s: number, i3: number, i5: number) => {
    const want = s > 0 ? 1 : -1
    let best: { tf: string; pair: string; time: number } | null = null
    for (const [d, i, lab] of [[D3, i3, '3M'], [D5, i5, '5M']] as Array<[TfData, number, string]>) {
      const ci = d.pairCross['20/50'][i]
      if (ci >= 0 && st(d, '20/50', i) === want) {
        const time = d.c[ci].openTime + d.ms
        if (!best || time > best.time) best = { tf: lab, pair: '20/50', time }
      }
    }
    return best
  }

  let curI1 = 0
  const startK = Math.max(60, 0)
  let prevI3 = -1
  let prevI5 = -1
  let lastRisk: Risk | null = null
  let lastA: ReturnType<typeof stageA> | null = null
  let lastFake: string[] = []

  for (let k = startK; k < D1.n; k++) {
    curI1 = k
    const t = D1.c[k].openTime + D1.ms // close time of this 1M bar
    p.i3 = advance(D3, p.i3 < 0 ? -1 : p.i3, t)
    p.i5 = advance(D5, p.i5 < 0 ? -1 : p.i5, t)
    p.i15 = advance(D15, p.i15 < 0 ? -1 : p.i15, t)
    const { i3, i5, i15 } = p
    if (i3 < 40 || i5 < 40 || i15 < 30) continue
    const new3 = i3 !== prevI3
    const new5 = i5 !== prevI5
    prevI3 = i3
    prevI5 = i5
    const bar = D1.c[k]

    // 1) Resolve an open signal against this 1M bar (starts the bar AFTER entry; stop wins a same-bar tie).
    if (setup && setup.phase === 'ACTIVE' && setup.signal && setup.entryStep !== undefined && k > setup.entryStep) {
      const sg = setup.signal
      const s = setup.s
      const hitSl = s > 0 ? bar.low <= sg.sl! : bar.high >= sg.sl!
      const hitTp = s > 0 ? bar.high >= sg.tp! : bar.low <= sg.tp!
      if (hitSl || hitTp) {
        sg.outcome = hitSl ? 'SL' : 'TP'
        sg.outcomeTime = t
        sg.exitPrice = hitSl ? sg.sl : sg.tp
        sg.rNet = nrAt(s, sg.entry!, sg.exitPrice!, setup.risk!)
        sg.status = 'COMPLETED'
        setup.phase = 'ENDED'
      }
    }

    // 2) Weakened / invalidated checks on the open signal.
    if (setup && setup.phase === 'ACTIVE' && setup.signal) {
      const s = setup.s
      const sg = setup.signal
      const broken =
        dirOf(D3, i3) !== s || dirOf(D5, i5) !== s || st(D3, '20/50', i3) !== s || st(D5, '20/50', i5) !== s
      if (broken && sg.status !== 'COMPLETED') {
        const why =
          dirOf(D3, i3) !== s ? '3M VIDYA turned against the trade' : dirOf(D5, i5) !== s ? '5M VIDYA turned against the trade' : st(D3, '20/50', i3) !== s ? '3M EMA 20/50 crossed against the trade' : '5M EMA 20/50 crossed against the trade'
        sg.status = 'INVALIDATED'
        sg.invalidatedAt = t
        sg.outcome = 'INVALIDATED'
        sg.outcomeTime = t
        sg.exitPrice = bar.close
        sg.rNet = nrAt(s, sg.entry!, bar.close, setup.risk!)
        sg.reason = `${sg.reason} · INVALIDATED: ${why}`
        recentInvalid = { s, time: t, reason: why }
        setup.phase = 'ENDED'
      } else if (!broken && sg.status !== 'COMPLETED') {
        const weak =
          s * (D5.c[i5].close - D5.line[i5]) < 0 || st(D5, '9/21', i5) !== s || (trend15Of(D15, i15).label === dirName(-s) && trend15Of(D15, i15).dir === -s)
        if (weak && sg.status === 'CONFIRMED') {
          sg.status = 'WEAKENED'
          sg.weakenedAt = t
        } else if (!weak && sg.status === 'WEAKENED') {
          sg.status = 'CONFIRMED'
        }
      }
    }

    // 3) New setup origins: a 3M VIDYA flip, or a 5M flip while 3M already agrees. Never while another setup is waiting/open.
    const origin = ((): { s: 1 | -1; tf: '3M' | '5M' } | null => {
      if (new3 && D3.flipAt[i3] === i3) return { s: dirOf(D3, i3) as 1 | -1, tf: '3M' }
      if (new5 && D5.flipAt[i5] === i5 && dirOf(D3, i3) === dirOf(D5, i5)) return { s: dirOf(D5, i5) as 1 | -1, tf: '5M' }
      return null
    })()
    if (origin) {
      if (setup && (setup.phase === 'PENDING' || setup.phase === 'EARLY') && setup.s !== origin.s) {
        reject(setup, t, 'reversed again before 5M confirmation (flip-back)')
        setup = null
      }
      if (!setup || setup.phase === 'ENDED') {
        setup = { id: `${origin.s > 0 ? 'B' : 'S'}${t}`, s: origin.s, originTf: origin.tf, startedAt: t, phase: 'PENDING', fakeSeen: [], lastBlock: '' }
      }
    }

    if (!setup || (setup.phase !== 'PENDING' && setup.phase !== 'EARLY')) continue
    const s = setup.s

    // 4) Window expiry.
    if (t - setup.startedAt > windowMs) {
      reject(setup, t, `setup window of ${cfg.setupWindowMin} min expired without full alignment`)
      setup = null
      continue
    }
    if (dirOf(D3, i3) !== s && dirOf(D5, i5) !== s) {
      reject(setup, t, '3M and 5M VIDYA both lost the setup direction')
      setup = null
      continue
    }

    const fake = fakeFor(s, i3, i5, i15)
    for (const f of fake) if (!setup.fakeSeen.includes(f)) setup.fakeSeen.push(f)
    const a = stageA(s, i3)
    lastA = a
    lastFake = fake

    // 5) Stage A -> EARLY warning (logged once, never a confirmed entry).
    if (aOk(a) && !setup.early) {
      const snap = snapshot(k, i3, i5, i15)
      const e: VtLogEntry = {
        id: `${inp.symbol}|E|${setup.id}`,
        symbol: inp.symbol,
        side: sideName(s),
        kind: 'EARLY',
        status: 'EARLY',
        time: t,
        afterCandleClose: true,
        triggerTf: '3M',
        label: `EARLY ${sideName(s)} — WAITING FOR 5M CONFIRMATION`,
        reason: `3M VIDYA ${dirName(s).toLowerCase()} + 3M EMA 20/50 ${s > 0 ? 'bullish' : 'bearish'} + 9/21 and 21/50 supporting. Not a confirmed entry.`,
        entry: bar.close,
        ...snap,
        tags: [],
      }
      e.tags = tagsFor(s, snap, 'EARLY')
      setup.early = e
      setup.phase = 'EARLY'
      log.push(e)
    }

    // 6) Stage B + risk -> the one confirmed entry for this setup.
    const bCore = aOk(a) && dirOf(D5, i5) === s && dirOf(D3, i3) === s && ma2050(D5, i5, s) && priceSupports(D5, i5, s) && fake.length === 0
    if (!bCore) {
      setup.lastBlock = !aOk(a)
        ? '3M setup incomplete'
        : dirOf(D5, i5) !== s
          ? '5M VIDYA not aligned yet'
          : !ma2050(D5, i5, s)
            ? '5M EMA 20/50 not confirmed yet'
            : !priceSupports(D5, i5, s)
              ? '5M price not beyond VIDYA line / EMA 21'
              : fake[0] ?? ''
      lastRisk = null
      continue
    }
    const entry = bar.close
    const risk = calcRisk(s, entry, D3, i3, D5, i5, cfg)
    lastRisk = risk
    if (!risk.ok) {
      setup.lastBlock = risk.why
      continue
    }

    const snap = snapshot(k, i3, i5, i15)
    const oneMin = dirOf(D1, k) === s && st(D1, '9/21', k) === s && s * (bar.close - D1.ema[21][k]) > 0
    const cross = latestCross(s, i3, i5)
    const trigTf: VtLogEntry['triggerTf'] = new5 ? '5M' : new3 ? '3M' : '1M'
    const sg: VtLogEntry = {
      id: `${inp.symbol}|C|${setup.id}`,
      symbol: inp.symbol,
      side: sideName(s),
      kind: 'CONFIRMED',
      status: 'CONFIRMED',
      time: t,
      afterCandleClose: true,
      triggerTf: trigTf,
      label: oneMin ? `FULL VIDYA TREND ALIGNMENT + MA CONFIRMATION — ${sideName(s)}` : `VIDYA + MA ${s > 0 ? 'BULLISH' : 'BEARISH'} TREND ENTRY`,
      reason: `3M+5M VIDYA ${dirName(s).toLowerCase()}, 3M+5M EMA 20/50 ${s > 0 ? 'bullish' : 'bearish'}, 15M ${snap.trend15.toLowerCase()}; stop ${risk.slSource}, target = first 5M structure`,
      entry,
      sl: risk.sl,
      tp: risk.tp,
      rr: risk.rr,
      tp15: risk.tp15,
      tp20: risk.tp20,
      slSource: risk.slSource,
      oneMinConfirmed: oneMin,
      outcome: 'OPEN',
      crossTf: cross?.tf,
      crossPair: cross?.pair,
      crossTime: cross?.time,
      ...snap,
      tags: [],
    }
    sg.tags = tagsFor(s, snap, 'CONFIRMED', [risk.slSource.startsWith('3M') ? 'SL 3M' : risk.slSource.startsWith('5M VIDYA') ? 'SL 5M' : 'SL SWING'])
    if (oneMin) sg.tags.push('1M TIMING')
    setup.signal = sg
    setup.phase = 'ACTIVE'
    setup.entryStep = k
    setup.risk = s * (entry - risk.sl)
    log.push(sg)
  }

  // ------------------------------------------------------------------------- current state
  const k = D1.n - 1
  const { i3, i5, i15 } = p
  const t = D1.c[k].openTime + D1.ms
  const tfIdx: Record<VtTf, [TfData, number]> = { '1m': [D1, k], '3m': [D3, i3], '5m': [D5, i5], '15m': [D15, i15] }
  const t15 = trend15Of(D15, i15)
  const setupSide = setup && setup.phase !== 'ENDED' ? setup.s : null

  const tfs = {} as Record<VtTf, VtTfSnap>
  for (const tf of VT_TFS) {
    const [d, i] = tfIdx[tf]
    const dir = dirOf(d, i)
    const fl = d.flipAt[i]
    const bsf = fl >= 0 ? i - fl : -1
    const close = d.c[i].close
    const priceVs = Number.isFinite(d.upper[i]) && close > d.upper[i] ? 'ABOVE BANDS' : Number.isFinite(d.lower[i]) && close < d.lower[i] ? 'BELOW BANDS' : 'INSIDE BANDS'
    const cmo = d.cmo[i]
    const mom: VtDirName = cmo > 0.1 ? 'BULLISH' : cmo < -0.1 ? 'BEARISH' : 'NEUTRAL'
    let lifecycle: VtLifecycle = 'CONTINUING'
    if (dir === 0) lifecycle = 'NONE'
    else if (setup && setup.phase === 'ENDED' && recentInvalid && t - recentInvalid.time < FAKE_FADE_MS && dir === -recentInvalid.s) lifecycle = 'INVALIDATED'
    else if (bsf >= 0 && bsf <= 2) lifecycle = 'NEW'
    else if (dir * (close - d.line[i]) < 0 || (mom === dirName(-dir) && Math.abs(cmo) > 0.25)) lifecycle = 'WEAKENING'
    const crosses: VtCross[] = VT_PAIRS.map((pair) => {
      const state = st(d, pair, i) > 0 ? 'BULL' : 'BEAR'
      const ci = d.pairCross[pair][i]
      const sgn = state === 'BULL' ? 1 : -1
      const [f, sl] = PAIR_PERIODS[pair]
      const gap = Math.abs(d.ema[f][i] - d.ema[sl][i])
      const barsAgo = ci >= 0 ? i - ci : -1
      const status: VtCrossStatus = ci < 0 ? 'NONE' : barsAgo >= 2 && gap >= 0.1 * atrAt(d, i) ? 'CONFIRMED' : 'DEVELOPING'
      return {
        pair,
        zone: VT_PAIR_ZONE[pair],
        state,
        barsAgo,
        time: ci >= 0 ? d.c[ci].openTime + d.ms : null,
        status,
        vidyaAgrees: dir === sgn,
        priceConfirms: sgn * (close - d.ema[f][i]) > 0 && sgn * (close - d.ema[sl][i]) > 0,
      }
    })
    const em = {} as VtTfSnap['emas']
    for (const per of EMA_PERIODS) em[per] = d.ema[per][i]
    tfs[tf] = {
      tf,
      close,
      dir: dirName(dir),
      justFlipped: bsf === 0,
      barsSinceFlip: bsf,
      flipTime: fl >= 0 ? d.c[fl].openTime + d.ms : null,
      closedConfirmed: dir !== 0,
      vidyaLine: d.line[i],
      boundary: dir === 0 ? null : dir > 0 ? (Number.isFinite(d.lower[i]) ? d.lower[i] : null) : Number.isFinite(d.upper[i]) ? d.upper[i] : null,
      priceVs,
      momentum: mom,
      cmoPct: cmo * 100,
      lifecycle,
      emas: em,
      crosses,
      sufficientData: i >= 200,
    }
  }

  // ---- status ----
  let status: VtStatus = 'WAITING FOR ALIGNMENT'
  let headline = 'WAITING FOR ALIGNMENT'
  let reason = ''
  let side: VtSide | null = null
  let phase: VtRow['phase'] = 'NONE'
  let fakeReasons: string[] = []
  let active: VtLogEntry | null = null
  let openR: number | null = null
  const price = D1.c[k].close
  const dir3 = dirOf(D3, i3)
  const dir5 = dirOf(D5, i5)

  if (setup && setup.phase === 'ACTIVE' && setup.signal) {
    const sg = setup.signal
    active = sg
    side = sg.side
    phase = 'ACTIVE'
    openR = setup.risk ? (setup.s * (price - sg.entry!)) / setup.risk : null
    if (sg.status === 'WEAKENED') {
      status = 'SIGNAL WEAKENED'
      headline = `${sg.side} SIGNAL WEAKENED — 5M price/9-21 or 15M deteriorating`
      reason = 'Alignment has deteriorated but the setup is not invalidated. Manage the open trade.'
    } else {
      status = setup.s > 0 ? 'FULL BULLISH ALIGNMENT' : 'FULL BEARISH ALIGNMENT'
      headline = sg.label
      reason = sg.reason
    }
  } else if (recentInvalid && t - recentInvalid.time < FAKE_FADE_MS && !(setup && (setup.phase === 'PENDING' || setup.phase === 'EARLY'))) {
    status = 'SIGNAL INVALIDATED'
    side = sideName(recentInvalid.s)
    headline = `${side} SIGNAL INVALIDATED`
    reason = recentInvalid.reason
  } else if (setup && (setup.phase === 'PENDING' || setup.phase === 'EARLY')) {
    const s = setup.s
    side = sideName(s)
    phase = setup.phase
    const a = lastA ?? stageA(s, i3)
    fakeReasons = lastFake
    const early = `EARLY ${side} — WAITING FOR 5M CONFIRMATION`
    if (fakeReasons.length) {
      status = 'POSSIBLE FAKE REVERSAL'
      headline = 'POSSIBLE FAKE REVERSAL — WAIT'
      reason = fakeReasons.join(' · ')
    } else if (!aOk(a)) {
      status = 'EARLY REVERSAL — NOT CONFIRMED'
      headline = `EARLY ${side} REVERSAL — NOT CONFIRMED`
      const miss = [!a.price && 'price not beyond 3M VIDYA/EMA21', !a.ma2050 && '3M EMA 20/50 not confirmed', !a.ma921 && '3M EMA 9/21 not with the move', !a.ma2150 && '3M EMA 21/50 not supporting'].filter(Boolean)
      reason = `3M VIDYA turned ${dirName(s).toLowerCase()}; missing: ${miss.join(', ')}`
    } else if (dir5 !== s) {
      status = '3M SETUP CONFIRMED'
      headline = early
      reason = '3M VIDYA + 20/50 + 9/21 + 21/50 aligned; 5M VIDYA has not turned yet'
    } else if (!ma2050(D5, i5, s) || !priceSupports(D5, i5, s)) {
      status = 'WAITING FOR 5M CONFIRMATION'
      headline = early
      reason = '5M VIDYA agrees; waiting for 5M EMA 20/50 and price beyond VIDYA line / EMA 21'
    } else {
      const r = lastRisk ?? calcRisk(s, price, D3, i3, D5, i5, cfg)
      if (r.blocker === 'SL') status = 'WAITING FOR VALID SL — NO CONFIRMED ENTRY'
      else if (r.blocker === 'TP') status = 'WAITING FOR VALID 5M TP — NO CONFIRMED ENTRY'
      else if (r.blocker === 'STRUCTURE') status = 'WAITING FOR VALID 5M STRUCTURE'
      else status = 'WAITING FOR 5M CONFIRMATION'
      headline = status
      reason = r.why || 'waiting for the next closed candle'
    }
  } else {
    const flip1 = D1.flipAt[k] >= 0 && k - D1.flipAt[k] <= 5
    const want = (x: number) => (x > 0 ? 'bullish' : 'bearish')
    // fake: a fresh 9/21 cross on 1M/3M while 21/50 and VIDYA are still the other way
    const fakes: string[] = []
    for (const tf of ['1m', '3m'] as VtTf[]) {
      const [d, i] = tfIdx[tf]
      const ci = d.pairCross['9/21'][i]
      if (ci >= 0 && i - ci <= 5) {
        const c = st(d, '9/21', i)
        if (dir3 !== c && dir5 !== c && st(d, '21/50', i) !== c) fakes.push(`${VT_TF_LABEL[tf]} EMA 9/21 crossed ${want(c)} while 21/50 and VIDYA are still ${want(-c)}`)
      }
    }
    if (fakes.length) {
      status = 'POSSIBLE FAKE REVERSAL'
      headline = 'POSSIBLE FAKE REVERSAL — WAIT'
      reason = fakes.join(' · ')
      fakeReasons = fakes
      side = sideName(st(D1, '9/21', k))
    } else if (dir3 !== 0 && dir5 !== 0 && dir3 !== dir5) {
      status = 'MIXED TREND — WAIT FOR ALIGNMENT'
      headline = status
      reason = `3M VIDYA ${dirName(dir3).toLowerCase()} but 5M VIDYA ${dirName(dir5).toLowerCase()} — no setup is being tracked`
    } else if (flip1 && dir3 !== 0 && dirOf(D1, k) === -dir3) {
      status = 'EARLY REVERSAL — NOT CONFIRMED'
      side = sideName(dirOf(D1, k))
      headline = `EARLY ${side} (1M ONLY) — NOT CONFIRMED`
      reason = '1M VIDYA flipped against 3M/5M. A 1M reversal alone is never a confirmation.'
    } else if (dir3 !== 0 && dir3 === dir5 && !(ma2050(D3, i3, dir3) && ma2050(D5, i5, dir3))) {
      status = 'MIXED TREND — WAIT FOR ALIGNMENT'
      headline = status
      reason = 'VIDYA agrees on 3M and 5M but EMA 20/50 does not'
    } else if (dir3 !== 0 && dir3 === dir5) {
      headline = 'WAITING FOR ALIGNMENT'
      reason = `Established ${dirName(dir3).toLowerCase()} trend on 3M + 5M with no fresh 3M/5M VIDYA trend start — a new setup needs one.`
    } else {
      reason = 'No clear VIDYA direction on 3M/5M yet'
    }
  }

  const lastTrigger = log.length ? Math.max(...log.map((e) => e.time)) : 0
  const rank =
    status === 'FULL BULLISH ALIGNMENT' || status === 'FULL BEARISH ALIGNMENT'
      ? 1000 + (t - (active?.time ?? t) < 3_600_000 ? 100 : 0)
      : status === 'SIGNAL WEAKENED'
        ? 700
        : status === 'WAITING FOR 5M CONFIRMATION' || status === '3M SETUP CONFIRMED' || status.startsWith('WAITING FOR VALID')
          ? 500
          : status === 'EARLY REVERSAL — NOT CONFIRMED'
            ? 300
            : status === 'SIGNAL INVALIDATED'
              ? 200
              : status === 'POSSIBLE FAKE REVERSAL'
                ? 100
                : status === 'MIXED TREND — WAIT FOR ALIGNMENT'
                  ? 20
                  : 0

  return {
    symbol: inp.symbol,
    price: inp.price,
    change24h: inp.change24h,
    status,
    headline,
    reason,
    side,
    phase,
    fakeReasons,
    tfs,
    trend15: t15.label,
    active,
    activeOpenR: openR,
    setupStartedAt: setup && setup.phase !== 'ENDED' ? setup.startedAt : null,
    setupWindowLeftMin: setup && (setup.phase === 'PENDING' || setup.phase === 'EARLY') ? Math.max(0, Math.round((windowMs - (t - setup.startedAt)) / 60_000)) : null,
    log: log.sort((x, y) => y.time - x.time).slice(0, VT_MAX_LOG),
    rank: rank + (lastTrigger ? Math.min(99, Math.max(0, 99 - Math.floor((t - lastTrigger) / 60_000 / 10))) : 0),
    asOf: t,
    warmup: i5 < 200,
  }
}

// --------------------------------------------------------------------------- backtest statistics

export interface VtStats {
  trades: number
  wins: number
  winRate: number
  avgPlannedRR: number
  avgR: number
  /** Expectancy per trade in R, after fees and slippage. */
  expectancy: number
  maxDrawdownR: number
  open: number
  totalR: number
}

/** Stats over resolved CONFIRMED entries (TP / SL / invalidation exit). Entries are ordered by signal time for the drawdown. */
export function vtStats(entries: VtLogEntry[]): VtStats {
  const done = entries
    .filter((e) => e.kind === 'CONFIRMED' && (e.outcome === 'TP' || e.outcome === 'SL' || e.outcome === 'INVALIDATED') && typeof e.rNet === 'number')
    .sort((a, b) => (a.outcomeTime ?? a.time) - (b.outcomeTime ?? b.time))
  const n = done.length
  let eq = 0
  let peak = 0
  let dd = 0
  let wins = 0
  let plannedSum = 0
  for (const e of done) {
    eq += e.rNet!
    peak = Math.max(peak, eq)
    dd = Math.max(dd, peak - eq)
    if (e.rNet! > 0) wins++
    plannedSum += e.rr ?? 0
  }
  return {
    trades: n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    avgPlannedRR: n ? plannedSum / n : 0,
    avgR: n ? eq / n : 0,
    expectancy: n ? eq / n : 0,
    maxDrawdownR: dd,
    open: entries.filter((e) => e.kind === 'CONFIRMED' && e.outcome === 'OPEN').length,
    totalR: eq,
  }
}
