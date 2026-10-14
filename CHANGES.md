# VIDYA Trend tab: 3M start -> 5M confirmation -> 15M context -> BUY/SELL popup with SL/TP

New **Trend** tab (8th tab on phones). Engine: `lib/vidyatrend.ts` (pure, tested). It implements the spec in `attachment.txt`.

## Sequence (BUY; SELL is the exact mirror)
1. **3M VIDYA turns bullish** (a new trend start, or a 5M flip while 3M already agrees) opens a *setup*.
2. **Stage A / EARLY BUY - WAITING FOR 5M CONFIRMATION**: 3M EMA 20/50 bullish (+ price beyond the 50), EMA 9/21 and 21/50 supporting, price beyond the 3M VIDYA line and EMA 21. Logged once. Never a confirmed entry.
3. **Stage B**: 5M VIDYA bullish, 5M EMA 20/50 bullish with price beyond the 50, 3M and 5M VIDYA agree, 3M 20/50 supports, 5M price beyond VIDYA line and EMA 21, 15M not strongly opposing, and valid risk levels.
4. **Stage C**: exactly **one** confirmed entry per setup: `VIDYA + MA BULLISH TREND ENTRY`, upgraded to `FULL VIDYA TREND ALIGNMENT + MA CONFIRMATION - BUY` when 1M also confirms (1M VIDYA, 1M EMA 9/21, close beyond EMA 21). 1M never overrides a 3M/5M disagreement.
- **Stop-loss**: 5M VIDYA boundary (lower band for buys, upper band for sells) minus an ATR(5M) buffer. Fallbacks, in order: 3M VIDYA boundary, latest confirmed 5M swing. Setting "SL from 3M" flips the order; "beyond 5M swing" widens to the swing if that is further. A stop tighter than 0.2 ATR or wider than the risk cap (default 6 ATR) is unsuitable. None valid -> `WAITING FOR VALID SL - NO CONFIRMED ENTRY`.
- **Take-profit**: first significant 5M swing high/low beyond the entry (>= 0.5 ATR away). None, or reward:risk below the minimum (default 1:1) -> `WAITING FOR VALID 5M TP - NO CONFIRMED ENTRY`. 1.5R / 2R are shown as references only; the TP is never pushed past structure.
- **15M context**: VIDYA + EMA 20/50 + 50/100 + 100/200 vote; only a strongly opposite 15M (opposite label AND opposite VIDYA) blocks. EMA 100/200 is context, never a required cross.
- **Fake-reversal filter**: 15M strongly opposed, price falling back through the 3M VIDYA line, 9/21 crosses while 21/50 and VIDYA are still the other way, flip-back before confirmation. Statuses shown: `POSSIBLE FAKE REVERSAL - WAIT`, `MIXED TREND - WAIT FOR ALIGNMENT`, `EARLY REVERSAL - NOT CONFIRMED`, `3M SETUP CONFIRMED`, `WAITING FOR 5M CONFIRMATION`, `FULL BULLISH/BEARISH ALIGNMENT`, `SIGNAL WEAKENED`, `SIGNAL INVALIDATED`, the SL/TP/structure waits.
- **Weakened**: price back through the 5M VIDYA line, 5M 9/21 turning, or 15M turning strongly against. **Invalidated** (trade exits at that candle close): 3M or 5M VIDYA, or 3M/5M EMA 20/50, turning against the trade.
- **Dedupe**: one early warning and one confirmed signal per setup; a new alert needs a new 3M (or 5M) VIDYA trend start after the previous setup ended. A signal's time, entry, SL and TP are frozen when first logged.
- Every reading uses CLOSED candles only (signals are "after candle close"); developing 9/21 etc. crosses are labelled DEVELOPING / CONFIRMED in the crossover table.

## UI
- **Scanner**: compact cards (no wide tables): status banner, Entry/SL/TP/R:R, 1M/3M/5M/15M VIDYA (direction, NEW/CONTINUING/WEAKENING/INVALIDATED, flip age, price vs bands, momentum), expandable EMA ribbon with all five crossover pairs per timeframe (9/21, 20/50 "Middle", 21/50, 50/100, 100/200 "Strong": direction, cross time, developing/confirmed, VIDYA agrees, price confirms). Search, filters, sort.
- **Log**: early warnings, confirmed, invalidated and rejected setups, saved in this browser (frozen entry data). Filters: VIDYA-only, EMA 9/21, 21/50, 20/50, VIDYA + MA, full 3M+5M, 15M aligned, 3M SL, 5M SL, plus status. Stats: tested trades, win rate, average planned R:R, expectancy (R, after 0.05% fee + 0.02% slippage per side), max drawdown (R), open trades.
- **Settings**: SL source, ATR buffer, minimum R:R, widest stop, setup window, swing stop, popup / sound / notification toggles, notification permission, test alert (placeholder values only).
- **Popup** on every tab with all the fields from the spec, rising tones for BUY / falling for SELL, browser notification where allowed.

