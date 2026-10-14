# Early Reversal System (Pine Script v6)

`early_reversal_system.pine` — EMA 9/21/50/200 + Volumatic VIDYA (14 / 9 / 1.5), built for the **1M chart**, with the **15M Volumatic VIDYA** as the strength / bigger-trend check. Dashboard columns: **1M · 3M · 5M · 15M**.

## Status — read this first

- **Syntax-parsed, not compiled in TradingView, not backtested.** I had no TradingView here. The file passes a Pine grammar parser and my own consistency checks (argument counts, tuple sizes, undefined names). Paste it into the Pine Editor and press *Add to chart*. If TradingView reports an error, send me the exact message and line and I will fix it.
- Every threshold below is a starting value, not an optimised one. Nothing here predicts price or guarantees a result.

## Install

1. TradingView → Pine Editor → paste the whole file → *Save* → *Add to chart*.
2. Use a **1-minute** chart. On a chart of 15M or higher the 15M check switches itself off (the chart is not below 15M).
3. Alerts: *Create Alert* → condition = this indicator → pick *EARLY BUY*, *EARLY SELL*, *STRONG EARLY REVERSAL*, *BUY RETEST*, *SELL RETEST*, *REVERSAL INVALIDATED*, etc. → trigger **Once Per Bar Close**.

## The four stages (per side)

| Stage | Chart label | What must be true | Is it an entry? |
|---|---|---|---|
| 1 | 🔍 REVERSAL WATCH | Price is still on the old side (below EMA21 / EMA9<21 for a buy) **and** at least `watchMin` (2) of 4 exhaustion signs: EMA 9 slope flat or turning; no new extreme for 3+ bars of the last 10; CMO moving against the old trend; opposite volume delta ≥ 10 %. | No |
| 2 | 🟡 REVERSAL FORMING (or **AGGRESSIVE SETUP — WAIT FOR CONFIRMATION**) | EMA 9 turning toward 21 **and** price back on the right side of EMA 9 **and** (an initial higher low / lower high **or** the VIDYA line no longer pointing the old way). *Aggressive* adds: price already past EMA 21, CMO improving, initial structure shift. | No |
| 3 | ⚡ EARLY BUY / ⚡ EARLY SELL | All of the mandatory rules below, plus filters and score ≥ 70. | Yes |
| 4 | 🔥 STRONG EARLY BUY / SELL | Stage 3 is running **and** higher low (or lower high) **and** a break of structure or a higher high / lower low, **and** a retest of the EMA 9/21 zone held, **and** strong CMO with volume delta in the same direction, **and** score ≥ 85, **and** (default) the 15M VIDYA supports. | Yes (upgrade) |

### Mandatory EARLY rules (all five)

1. 9/21 crossed in the right direction within the last `crossLookback` (10) bars **and** 9 is still on the right side of 21.
2. The **closed** candle is beyond **both** EMA 9 and EMA 21.
3. EMA 9 slope (ATR-normalised, 2 bars) is in the new direction.
4. Confirmed structure: a higher low / lower high from a **confirmed** swing pivot newer than 40 bars, **or** a close beyond the last confirmed swing high / low.
5. VIDYA: **Strict mode (default)** = trend state has flipped, line slope is in the new direction, price is on the right side of the line. *Early mode* also accepts "line turned + price reclaimed" before the band flip.

EMA 50 and EMA 200 are **never** required. They are shown as context (Bull/Bear and slope arrow) and used only as obstacles for the optional R:R filter.

### Filters that can still stop an EARLY

- **Fake-reversal filter** (below), **stop too wide** (> 3 ATR), optional **R:R to the nearest EMA 50/200**, **cooldown** (10 bars), **score < 70**, **15M gate** (if you chose a blocking mode).
- **Extension filter:** distance from EMA 21 and from the VIDYA line, in ATR. Above 1.5 ATR, or a reversal candle larger than 2 ATR, the setup is valid but late → **⏳ WAIT FOR PULLBACK — LATE ENTRY**, and it is armed for a retest instead of being chased.

## 🟢 BUY RETEST / 🔴 SELL RETEST

