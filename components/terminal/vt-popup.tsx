'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VT_PAIRS, type VtLogEntry } from '@/lib/vidyatrend'

export function fmtLevel(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (a >= 100) return v.toFixed(2)
  if (a >= 1) return v.toFixed(3)
  if (a >= 0.1) return v.toFixed(4)
  return v.toPrecision(4)
}

export function fmtTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

const short = (d: string) => (d === 'BULLISH' ? 'Bullish' : d === 'BEARISH' ? 'Bearish' : 'Neutral')

function Row({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground shrink-0 text-[11px]">{k}</span>
      <span className={cn('text-right font-mono text-xs font-semibold', cls)}>{v}</span>
    </div>
  )
}

/** Confirmed-signal popup (spec section 12). Shows only values that came from the signal itself; the test alert has none. */
export function VtPopups({ popups, onDismiss }: { popups: VtLogEntry[]; onDismiss: (id: string) => void }) {
  if (popups.length === 0) return null
  const e = popups[0]
  const demo = e.id.startsWith('demo-')
  const buy = e.side === 'BUY'
  const tone = buy ? 'border-bull text-bull' : 'border-bear text-bear'
  const bull = buy ? 'BULL' : 'BEAR'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4" role="alertdialog" aria-label={`${e.symbol} ${e.side} signal`}>
      <div className={cn('bg-card max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl border-2 p-4 shadow-2xl', tone.split(' ')[0])}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-muted-foreground font-mono text-[11px] uppercase">{demo ? 'Test alert' : 'Confirmed signal · closed candle'}</div>
            <h2 className="font-mono text-lg font-bold">
              {e.symbol.replace('USDT', '')}
              <span className="text-muted-foreground text-xs font-normal">/USDT</span>
            </h2>
          </div>
          <button type="button" onClick={() => onDismiss(e.id)} aria-label="Close" className="text-muted-foreground active:bg-accent/40 flex size-11 items-center justify-center rounded-md">
            <X className="size-5" />
          </button>
        </div>

        <div className={cn('mt-2 rounded-lg border px-3 py-2 text-center', buy ? 'border-bull bg-bull text-bull-foreground' : 'border-bear bg-bear text-bear-foreground')}>
          <div className="text-3xl font-extrabold tracking-wide">{demo ? 'TEST' : e.side}</div>
          <div className="font-mono text-[11px] font-bold uppercase leading-snug">{e.label}</div>
        </div>

        {demo ? (
          <p className="text-muted-foreground mt-3 font-mono text-[11px] leading-relaxed">{e.reason}</p>
        ) : (
          <div className="divide-border/50 mt-3 divide-y">
            <Row k="Signal type" v="VIDYA + MA Ribbon" />
            <Row k="Trigger timeframe" v={`${e.triggerTf}${e.oneMinConfirmed ? ' · 1M timing confirmed' : ' · 1M timing not confirmed'}`} />
            <Row k="3M VIDYA" v={short(e.vidya['3m'])} cls={e.vidya['3m'] === (buy ? 'BULLISH' : 'BEARISH') ? (buy ? 'text-bull' : 'text-bear') : ''} />
            <Row k="5M VIDYA" v={short(e.vidya['5m'])} cls={e.vidya['5m'] === (buy ? 'BULLISH' : 'BEARISH') ? (buy ? 'text-bull' : 'text-bear') : ''} />
            <Row k="3M EMA 20/50" v={e.ma['3m']['20/50'] === bull ? short(buy ? 'BULLISH' : 'BEARISH') : 'Opposite'} />
            <Row k="5M EMA 20/50" v={e.ma['5m']['20/50'] === bull ? short(buy ? 'BULLISH' : 'BEARISH') : 'Opposite'} />
            <Row k="EMA 9/21 (3M · 5M)" v={`${e.ma['3m']['9/21']} · ${e.ma['5m']['9/21']}`} />
            <Row k="EMA 21/50 (3M · 5M)" v={`${e.ma['3m']['21/50']} · ${e.ma['5m']['21/50']}`} />
            <Row k="15M trend" v={short(e.trend15 === 'MIXED' ? 'NEUTRAL' : e.trend15) + (e.trend15 === 'MIXED' ? ' (mixed)' : '')} />
            <Row k="Entry (trigger close)" v={fmtLevel(e.entry)} />
            <Row k={`SL · ${e.slSource ?? ''}`} v={fmtLevel(e.sl)} cls="text-bear" />
            <Row k="TP · first 5M structure" v={fmtLevel(e.tp)} cls="text-bull" />
            <Row k="Risk / reward" v={e.rr ? `1 : ${e.rr.toFixed(2)}` : '—'} />
            <Row k="1.5R · 2R reference" v={`${fmtLevel(e.tp15)} · ${fmtLevel(e.tp20)}`} />
            <Row k="Status" v="Fully confirmed (closed candles)" />
            <Row k="Signal candle closed" v={fmtTime(e.time)} />
          </div>
        )}

        <div className="mt-3 flex gap-2">
          {popups.length > 1 ? <span className="text-muted-foreground self-center font-mono text-[11px]">+{popups.length - 1} more</span> : null}
          <button type="button" onClick={() => onDismiss(e.id)} className="border-border bg-secondary ml-auto h-11 flex-1 rounded-md border text-sm font-semibold sm:flex-none sm:px-8">
            {popups.length > 1 ? 'Next' : 'Dismiss'}
          </button>
        </div>
        {!demo ? <p className="text-muted-foreground mt-2 text-[10px] leading-snug">A filter result, not a prediction or advice. Check the live price and size your own risk. Levels are calculated from closed candles at the time shown.</p> : null}
      </div>
    </div>
  )
}

export { VT_PAIRS }