## Technical
- `/api/reversal?vt=1&sl=..&buf=..&rr=..&swing=..&risk=..&win=..` now also fetches native **15m** klines (300) in the same pass and returns `vt` rows; existing `rows` / `maRows` are unchanged. That adds 100 kline requests per 45 s refresh (weight 2 each); lower `MAX_COINS` in the route if Binance rate limits.
- `lib/indicators.ts`: added `vidyaBandSeries()` (per-bar line + both bands). Existing functions behave the same.
- Backtest = replay of every 1M bar of the loaded history (about 5.7 h per coin) with only already-closed candles visible (`scripts/test-vidyatrend.ts` checks that a later run reproduces the same signals, entries, SL and TP). Entry = trigger candle close; stop assumed first if stop and target are both touched in one candle. The log accumulates across sessions in this browser; a trade that left the data window while open is marked unresolved and excluded from stats.
- Tests: `npx tsx scripts/test-vidyatrend.ts` (bullish/bearish reversals, fake bounce, 15M filter, steady trend, one-alert-per-setup, rule invariants, no look-ahead, stats) and `npx tsx scripts/render-vidyatrend.tsx` (server-render smoke test + log-merge freezing).

## Not done / limits
- Not run against live Binance data (this workspace cannot reach it) and `next build` was not run here for the same reason (it needs Google Fonts); `tsc --noEmit` is clean. Check the first live refresh.
- Volumatic VIDYA is the project's existing implementation (CMO-adaptive EMA + SMA smoothing + ATR(200) x 1.5 flip bands), not a line-for-line copy of the original Pine script. Here, the "VIDYA trend boundary" for stops is the lower/upper flip band.
- True background push (app closed) needs a push server and keys; alerts work while the page is open.
- With real volatility the VIDYA band can sit far from price in fast moves, so the risk cap rejects many entries; tune "Widest stop" and "Setup window" after watching live behaviour. Signals are filters, not predictions, and nothing here is guaranteed.

---

# TradingView indicator added (tradingview/ folder)

- `tradingview/early_reversal_system.pine`: Pine Script v6 indicator. EMA 9/21/50/200 + Volumatic VIDYA (14 / 9 / 1.5) early-reversal system for the 1M chart, with the 15M Volumatic VIDYA as the strength / bigger-trend check. Dashboard columns 1M, 3M, 5M, 15M. Non-repainting (confirmed bars only), with alerts.
- `tradingview/EARLY_REVERSAL_README.md`: every condition explained, the 15M check modes, the score, known differences from the original Volumatic VIDYA, and 1M scalping starting settings.
- Status: syntax-parsed only. It has not been compiled in TradingView or backtested; if TradingView shows an error on paste, send the exact message and line.
- The web dashboard (everything outside `tradingview/`) is unchanged from the v3 MA + VIDYA zip.

---

# MA Reversal tab v3: EMA 9/21/50/200 + Volumatic VIDYA early reversals

New **MA Rev** tab (7th tab on phones). Catches early reversals from EMA 9/21 while EMA 50/200 are still pointing the OLD way. Engine: `lib/mareversal.ts`. The earlier "Reversal" tab (VIDYA flip ladder) is unchanged.

## Roles
EMA 9 = early trigger | EMA 21 = confirmation | EMA 50 / 200 = context only (never required, shown as OLD while they still point the old way) | VIDYA 14 / 9 / 1.5 = momentum filter | swing-point structure (higher lows / lower highs, swing-high/low break) = confirmation.