After an entry (or an armed late setup): price pulls back into the EMA 9/21 zone (± 0.25 ATR), the structural invalidation level is intact, VIDYA still supports, and a **closed** candle shows rejection (bullish/bearish body, closes beyond EMA 9, and either a ≥ 30 % rejection wick or a close beyond the previous bar's high/low). Max 2 retests per reversal, 5 bars apart. An armed late setup enters through its first retest.

## ⚠️ POSSIBLE FAKE REVERSAL and ❌ REVERSAL INVALIDATED

Possible fake (shown once, on the first bar it appears) when a 9/21 cross is recent **and** any of: price closes back through both EMAs; the cross reverses; VIDYA stays strongly opposite (state, slope and price side); the expected higher low / lower high fails; the cross happened in low momentum (|CMO| < 15 and a tight 20-bar range) without follow-through; 3+ crosses in 20 bars (chop); the VIDYA state flipped 2+ times in 30 bars.

Invalidated (once, then the reversal is closed and a cooldown starts) when a running or armed reversal loses its structural level, **or** VIDYA state and price both turn against it, **or** 9/21 crosses back and price closes beyond both. A reversal also expires silently after 80 bars. The same reversal never produces a second EARLY.

## The 15M Volumatic VIDYA check

The 15M cell is read from its last **closed** 15M bar. For a reversal in direction *d* it gives a support share 0–1: VIDYA trend state in *d* (35 %), line slope in *d* (20 %), price on the *d* side of the line (15 %), strong CMO in *d* (15 %), volume delta in *d* (15 %). **SUPPORTS** ≥ 70 %; **OPPOSES** when state, slope and price side are all against *d*; otherwise **DEVELOPING**.

Setting *How the 15M VIDYA is used* (group 3):

| Mode | Effect |
|---|---|
| Off | Ignored |
| Score only | Only adds to the score (weight 25 of 100) |
| **Tag EARLY · require for STRONG** (default) | EARLY is allowed against the 15M trend but labelled **COUNTER-TREND**; STRONG needs 15M support |
| Block EARLY when 15M opposes | No EARLY while the 15M VIDYA clearly opposes |
| Require 15M support for everything | EARLY and STRONG both need 15M support |

## Confidence score (transparent, normalised to 100)

Default points: EMA 9/21 confirmation 15 · close beyond both EMAs 10 · EMA 9 slope 10 · VIDYA state 15 · VIDYA slope + volume 10 · structure 15 · **15M VIDYA support 25** (the larger weight reflects your 15M emphasis; the spec's original was 5). Weights are inputs and are re-normalised to 100 whatever you set. Bands: **85+ strong · 70–84 confirmed early · 50–69 developing · < 50 none**. The score is a confidence measure, **not a probability of profit**, and cannot override a missing mandatory rule. When the chart is 15M or higher, the 15M weight is dropped and the rest is rescaled.

## Dashboard (top-right by default)

Rows: EMA 9 dir · EMA 21 dir · EMA 50 ctx · EMA 200 ctx · 9/21 align · VIDYA dir · VIDYA momentum (Strong/Weak, recent volume Δ / since-flip Δ) · Structure (HH/HL/LH/LL) · Stage (S0–S4) · Signal · Score, then one **overall** line (spec scenarios A–D, with the 15M VIDYA as the strength check), for example:

- `⚡ 1M EARLY BUY — 15M VIDYA SUPPORTS (real strength) — 3M SUPPORT DEVELOPING — 5M COUNTER-TREND`
- `⚠️ 1M COUNTER-TREND REVERSAL — HIGHER TIMEFRAMES OPPOSE (confidence reduced)`
- `⏳ BULLISH ALIGNMENT — WAIT FOR PULLBACK` (all four aligned and extended; never an entry recommendation)

## Risk information (label tooltip, hover the label)

Score, 15M relation, **structure stop** (swing extreme of the last 12 bars ± 0.1 ATR) and its distance in ATR, **ATR stop reference** (1.5 ATR), **R:R** to the nearest EMA 50/200 obstacle, and the extension. These are references for your own plan, not orders.

## Non-repainting design

- Labels and alerts fire only when `barstate.isconfirmed` is true; the state machine is the same on historical and live bars.
- Swing pivots are used only after confirmation (`pivR` bars later) and are never back-dated to an earlier candle.
- 1M/3M/5M/15M cells come from `request.security(..., f_engine_prev(), lookahead_on)`: the value of the last **closed** bar of that timeframe, so nothing leaks from the future.
- On a chart above 1M the lower-timeframe cells show the last closed lower-timeframe bar at your chart bar's close. The engine still runs on every bar of that timeframe, but you only *see* a sample. Use the 1M chart for 1M signals.
- Each event is a one-bar pulse protected by the state machine and cooldown, so alerts do not repeat for the same reversal.

## Volumatic VIDYA — what is and is not identical to the original

I did **not** have the original script's source. This is a re-implementation from the logic it is publicly known for, and it differs in these ways:

- Same idea: CMO-adaptive average (alpha = 2/(length+1) scaled by |CMO| over the momentum window) → SMA smoothing (15) → bands = line ± ATR(200) × multiplier → trend state flips on a close beyond a band → buy/sell volume accumulated since the last flip.
- **Seeding:** the raw line starts from the first close (the original starts from 0 and needs hundreds of bars to converge). Optionally the trend state is also seeded from the first bar with a valid ATR (input *Seed trend…*, on by default).
- **Volume delta:** "candle-direction" volume (close > open counts as buy volume, close < open as sell volume); no exchange taker-buy data. The dashboard shows a recent-window delta (9 bars) and the since-flip delta. I have not confirmed this matches how the original splits volume.
- It is not a simplified moving average. If your chart's original Volumatic VIDYA looks different at the edges, compare after ~500 bars of warm-up; any remaining difference is in the details above.

## Recommended starting settings for 1M scalping (to optimise by backtesting)

Defaults already match most of these. Change these inputs first:

| Input | Start value | Why / what to test |
|---|---|---|
| 9/21 cross valid for | 8 | Fresher crosses only; test 6–12 |
| Swing pivot left / right | 3 / 2 | Right = confirmation delay; 1 is faster but noisier |
| Cooldown | 8 | Test 5–15 |
| Chop: crosses / window | 3 / 20 | Lower the count to 2 on very choppy coins |
| Extension normal / excessive | 0.75 / 1.5 ATR | Test 1.0 / 2.0 on fast coins |
| Max stop distance | 2.5 ATR | Smaller = fewer but tighter setups |
| Min EARLY / STRONG score | 70 / 85 | Test 65 / 80 and 75 / 90 |
| 15M VIDYA use | Tag EARLY · require for STRONG | Compare against "Block EARLY when 15M opposes" |
| VIDYA confirmation | Strict | Switch to Early only if Strict is too late; expect more fakes |

**How to test it properly:** run each setting on the same dates across several coins, record outcomes with fees and slippage, and judge on many trades. A handful of good-looking signals proves nothing.

## Known limits

- The VIDYA band flip needs a real move beyond 1.5 × ATR(200). In slow, small reversals Strict mode may flag late or not at all. That is the trade-off for fewer fakes.
- 1M history on TradingView is limited by plan; EMA 200 and ATR(200) need warm-up bars before the first signals are trustworthy.
- Signals are filters on past candles. They can and will fail; size positions and place stops yourself.
