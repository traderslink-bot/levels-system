# Automatic Watchlist Scoring System

**Detailed reference for the active `levels-system` watchlist selector**

**Evidence date:** July 23, 2026  
**Primary implementation:** `src/lib/auto-watchlist/auto-watchlist-selector.ts`  
**Yahoo completed-session average:** `src/lib/stock-context/yahoo-client.ts`

## The most important distinction

There is not one score that automatically adds a ticker.

The selector uses this complete pipeline:

```text
Discovery
  -> current-session enrichment
  -> hard qualification gates
  -> base qualification score
  -> minimum-score requirement
  -> dynamic ranking score
  -> slot-survival score
  -> repeated-pass confirmation
  -> fresh pre-activation revalidation
  -> Main/post-market capacity and replacement rules
  -> ongoing retention and follow-up
```

A ticker can have a high numeric score and still be rejected because a hard requirement failed. It can qualify and still not be added because it has not passed twice, its final refresh failed, the relevant watchlist is full, a quota was exhausted, or it cannot beat a protected incumbent.

## July 23 relative-volume enhancement

The following completion note was supplied by the user and is preserved verbatim:

> Implemented and live.  
> Regular/premarket now use Yahoo’s completed-session 3-month average volume.  
> Existing Nasdaq session volume remains the numerator.  
> Post-market scoring is unchanged.  
> Yahoo averages are cached for 12 hours to minimize resource use.  
> Runtime restarted successfully; backup saved at `runtime-restart-backups/20260723-113646`.

This changes the denominator used for regular-hours and premarket relative-volume scoring:

```text
relative volume =
  current Nasdaq session volume
  / Yahoo completed-session three-month average volume
```

The current Nasdaq session volume remains the live numerator. The Yahoo denominator is calculated from completed sessions so today's still-developing session does not contaminate its own baseline.

The result is cached in memory for 12 hours to avoid repeatedly downloading and recalculating the same historical average.

Post-market scoring deliberately does not use this new denominator and remains unchanged.

## 1. Discovery: how a ticker reaches scoring

Before a ticker can be scored, it must be discovered.

The selector combines:

- Nasdaq's broad US-stock screener.
- Nasdaq Most Advanced.
- Nasdaq Most Active.
- StockAnalysis premarket gainers.
- StockAnalysis regular-hours gainers.
- StockAnalysis after-hours gainers.
- TradingView gainers for the applicable session.
- Yahoo small-cap and aggressive-small-cap screens as fallbacks.
- A rotating exploration lane during premarket and post-market.

The rotating lane exists because a ticker that was quiet during the prior session can become active during extended hours before it appears reliably in every public gainer feed.

The broad exchange universe is initially narrowed toward:

- Likely common equities.
- Market capitalization no greater than $100 million.
- Price inside the configured range.
- Usable session volume where the source supplies it.

During premarket and post-market, the selector builds a probe pool from:

- Current exchange movers.
- High dollar-volume names.
- High percentage gainers.
- A rotating portion of the broader eligible common-stock universe.

The selector can discover roughly 50 candidates. It normally fully enriches the leading 12 candidates. Existing active and follow-up tickers are appended even when they have fallen out of the leading discovery list so retention is based on fresh evidence rather than disappearance from a public screener.

### Discovery is not rejection

If a ticker does not appear in the selector's evaluated decisions, it did not fail scoring. It was never scored.

A missing ticker can therefore mean:

1. No discovery source found it.
2. It was found but did not reach the fully enriched candidate subset.
3. Its session-activity lookup failed.
4. It failed a hard qualification gate.
5. It scored below the active minimum.
6. It qualified but lacked repeated-pass confirmation.
7. It qualified but lost the capacity or replacement competition.

## 2. Candidate enrichment

For each evaluated candidate, the selector attempts to obtain:

- Current session price.
- Percentage gain.
- Session share volume.
- Main-session share volume where applicable.
- Session dollar volume.
- Last-15-minute share volume.
- Last-15-minute dollar volume.
- Latest trade time and quote age.
- Volume acceleration.
- Market capitalization.
- Float.
- Shares outstanding when float is unavailable.
- Three-month completed-session average volume for regular and premarket scoring.
- Authoritative common-stock verification.
- Recent press-release catalyst context.
- Gainer-source and top-five-source evidence.
- Nasdaq trading-halt information when activity disappears.

Yahoo and Finnhub provide company-size and share-structure enrichment. When authoritative EODHD security-master enforcement is enabled, candidates must also be verified as common stock.

## 3. Hard qualification gates

Points cannot compensate for a failed hard gate.

### Trading window

Automatic scanning requires:

- A valid trading day.
- Time between 4:00 a.m. and 8:00 p.m. Eastern.
- The current session to be enabled.

Premarket, regular hours, and post-market are separate sessions.

### Price

The active saved configuration uses:

```text
$0.0999 through $20
```

The source default minimum is $0.25, but the saved operational value overrides it.

### Market capitalization

Market cap must:

- Be available.
- Be no greater than $100 million.

Missing market capitalization is a rejection rather than an assumption that the company is probably small.

### Percentage gain

The candidate must be up at least 10%.

Liquidity, low float, or a catalyst cannot compensate for a move below the configured gain floor.

### Session share volume

For premarket and regular-hours candidates:

```text
at least 500,000 session shares
```

For post-market candidates:

```text
at least 100,000 after-hours shares
```

Post-market uses after-hours activity. A large regular-session total cannot masquerade as active after-hours trading.

### Session dollar volume

All sessions currently require:

```text
at least $250,000 session dollar volume
```

Dollar volume measures actual capital participation. The same raw share count has very different meaning at $0.10 and $3.00.

### Fresh last-15-minute activity

Recent activity data must be available, and the latest trade cannot be more than 10 minutes old.

Minimum last-15-minute dollar volume:

| Session | Minimum |
|---|---:|
| Premarket | $25,000 |
| Regular | $50,000 |
| Post-market | $25,000 |

A ticker can have millions in cumulative session volume and still fail if current trading has gone quiet.

### Float and shares outstanding

Float is preferred.

```text
normal maximum float: 50 million shares
```

If float is unavailable, shares outstanding are used:

```text
maximum fallback shares outstanding: 60 million
```

Float or shares outstanding must be available. The selector does not guess effective supply.

### Sub-$1 dollar-float exception

A stock priced at or below $1 can exceed the 50-million-share float limit only when:

```text
price x float shares <= $50 million
```

Examples:

- 70 million shares at $0.50 = $35 million dollar float: potentially allowed.
- 70 million shares at $0.90 = $63 million dollar float: rejected.
- A stock above $1 cannot use this exception.

This is a narrow low-price normalization, not removal of the normal float cap.

### Common-stock verification

When authoritative security-master enforcement is enabled, the ticker must be verified as common stock.

The selector rejects:

- Warrants.
- Rights.
- Units.
- Preferred shares.
- ETFs.
- Other non-common instruments.
- Unknown instruments when authoritative verification is required but unavailable.

### Active minimum qualification score

The active `levels-system` runtime requires:

```text
qualification score >= 50
```

This is part of the currently running selector contract documented on July 23, 2026.

## 4. Base qualification score

The base score measures whether the ticker resembles the intended low-priced, low-supply, high-participation small-cap momentum profile.

The theoretical maximum is 100 when confirmed float data is available.

### Percentage-gain points

| Gain | Points |
|---|---:|
| 20% or more | 25 |
| 10% to under 20% | 18 |

Percentage gain is important, but it cannot qualify a ticker by itself.

### Top-gainer-source bonus

| Condition | Points |
|---|---:|
| Present in a recognized live gainer feed | 5 |

Recognized sources include live Nasdaq, StockAnalysis, TradingView, and Yahoo gainer screens.

The bonus is intentionally small. Gainer-list membership corroborates the move but does not replace financial evidence.