## Signals (per timeframe and overall)
- STRONG EARLY BUY/SELL: 9/21 crossed, price closed beyond BOTH 9 and 21, EMA 9 slope with the move, VIDYA fully aligned (price beyond the line, line sloping the right way, momentum aligned), and HL/LH structure.
- EARLY BUY/SELL: 9/21 crossed, price beyond the 21, EMA 9 slope with the move, VIDYA at least turning that way. 50/200 may still be the old trend.
- CONFIRMED BUY/SELL: stage 3 (above + EMA 50 flat or following) or stage 4 (9>21>50>200 / mirror) with VIDYA aligned and price not pulled back through the 21.
- WEAK REVERSAL: 9/21 crossed but VIDYA is not yet confirming. A bare crossover never produces EARLY/CONFIRMED.
- POSSIBLE FAKE REVERSAL: price closes back through both MAs within 10 candles of the cross, or the cross reverses within 8 candles, or VIDYA stays strongly opposite and price is not clear of 9/21.
- Stages: S0 old trend, S1 early, S2 confirming (+ structure, 21 not against), S3 trend confirmed (+ 50 flat/following), S4 full alignment.
- Every signal carries a plain-English reason ("9 crossed above 21 3 candles ago + 9 rising + price above 9/21 + 21 rising + VIDYA bullish - 50/200 = OLD TREND").

## Multi-timeframe (1M / 3M / 5M)
- Each timeframe is evaluated independently: 9/21/50/200 slope arrows, VIDYA state + momentum + volume delta, 9/21 cross age, structure, stage and signal.
- Overall headline relates every timeframe to the strongest FRESH signal: REVERSAL / CONFIRMED / WEAK / SUPPORT / COUNTER-TREND, plus a risk tag from the higher timeframes (e.g. "1M EARLY REVERSAL - HIGH RISK - 1M REVERSAL - 3M COUNTER-TREND - 5M COUNTER-TREND"). A 1M reversal is NOT rejected because 5M has not turned.
- An old, established trend on 3M/5M (full alignment with no recent cross) is flagged ESTABLISHED and ranked below any fresh reversal, so it cannot hide one.
- A CONFIRMED signal whose higher timeframes do not support it says so ("HIGHER TFs NOT CONFIRMING").

## Technical
- Closed candles only. EMA slope is measured in ATR(14) units per bar (9: 2 bars / 0.03, 21: 3 / 0.02, 50: 5 / 0.01, 200: 10 / 0.004) and VIDYA slope 2 bars / 0.02: these thresholds are the tuning knobs, at the top of `lib/mareversal.ts`.
- Swing pivots use 2 candles each side (confirmed 2 candles late); structure looks back 40 candles.
- VIDYA momentum = 9-bar CMO of closes + buy/sell volume balance of the last 9 candles (candle-direction volume, as in the rest of the project).
- `/api/reversal` now also returns `maRows`, computed from the SAME native 1m/3m/5m candles in the same pass, so there are no extra Binance requests. EMA 200 on 3M/5M uses 300 bars (small residual start-up bias).
- Tests: `npx tsx scripts/test-mareversal.ts` (bullish and bearish V-reversals with 50/200 still old, fake bounce, steady trend, and an invariant check that no early/confirmed signal exists without VIDYA, price and EMA 9 slope agreeing) and `npx tsx scripts/test-reversal.ts`.
- Validated on synthetic candles and a server render only; not yet on live Binance data. Signals are filters, not predictions: nothing here is guaranteed or risk-free.

---

# Reversal tab v2: fake-reversal filters

Three filters added to `lib/reversal.ts` (they reduce false signals, they cannot remove them, and each one delays or withholds some real signals):
- **Flip-back guard / FAILED tag:** if a timeframe flips and then flips straight back (1M within 15 candles, 3M within 8, 5M within 6), the attempt is dropped and the card shows "FAILED SELL/BUY REVERSAL" for 30 minutes. A flip-back also removes that timeframe from any running setup.
- **Volume check:** buy/sell volume since the 1M flip (close>open vs close<open candles) must lean the reversal's way by at least 5%, measured over at least 5 candles. Without it, SELL/BUY TRIGGER and STRONG are withheld (status stays EARLY, stage "EMA CROSSED - VOLUME NOT CONFIRMING YET"). A TRIGGER can drop back to EARLY if volume turns against it.
- **Chop filter:** 4 or more 1M VIDYA flips in 60 minutes marks the coin CHOPPY and suppresses EARLY/TRIGGER (3M/5M confirmations still work).
- UI: new CHK row on cards (and in the table) showing VOL %, CHOPPY and FAILED tags; failed setups get an amber banner.
- Tests: `npx tsx scripts/test-reversal.ts` now also covers whipsaw, low-volume and zig-zag markets (18 checks, all passing on synthetic data; not yet validated on live Binance candles).

---

# Reversal tab: 1M / 3M / 5M Volumatic VIDYA reversal tracker (mobile-first)

