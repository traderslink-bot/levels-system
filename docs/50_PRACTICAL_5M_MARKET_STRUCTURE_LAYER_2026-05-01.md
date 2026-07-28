# Practical 5-Minute Market Structure Layer

## Purpose

This layer makes the Discord story operate at the level of a practical small-cap trade area instead of a single penny-level event.

The system should still respect every real support and resistance level, but live trader-facing posts should focus on meaningful structure changes:

- price is range-bound
- buyers are building a base
- price is pressing resistance
- breakout attempt is underway
- breakout area is holding
- breakout failed
- price is pulling into support
- support is holding
- support is failing
- support broke cleanly
- reclaim is being attempted
- reclaim is holding

## Product Rules

- Long-biased traders only.
- No short-trade framing.
- No direct buy/sell/trim/exit instructions.
- Hints are allowed; instructions are not.
- Discord posts should be trader-view only.
- Do not invent support or resistance levels that are not already backed by the level engine.
- Reducing post noise must not hide real structure changes.

## Small-Cap Practical-Zone Rule

Small caps and microcaps often move several cents without the trade actually changing.

For low-priced tickers, nearby levels such as `0.9898`, `1.00`, and `1.02` can be one support area. The trader-facing story should say the whole area needs to hold or reclaim, instead of treating every one-cent break as a new risk event.

Examples:

- Good: `major support 0.9898-1.02 area is failing for now; buyers need a cleaner reclaim of the area`
- Bad: `if 1.01 fails, risk opens toward 1.00`

## Implemented Components

### 1. Practical Trade Structure Context

Implemented in:

- `src/lib/monitoring/practical-trade-structure.ts`

The module derives:

- `state`
- `previousState`
- practical support area
- practical resistance area
- short-term momentum support area
- `structureKey`
- `practicalZoneKey`
- trader-facing structure line
- whether the new state is a material structure change

### 2. Live 5-Minute Price Buckets

Implemented in:

- `src/lib/monitoring/intraday-price-structure.ts`
- `src/lib/monitoring/watchlist-monitor.ts`

The runtime buckets live prices into 5-minute windows and tracks:

- recent base low
- recent base high
- last close
- range percentage
- higher-low count
- lower-high count
- direction: `building`, `fading`, `flat`, or `unknown`

This is used as context only. It does not create new standalone Discord posts and does not invent levels.

### 3. Monitoring Event Context

Implemented in:

- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/monitoring-types.ts`

Each monitoring event can now carry `eventContext.tradeStructure`.

### 4. Trader-Facing Wording

Implemented in:

- `src/lib/alerts/trader-message-language.ts`
- `src/lib/alerts/alert-router.ts`

When market-structure wording is live-enabled, the practical structure line is preferred over generic structure wording.

Example:

`market structure: CYCU is still range-bound between major support 0.9898-1.02 area and moderate resistance 1.06; small moves inside that band are lower-quality noise`

### 5. Post-Policy Materiality

Implemented in:

- `src/lib/monitoring/live-thread-post-policy.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/review/live-post-replay-simulator.ts`

Repeated same-level stories now consider:

- severity escalation
- score escalation
- practical structure state change
- practical zone change
- practical expansion from the previous trigger

This means a repeated touch at the same level should not repost just because time passed, but a true shift from range-bound to pressing resistance or breakout attempt can still post.

The live policy also applies practical small-cap post budgets:

- low-action trade areas such as `range_bound`, `pullback_to_support`, and `support_holding` get fewer repeat posts
- `building_base`, `pressing_resistance`, and `support_failing` get a little more room, but still require a real story change
- breakout, reclaim, and clean structure-break events can still pass through because those are trader-critical
- fast level-clear updates share the same critical burst governor as alerts and follow-through posts

The grouping affects whether another Discord post is needed. It does not remove support/resistance levels from the ladder.

### 6. Thread Story Phase Control

Implemented in:

- `src/lib/monitoring/live-thread-post-policy.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/review/live-post-replay-simulator.ts`

The live runtime and saved-data replay now keep a thread-level phase memory. This is a stricter layer above same-level grouping.

Tracked phases include:

- `range_bound`
- `building_base`
- `testing_support`
- `pressing_resistance`
- `breakout_attempt`
- `breakout_holding`
- `failed_breakout`
- `support_area_lost`
- `reclaim_attempt`
- `reclaim_holding`
- `runner_extension`

This lets the app ask a better question before posting:

`Is this a new phase of the trade story, or is the thread about to say the same thing again in the same area?`

The phase layer can suppress repeated posts when the same support/resistance area is still in the same phase. It can still allow posts when:

- the phase changes
- the area changes
- price materially expands away from the prior phase record
- practical market structure marks the change as material
- the runtime flags a major clustered level change

Important boundary:

- phase control only affects Discord post frequency
- it does not delete, merge away, or hide support/resistance levels from the ladder
- failed Discord deliveries roll back reserved phase state, so retry paths are not accidentally blocked

### 7. Audit Evidence

Implemented in:

- `src/lib/alerts/discord-audited-thread-gateway.ts`
- `src/lib/review/discord-audit-reports.ts`

Discord audit rows now carry:

- `practicalStructureState`
- `practicalStructureKey`
- `practicalZoneKey`
- `practicalStructureMaterialChange`

The trading-day evidence report now includes a Practical Structure Evidence section.

## Testing

Coverage added in:

- `src/tests/practical-trade-structure.test.ts`
- `src/tests/intraday-price-structure.test.ts`
- `src/tests/live-thread-post-policy.test.ts`
- `src/tests/discord-audit-reports.test.ts`
- `src/tests/offline-small-cap-scenario-simulator.test.ts`

The tests cover:

- tight small-cap supports becoming one practical support area
- one-cent support noise versus clean support-area loss
- repeated resistance pressure from recent 5-minute story
- live 5-minute bucket direction for higher-low building and lower-high fading
- same-level posts allowed only when practical structure changes
- audit evidence for practical structure metadata
- deterministic small-cap price paths for range chop, base-to-breakout, fake breakout, support-area loss, and reclaim-after-flush behavior

## Closed-Market Scenario Validation

When the market is closed, use the offline small-cap scenario simulator instead of waiting for fresh Discord posts.

Command:

```powershell
npm run scenario:smallcap
```

Outputs:

- `artifacts/offline-scenarios/small-cap-scenario-simulation.json`
- `artifacts/offline-scenarios/small-cap-scenario-simulation.md`

The simulator drives deterministic price paths through the real monitor, alert intelligence engine, trader formatter, and live-thread posting policy.

It is designed to prove:

- a low-action range-bound ticker does not create 30+ same-zone posts
- a base pushing into resistance can still produce a breakout post
- a fake breakout does not repost every wiggle
- a clean support-area loss still reaches the trader
- a reclaim-after-flush can show a changed structure without direct advice

This is not a replacement for live-market validation. It is a weekend/closed-market safety check that makes post-noise tuning less subjective before the next open.

## Broad Saved-Data Stress Validation

The deterministic scenario pack is useful, but it is intentionally small. For a broader test across the saved evidence set, run:

```powershell
npm run stress:all-symbols
```

Outputs:

- `artifacts/all-symbol-stress/all-symbol-stress-report.json`
- `artifacts/all-symbol-stress/all-symbol-stress-report.md`

This scanner uses all saved long-run Discord audit streams by default, dedupes identical audit files, aggregates every saved symbol, replays the current balanced posting policy, and ranks:

- original overposting
- symbols still noisy under the current policy
- tight-range chop
- fast-runner cascades
- missed-event candidates
- trader-language boundary hits

Use this report when deciding what to tune next. The goal is to fix broad behavior classes, not one hand-picked ticker.

Latest broad saved-data scorecard after the small-cap same-area tuning:

- saved symbols scanned: `57`
- original posted rows: `5075`
- simulated posted rows: `2210`
- reduction: `56.5%`
- symbols still noisy after current policy: `14`
- post-budget attention: `7` excessive-chop symbols, `4` runner-review symbols, `8` watch symbols

Additional phase-control replay checks:

- latest high-activity saved session: `530 -> 235` balanced simulated posts
- CYCU in that session: `31 -> 7`
- older ATER/DRCT/SKYQ/SEGG noisy session: `390 -> 55`
- older noisy-session max 5-minute burst: `14 -> 4`

This is a meaningful improvement, but it is not the finish line. Remaining noisy symbols should be reviewed through the post-budget labels before live policy is tightened:

- `excessive_chop` means the ticker still needs review for same-area or optional-context clutter
- `runner_review` means the ticker moved enough that higher post count may be valid, but the audit should prove the posts were expansion, failure, reclaim, or hold/failure beats
- `watch` means the count is above the healthy budget but not enough evidence exists to change policy without manual review

## Rollout

This layer is safe to run because it does not replace the level engine and does not invent levels. It enriches monitoring events and gives the post policy better materiality keys.

After the next live trading session, run:

```powershell
npm run scenario:smallcap
npm run stress:all-symbols
npm run longrun:audit:reports -- artifacts\long-run\<session-folder>
npm run saved-data:test -- --limit 5
```

Then inspect:

- `trading-day-evidence-report.md`
- `live-post-replay-simulation.md`
- `live-post-profile-comparison.md`
- `runner-story-report.md`

Acceptance target:

- range-bound tickers should stop producing 30+ same-zone posts
- active runners should still post real expansion and real failure
- the audit should show practical structure states instead of only raw alert labels
- no direct advice or short-side framing should appear in Discord-visible output