### Cumulative dollar-volume points

| Session dollar volume | Points |
|---|---:|
| $250,000 to under $1 million | 8 |
| $1 million to under $2 million | 15 |
| $2 million or more | 20 |

### Relative-volume points

Relative-volume points apply to regular-hours and premarket scoring. Post-market remains unchanged and does not receive this component.

| Relative volume | Points |
|---|---:|
| 0.75x to under 1.5x | 5 |
| 1.5x to under 3x | 10 |
| 3x or more | 15 |

After the July 23 enhancement:

```text
regular/premarket relative volume =
  current Nasdaq session volume
  / Yahoo completed-session three-month average volume
```

If the average-volume denominator is unavailable, the candidate receives no relative-volume points. Missing average volume alone is not a hard rejection.

### Float points

When actual float is available:

| Float | Points |
|---|---:|
| 5 million or less | 25 |
| Over 5M through 10M | 22 |
| Over 10M through 20M | 17 |
| Over 20M through 50M | 10 |
| Approved sub-$1 dollar-float exception | 5 |

Float is one of the largest score components because constrained tradable supply is central to the selector's intended small-cap runner profile.

### Shares-outstanding fallback points

Used only when float is unavailable:

| Shares outstanding | Points |
|---|---:|
| 10 million or less | 15 |
| Over 10M through 25M | 10 |
| Over 25M through 60M | 5 |

Shares outstanding is deliberately worth fewer points because it is a weaker proxy for tradable supply than float.

### Market-cap points

| Market capitalization | Points |
|---|---:|
| $25 million or less | 10 |
| Over $25M through $50M | 8 |
| Over $50M through $100M | 5 |

## 5. Ranking score

The qualification score answers:

> Does this ticker fit the required small-cap momentum profile?

The ranking score answers:

> Which qualified ticker deserves attention right now?

Ranking is dynamic and is not capped at 100.

### Reduced cumulative-dollar-volume influence

The base score awards 8, 15, or 20 points for cumulative dollar volume.

For live ranking, those eligibility points are removed and replaced with smaller supporting values:

| Cumulative tier | Base points removed | Ranking support added |
|---|---:|---:|
| Minimum | 8 | 4 |
| Strong | 15 | 7 |
| Exceptional | 20 | 10 |

This prevents volume accumulated much earlier in the session from dominating a current slot decision.

### Catalyst boost

| Catalyst age | Ranking boost |
|---|---:|
| Same day | 12 |
| 1 day old | 9 |
| 2 days old | 6 |
| 3 days old | 3 |
| 4-7 days old | 0 |

A catalyst helps explain why participation may persist. It affects ranking but is not a hard qualification requirement.

### Recent-dollar-volume boost

- Begins at zero at the session's required recent-dollar-volume floor.
- Increases linearly.
- Reaches a maximum of +15 at $1 million in the last 15 minutes.

### Volume-acceleration boost

- No boost at or below 1x.
- Increases linearly from 1x through 3x.
- Reaches +10 at 3x or more.

### Volume-deceleration penalty

- Begins when acceleration falls below 1x.
- Increases as current activity weakens.
- Reaches the maximum -12 penalty at 0.25x.

### Share-turnover boost

```text
share turnover % =
  session volume / effective shares x 100
```

- Increases linearly.
- Reaches +10 at 100% turnover.

### Ranking formula

In simplified form:

```text
ranking score =
  adjusted qualification score
  + catalyst boost
  + recent-dollar-volume boost
  + acceleration boost
  + share-turnover boost
  - deceleration penalty
```

## 6. Volume acceleration

Volume acceleration compares the latest 15-minute trading rate with the earlier session's average per-minute rate:

```text
recent rate =
  last-15-minute volume / 15

earlier rate =
  (session volume - last-15-minute volume)
  / earlier session minutes

volume acceleration =
  recent rate / earlier rate
```

Interpretation:

- `1.0x`: the latest 15 minutes are trading at approximately the earlier-session rate.
- `2.0x`: the latest rate is twice the earlier-session rate.
- `0.5x`: the latest rate is about half the earlier-session rate.
- If the earlier rate is zero but meaningful recent volume exists, the system uses `10x`.
- Acceleration can be unavailable early in a session when there is not enough earlier history.

## 7. Slot-survival score

The slot-survival score is used for full-list competition:

```text
slot-survival score =
  ranking score
  + sustained-runner continuation bonus
```

The continuation bonus:

- Begins only above a 20% gain.
- Rises linearly.
- Reaches +30 at a 150% gain.
- Is capped at +30.

Examples:

| Gain | Approximate continuation bonus |
|---|---:|
| 20% | 0 |
| 50% | 6.9 |
| 85% | 15 |
| 150% or more | 30 |

This gives genuine session leaders continuity and prevents modest short-term ranking changes from churning major runners out too easily.

## 8. Repeated-pass confirmation

Normal candidates require two qualifying observations.

With the active two-minute scan interval:

```text
scan 1: qualified -> pass count 1
scan 2: still qualified -> pass count 2 -> promotion eligible
```

Rules:

- A failed qualification resets the count.
- Observations more than 15 minutes apart cannot be chained.
- Premarket evidence can carry into regular hours.
- Incompatible session changes reset the chain.
- If a ticker disappears from the evaluated candidate set, its pass evidence is cleared.
- Valid persisted evidence can survive a runtime restart.

The purpose is to reject:

- One bad quote.
- A temporary source mismatch.
- A brief low-volume spike.
- A stale gainer-list observation.
- A move that immediately fades.

## 9. Final activation revalidation

Immediately before activation, the selector performs another session-activity lookup and recalculates:

- Price.
- Gain.
- Session volume.
- Session dollar volume.
- Last-15-minute volume.
- Last-15-minute dollar volume.
- Quote age.
- Volume acceleration.

If the refreshed observation fails:

- Promotion readiness is removed.
- Consecutive passes reset.
- The ticker is not activated.

This prevents stale discovery-time evidence from mutating the live watchlist.

## 10. Fast-track runners

An obvious or extreme runner can become activation-eligible after one passing observation.

### Obvious runner

The ticker must already:

- Pass every hard gate.
- Meet the minimum qualification score.

It additionally requires:

- At least 1.5x volume acceleration.
- At least twice the normal recent-dollar-volume floor.

That means:

| Session | Obvious-runner recent-dollar minimum |
|---|---:|
| Premarket | $50,000 |
| Regular | $100,000 |
| Post-market | At least $150,000 |

A post-market obvious runner must also be up at least 20%.

### Extreme runner

Requirements include:

- Fully qualified and promotion-ready.
- Gain of at least 50%.
- Share turnover of at least 50%.
- Verified top-five gainer evidence.
- At least two independent runner sources.
- At least $1 million in the last 15 minutes.
- Verified session-volume pace.
- Verified common stock when enforcement is enabled.

For Main-session names, volume pace is evaluated against approximately 50 million shares across the 4:00 a.m.-4:00 p.m. Main watch window.

Extreme-runner status is designed for unmistakable market leaders, not merely a high formula score.

## 11. Post-market promotion

Post-market is a separate bucket.

A post-market candidate must first pass all normal post-market hard gates, including:

- At least 100,000 after-hours shares.
- At least $250,000 after-hours dollar volume.
- Fresh activity.
- Price, market-cap, share-structure, security-type, and score requirements.

It must then additionally have:

```text
at least 10% post-market gain
and
at least $75,000 in the last 15 minutes
```

## 12. Capacity and replacement

The active saved operational configuration uses:

- Three active Main tickers.
- Three active post-market tickers.
- Up to 12 Main additions per trading day.
- Up to eight post-market additions per trading day.
- Up to seven Main replacements.
- Up to five post-market replacements.
- Three late-Main-session admission/replacement reserves after 9:00 a.m. Eastern.
- One break-glass post-market extreme-runner replacement.