## What it does
- New **Reversal** tab (bottom bar on phones, top tab on desktop). Phones/tablets get vertical cards (no horizontal scroll, 44px+ touch targets); desktop (lg+) gets a table.
- Per coin and per timeframe (1M, 3M, 5M, each tracked independently, 5M is never assumed to be "the" higher trend): current VIDYA direction, previous direction, direction change, time since it changed, and a state: BULLISH / BEARISH / NEUTRAL / TURNING BULLISH / TURNING BEARISH.
- Main status: WAIT, EARLY BUY/SELL, BUY/SELL TRIGGER, 3M and 5M BUY/SELL CONFIRMED, STRONG BUY/SELL, plus a stage line ("3M REVERSAL DEVELOPING", "AWAITING 5M CONFIRMATION" ...).
- Sequence line shows the order the timeframes flipped (1M > 3M > 5M = lower-first, 5M > 3M > 1M = higher-first).
- Score (1M VIDYA +1, 1M EMA 9/21 cross +1, 3M +2, 5M +3, +1 for 2+ timeframes, +1 for all 3 = max 9) mapped to LOW / MEDIUM / HIGH / STRONG. STRONG is only possible for STRONG BUY/SELL.
- Search, filter (All / Buy / Sell / Early), sort (Strength / Newest / A-Z), "show more" paging.

## Rules (see lib/reversal.ts)
- Parameters: VIDYA length 14, momentum 9, band distance 1.5 (ATR(200) bands + SMA-15 smoothing kept from the existing VIDYA); EMA 9/21 on 1M.
- A reversal only counts if 1M, 3M and 5M were ALL on the opposite side just before its first flip, and that flip happened within the last 120 minutes. One timeframe flipping while the others disagree gives no signal.
- EARLY = 1M VIDYA flipped. TRIGGER = EARLY + 1M EMA 9 crossed EMA 21 the same way (cross may be up to 3 candles before the VIDYA flip). 3M / 5M CONFIRMED = that timeframe's VIDYA flipped as well. STRONG = all three flipped + the 1M EMA cross.
- TURNING = VIDYA direction still the old one, but price closed back through the VIDYA line and the line's slope reversed. It is a heads-up only and never scores.
- All readings use CLOSED candles only (the forming candle is dropped), so a status does not repaint inside a candle.
- A long-running trend with no fresh reversal shows WAIT ("TREND ALIGNED BEARISH - NO FRESH REVERSAL"), not a sell/buy signal.
- A direction adopted at the first evaluable bar (no flip seen in the loaded candles) is shown as "at least Xh", never as a fresh change.

## Files
- NEW `lib/reversal.ts` (pure engine), `app/api/reversal/route.ts`, `hooks/use-reversal.ts`, `components/terminal/reversal-panel.tsx`, `scripts/test-reversal.ts`.
- CHANGED `lib/indicators.ts` (added `vidyaTrendSeries()` and an opt-in `seed` option; default behaviour of every existing function is unchanged), `components/terminal/terminal.tsx` (new tab, 6-column bottom bar).
- Data: `/api/reversal` fetches native Binance 1m (400), 3m (300), 5m (300) klines for the top 100 USDT-M perpetuals by volume, cached 45s (the existing /api/market cache is 5 min, too slow for 1M). That is 300 requests per refresh (weight 2 each); lower MAX_COINS in the route if you hit rate limits.
- Test: `npx tsx scripts/test-reversal.ts` (synthetic candles: full SELL and BUY ladders, steady trend stays WAIT, epoch alignment, forming-candle drop).

Signals only, nothing here is guaranteed or risk-free.

---

# VIDYA BUY / SELL / NEUTRAL change tracking + mobile layout

## VIDYA signal changes
- `lib/indicators.ts`: `vidya()` split into a shared core (output verified identical to before). New `vidyaSignalSeries()` gives BUY/SELL/NEUTRAL for every candle in one pass, and `summarizeSignalHistory()` turns it into "current state + last 6 changes".
- The live per-timeframe signal now comes from the same series, so the grid and the history can never disagree (verified identical to the old `bucketSignal` on 270 random series).
- `CoinSignal` / `BtcTrend` gain `signalHistory` per timeframe (1m/3m/5m/15m/1h). History is rebuilt from real candles on each refresh, so changes appear immediately without leaving the page open.
- New **VIDYA** tab (`components/terminal/vidya-panel.tsx`): pick a timeframe, filter Buy / Sell / Neutral, "New only" (changed within the last 3 candles), search; most recent change on top; tap a row for every timeframe's last 6 changes and an "Open in Terminal" button.
- Timeframe cards in the terminal now show the last change (e.g. `NEUTRAL -> BUY`, `16m ago`).
- Note: the newest candle is still forming, so a change on "this candle" can still revert.

## Mobile
- Bottom tab bar on phones (Terminal / VIDYA / Ribbon / Journal / Signals); desktop keeps the top tabs.
- Terminal tab on phones switches between Coins / BTC / Bot instead of stacking everything.
- Compact B/S/N badges in tight rows, 2-column timeframe cards, shorter top bar, safe-area padding for iPhone notch + home bar.
- Trade Journal history scrolls sideways instead of squashing; MA Ribbon keeps the coin column pinned.
- `public/sw.js` (v2): page loads are now network-first, so an installed phone app picks up new deploys instead of showing the old cached shell.

---

# Supertrend replaced by Volumatic VIDYA + MA Cross (9/21/50/200)

- `lib/indicators.ts`: `supertrend()` removed. New `vidya()` (CMO-adaptive VIDYA 10/20, SMA-15 smoothing, ATR(200) x 2 flip bands, buy/sell volume + delta % per trend leg) and `maCross()` (EMA 9/21/50/200, state + candles-since-cross for 9/21, 21/50, 50/200).
- `lib/signals.ts`: bucket vote = VIDYA direction + at least 2 of 3 confirmations (RSI, MACD, MA cross alignment; `MIN_CONFIRMATIONS`). Score budget stays 100: VIDYA maturity 10 + MA cross alignment 5 (was Supertrend maturity 15).
- Types/UI: `supertrend` field replaced by `vidya` and `maCross` on CoinSignal/BtcTrend; sidebar shows VIDYA, MA Cross and VIDYA volume delta; coin header shows VIDYA and MA Cross chips.
- The 1H confluence gate (EMA200, EMA stack, SMA50/200, MACD, Ribbon) is unchanged.

---

# What was actually wrong, and what changed

## Root causes found
1. **Not using Binance at all.** `/api/market` was pulling from CoinGecko (spot market, top 100 by market cap), not Binance Futures.
2. **No real Supertrend.** The "Supertrend" was actually EMA+RSI+slope voting on fake mini price windows — never an ATR-based Supertrend. That's why it looked frozen: it wasn't a real indicator to begin with.
3. **Fake timeframes.** CoinGecko only gives 7-day hourly data, but the code sliced it into tiny windows and labeled them "1M/3M/5M" as if they were 1-minute candles. Completely mislabeled.
4. **Silent fake data fallback.** If CoinGecko failed or rate-limited, the app quietly generated randomized synthetic prices and displayed them as if real (`live:false` flag existed but wasn't obvious in the UI).
5. **Broken repo structure** (in the *other* repo you first sent me) — files were flat when imports expected `app/`, `lib/`, `components/` folders. That repo would fail to build from a fresh clone.
6. **No trade-freeze / auto SL-TP.** This specific repo (`new-project-my`) didn't have the auto-close-on-SL/TP feature yet — I ported it over from your other repo, where it did already work correctly.

## What's fixed now
- **Real Binance USDT-M Futures data**: `lib/binance.ts` pulls the full list of live PERPETUAL/USDT contracts (250-300+, exceeds your "100+" ask) plus real 1H candles.
- **Real ATR-based Supertrend**: `lib/indicators.ts` implements the actual algorithm (period 10, multiplier 3) with proper band-flip logic — verified with a runtime test that it correctly flips direction when price action actually reverses.
- **Honest timeframes**: relabeled to `4H / 12H / 1D / 2D`, built by resampling real 1H candles (not fake slices).
- **No more fake data**: if Binance is unreachable, the UI now says so explicitly ("DATA UNAVAILABLE") instead of quietly showing synthetic numbers.
- **Trade freeze + live PnL**: entry/stop/target lock the moment you log a trade; only price and P&L update live every 15s (unchanged behavior, now fed by real Binance prices).
- **Rate-limit safe**: signal/Supertrend recompute is cached for 3 minutes (klines are heavy); price ticks refresh every 15s via one cheap bulk endpoint.
- **PWA / mobile install**: added `manifest.json`, a minimal service worker, and app icons so you can "Add to Home Screen" on iOS/Android and it opens like a native app.

## Honest limitation
"Accurate signals only" isn't something any system can promise — I tightened the confluence logic (Supertrend + RSI + MACD must agree, and 3-of-4 timeframes must align) so it should throw fewer, higher-quality signals, but losses will still happen. Treat the score as a filter, not a guarantee.