### Candidate order

Candidates are ordered by:

1. Qualified before unqualified.
2. Higher ranking score.
3. Higher recent 15-minute dollar volume.
4. Higher percentage gain.
5. Higher share turnover.
6. Alphabetical ticker as the final deterministic tie-breaker.

### Normal full-list replacement

A normal challenger can replace an incumbent only when:

- The incumbent has at least one retention failure.
- The incumbent is not protected.
- The challenger's slot-survival score is at least 15 points higher.

### Obvious/extreme-runner replacement

A fast-track runner can challenge the lowest-scoring unprotected incumbent.

It must have at least an eight-point slot-survival advantage.

The smaller margin is permitted because the runner has already demonstrated unusually strong live evidence.

## 13. Hold protection and retention

Admission is not permanent. Active tickers are rescored on every healthy scan.

### Earned 30-minute protection

Thirty-minute hold protection is not granted automatically.

A ticker earns it through either:

- At least three qualifying observations; or
- An immediately strong live-runner profile with:
  - At least 20% gain.
  - At least four times the normal recent-dollar-volume floor.
  - At least 1.5x volume acceleration.

Premarket additions can also receive protection during the first 15 minutes of regular trading.

### Retention failures

For an ordinary active ticker:

```text
failed scan 1 -> warning 1/3
failed scan 2 -> warning 2/3
failed scan 3 -> eligible to move to follow-up
```

A passing scan resets the failure count.

### Trading halts and data gaps

A confirmed Nasdaq trading halt can protect an existing ticker when its only failures are missing, stale, or insufficient recent activity.

An exact-zero recent-volume observation can receive up to 15 minutes of narrow data-gap protection when:

- The ticker previously qualified.
- It still has strong cumulative session activity.
- Recent activity is the only failure.

These protections do not admit new candidates.

## 14. Follow-up and reversal-watch handling

When an active ticker loses its slot, it may move to follow-up instead of disappearing.

Ordinary follow-up is capped at three tickers. It is rebalanced using fresh slot-survival scores only when every competing follow-up ticker has current activity data.

A ticker can earn sticky Potential Reversal Watch status only after much stronger runner evidence, including:

- At least a 50% peak gain.
- Extreme-runner-level evidence.
- Consecutive top-five gainer observations.
- Strong Main-session volume pace.

A reversal-watch ticker does not automatically return to Main merely because it starts passing the ordinary selector again. Recovery-attempt evidence is handled separately.

## 15. Worked example

Assume a candidate has:

- 15% gain.
- $1.2 million session dollar volume.
- 1.7x relative volume.
- 18 million float.
- $40 million market cap.
- Presence on a recognized top-gainer feed.

Its base score is:

| Component | Points |
|---|---:|
| 15% gain | 18 |
| Top-gainer source | 5 |
| $1M+ dollar volume | 15 |
| 1.5x+ relative volume | 10 |
| 18M float | 17 |
| $40M market cap | 8 |
| **Total** | **73** |

The score of 73 exceeds the active minimum of 50.

The ticker is still not automatically added. It must also:

- Pass every hard gate.
- Receive the required repeated confirmation unless fast-tracked.
- Pass final activation revalidation.
- Have an available slot or satisfy replacement requirements.
- Remain inside daily capacity rules.

## 16. What the score means

The selector measures:

- Small-company profile.
- Effective supply constraint.
- Abnormal gain.
- Sufficient liquidity.
- Current participation.
- Participation acceleration or deceleration.
- Share turnover.
- Current catalyst support.
- Independent discovery corroboration.

It does **not** measure:

- Probability that the price will rise.
- Trade-entry quality.
- Risk/reward.
- Support/resistance quality.
- Dilution risk.
- AI Read quality.
- Whether a trader should buy immediately.

The selector decides which tickers deserve active monitoring.

The later watchlist cards, levels, catalyst assessment, trade zones, invalidation, conditional targets, and AI Read determine how a trader should interpret that ticker.

