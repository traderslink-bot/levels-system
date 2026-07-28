# Next Trader Experience Improvement Plan

## What This File Is For

This file turns the next useful app-improvement ideas into an executable plan for Codex.

The goal is to make Discord threads read less like a stream of raw support/resistance events and more like one clean professional trader story:

- what matters now
- what level area is controlling the trade
- where the setup improves
- where the setup gets damaged
- when a runner needs different handling
- when the system should stay quiet

This plan should be used after the trade-story state, range-box, acceptance, support-importance, behavior-budget, recap, and visual replay tooling from `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md`.

## Product Rules

- Long-biased traders only.
- No short-trade framing.
- No direct buy/sell/exit/trim instructions.
- Trader-facing output should use hints and context, not commands.
- Discord posts should be trader-view only.
- Operator/debug/testing language belongs in logs, artifacts, and audit reports.
- Do not hide real support/resistance levels to reduce noise.
- Do not invent levels that candle data does not support.
- Reducing post count must not suppress genuinely meaningful trade changes.
- Small-cap penny flickers should not be treated like major structure failures.

## Desired End State

After this plan is complete, a ticker thread should usually behave like this:

1. The first post gives a clean trade map.
2. The thread identifies the main active trade area instead of reacting to every tiny level flicker.
3. Weak probes through support/resistance do not become overconfident breakout/breakdown stories.
4. Important support and resistance levels are prioritized for the trader while the full ladder remains available.
5. Runner behavior is handled differently from quiet range behavior.
6. Failed breakouts and failed breakdowns stay in memory so the same level is not treated as cleanly cleared too soon.
7. Each ticker can produce a useful recap and visual audit trail.

## Implementation Overview

The plan has eight major parts:

1. Level importance tiers
2. Primary trade area lock
3. Failed breakout / failed breakdown memory
4. Better first-post trade map
5. Cleaner runner mode
6. Thread health score
7. Trade lifecycle summary
8. Saved-data replay dashboard

These should be built in that order. Parts 1 to 5 directly affect live post quality. Parts 6 to 8 make the system easier to audit and tune.

---

## 1. Level Importance Tiers

### Problem

The engine may calculate many valid levels, but not every valid level deserves equal trader attention.

For small caps, especially penny or low-priced names, tiny nearby levels can cause Discord to sound silly:

- "if 1.01 fails, risk opens toward 1.00"
- repeated one-cent support crossed / reclaimed messages
- too much emphasis on minor fresh intraday structure

The system should still preserve all levels internally, but trader-facing posts should know which levels are actually important.

### Implementation Steps

1. Add a level importance module, likely:
   - `src/lib/monitoring/level-importance.ts`
   - or extend existing practical/trader context modules if a cleaner local home exists.

2. Define an importance label:
   - `major_decision`
   - `active_trade_boundary`
   - `useful_reference`
   - `minor_noise`
   - `extension_context`
   - `unknown`

3. Score importance using:
   - existing level strength label
   - timeframe source
   - daily / 4h confluence
   - distance from current price
   - zone width
   - practical small-cap move floor
   - role-flip history
   - repeated rejection / defense history
   - nearby cluster density
   - whether the level is part of the active trade area

4. Keep full ladder output intact in snapshots, but add prioritization for wording:
   - "Main resistance"
   - "Main support"
   - "Nearby reference"
   - "More support and resistance"

5. Update alert formatting so minor levels do not get dramatic wording.

6. Add tests proving:
   - strong daily/4h levels outrank tiny fresh intraday levels
   - close penny levels can be grouped as a practical area
   - valid minor levels are not deleted from the full ladder
   - Discord wording avoids one-cent risk dramatization

### Acceptance Standard

The system can still surface every valid level, but trader-facing summaries emphasize the most important levels first and avoid treating minor small-cap flickers as major trade decisions.

---

## 2. Primary Trade Area Lock

### Problem

Many noisy threads happen because price stays inside one obvious active range, but the app keeps posting every tiny touch or cross inside that range.

Example behavior to avoid:

- touched 1.06
- slipped to 0.98
- touched 1.06 again
- slipped to 0.9878
- crossed 1.00
- reclaimed 1.01

That is not a useful trader story. It is one range until price actually leaves the range.

### Implementation Steps

1. Add a trade-area lock module, likely:
   - `src/lib/monitoring/primary-trade-area.ts`

2. Define:
   - `PrimaryTradeArea`
   - support boundary
   - resistance boundary
   - active center price
   - width percent
   - lockedAt
   - lastConfirmedInsideAt
   - escape side: `up`, `down`, or `none`
   - escape confidence

3. Build from:
   - practical trade structure
   - range box context
   - support/resistance ladder
   - recent 5m candle structure
   - failed break/reclaim memory

4. Lock the story while price remains inside the area.

5. Allow unlock only when:
   - price closes outside the area with acceptance
   - volume/activity supports a meaningful expansion
   - stable 5m structure materially changes
   - price reaches a new higher-priority level outside the box

6. Update post policy:
   - suppress repeated weak probes inside locked area
   - allow one clean area recap after enough time
   - allow accepted range escape
   - allow major support loss
   - allow major resistance acceptance

7. Add tests using CYCU/PBM-like behavior:
   - many price updates inside a tight box produce few posts
   - a real accepted escape still posts
   - a material support failure still posts

### Acceptance Standard

A range-bound stock should produce a small number of useful posts, not dozens of posts for the same battlefield.

---

## 3. Failed Breakout / Failed Breakdown Memory

### Problem

If price barely pushes above resistance and falls back, the system can sound too certain:

- "resistance cleared"
- "old resistance is now support"

But traders know that a tiny tap through resistance that immediately fails usually means the level is still resistance.

The same applies to support: a tiny slip below support that quickly reclaims may not be a meaningful breakdown.

### Implementation Steps

1. Add a failure-memory module or extend existing zone interaction memory:
   - `src/lib/monitoring/failed-level-memory.ts`

2. Track per symbol and zone:
   - last breakout attempt
   - max extension beyond resistance
   - time above resistance
   - whether it reclaimed below
   - last breakdown attempt
   - max extension below support
   - time below support
   - whether it reclaimed above
   - failure count

3. Define outcomes:
   - `probe_only`
   - `testing`
   - `accepted`
   - `failed`
   - `reclaimed`

4. Update wording:
   - Avoid "cleared" unless acceptance is present.
   - Use "testing above resistance" for early breaks.
   - Use "resistance is still being tested" after a failed push.
   - Use "support is still being tested" after a quick reclaim.

5. Feed this into:
   - acceptance context
   - post policy
   - first-post context if relevant
   - replay audit

6. Add tests:
   - one candle wick through resistance then back below stays `probe_only`
   - several closes above resistance becomes `accepted`
   - failed breakout increases caution around the same level
   - failed breakdown avoids bearish/short framing

### Acceptance Standard

The app should stop sounding certain about levels that only had a weak tap-through. Tiny probes should be treated as tests until proven otherwise.

---

## 4. Better First-Post Trade Map

### Problem

The first support/resistance post is the trader's anchor. It should not just list levels. It should explain the trade map in normal trader language.

### Trader-Facing Shape

The first post should include:

- current price
- main resistance area
- main support area
- the level area that needs to hold for the setup to stay clean
- room above if resistance is accepted
- where the setup gets damaged
- closest levels to watch
- more support and resistance

It must avoid direct trade advice.

### Example Style

Good:

```text
SOBR support and resistance
Price: 1.09

Trade map:
SOBR is boxed between light support near 1.03 and heavy resistance near 1.12.
The cleaner long-side read needs buyers to keep defending the 1.03 area.
Acceptance above 1.12 opens the next resistance area near 1.26.
Losing 1.03 would damage the setup and shift attention toward 0.90 support.
```

Avoid:

```text
Buy 1.03.
Sell below 1.03.
Risk opens if price drops one cent.
```

### Implementation Steps

1. Add a first-post trade-map builder:
   - `src/lib/alerts/first-post-trade-map.ts`
   - or extend existing level snapshot formatter if cleaner.

2. Feed it:
   - level importance tiers
   - primary trade area
   - support importance
   - stable 5m structure
   - volume/activity if reliable
   - dynamic context if available

3. Generate deterministic lines:
   - "boxed between..."
   - "main resistance is..."
   - "main support is..."
   - "acceptance above..."
   - "losing this area would damage..."

4. Never say:
   - "best entry"
   - "buy"
   - "sell"
   - "should enter"
   - "should exit"
   - "price target"
   - "guarantees"

5. Add tests:
   - first post includes strength labels
   - first post identifies main support/resistance
   - first post avoids one-cent risk drama
   - first post stays trader-facing and non-advisory
   - first post still shows full ladder

### Acceptance Standard

The first Discord post should feel like a professional trader laying out the stock's structure, not a raw level dump.

---

## 5. Cleaner Runner Mode

### Problem

Runner stocks behave differently than quiet range stocks. A real runner may cross levels quickly, pull back hard, halt, reclaim, or flush after an extension.

The app should not treat runner behavior the same way as tiny range chop.

### Implementation Steps

1. Extend behavior budget:
   - current labels include `boring_range`, `normal_trade`, `active_runner`, `extreme_runner`.

2. Add runner context:
   - move from day low
   - move from premarket base
   - distance above VWAP
   - distance above EMA9/EMA20
   - fast candle expansion
   - halt/stale print awareness
   - volume/activity label
   - number of resistance levels crossed recently

3. Runner mode should:
   - suppress repeated minor touches
   - emphasize next major resistance
   - identify the most important hold area
   - warn when structure is stretched without using fear language
   - distinguish normal pullback from setup damage

4. Add wording:
   - "move is extended from the recent base"
   - "first clean hold area is..."
   - "buyers need to keep reclaiming..."
   - "a deeper reset would bring..."

5. Add tests:
   - runner crossing many levels groups the move
   - normal runner pullback is not called failed too early
   - extreme runner gets higher caution but no direct advice
   - halts/stale data do not create false failure wording

### Acceptance Standard

Runners should produce fewer, better posts focused on major decisions: extension, acceptance, hold area, next resistance, and damage area.

---

## 6. Thread Health Score

### Problem

The operator needs a fast way to know whether a thread behaved well.

### Implementation Steps

1. Add thread health scoring:
   - `src/lib/review/thread-health-score.ts`

2. Score per symbol/thread:
   - repeated same-level posts
   - repeated same-story posts
   - stale candle evidence
   - missing next support/resistance
   - no-resistance/no-support claims
   - Discord delivery failures
   - AI commentary failures
   - too many posts for a range-bound stock
   - too little posting for major accepted moves
   - system/advice language

3. Output:
   - `healthy`
   - `watch`
   - `major_review`
   - `broken`

4. Add report artifacts:
   - JSON
   - markdown summary
   - top issues
   - evidence excerpts

5. Add tests:
   - noisy repeated story lowers score
   - failed post delivery lowers score
   - clean low-post range gets healthy
   - accepted breakout with no post becomes watch/major

### Acceptance Standard

After a trading day, the audit should quickly identify which threads deserve human review and why.

---

## 7. Trade Lifecycle Summary

### Problem

A trader or operator should be able to understand a whole ticker day without reading every post.

### Implementation Steps

1. Extend `thread-end-recap` or add:
   - `src/lib/review/trade-lifecycle-summary.ts`

2. Summarize:
   - starting price
   - starting active range
   - main support
   - main resistance
   - best breakout attempt
   - best support hold
   - major failure/reclaim
   - runner extension if any
   - final state

3. Final states:
   - `still_valid`
   - `range_bound`
   - `breakout_working`
   - `breakout_failed`
   - `support_damaged`
   - `extended_runner`
   - `dead_thread`
   - `insufficient_data`

4. Add operator markdown:
   - concise narrative
   - post count
   - useful post count
   - noisy post count
   - key levels

5. Add tests:
   - range day summary
   - runner day summary
   - failed breakout day summary
   - support failure/reclaim summary

### Acceptance Standard

The recap should make it obvious whether the Discord thread told a coherent story.

---

## 8. Saved-Data Replay Dashboard

### Problem

The current audit tooling is helpful, but a visual review would make it much easier to see whether posts lined up with price movement.

### Implementation Steps

1. Extend `src/lib/review/visual-audit-replay.ts`.

2. Add:
   - price path
   - post markers
   - support/resistance ladder markers
   - primary trade area
   - accepted/probe/failed labels
   - post health color
   - repeated-story markers
   - no-post windows where price moved materially

3. Generate:
   - one HTML file per audit run
   - symbol index
   - top problem symbols
   - links to evidence sections

4. Add script:
   - existing `npm run audit:visual-replay` can be extended
   - avoid requiring live market data

5. Add tests:
   - dashboard includes symbol index
   - dashboard includes post markers
   - dashboard flags repeated-story evidence
   - dashboard does not leak operator wording into trader-facing examples

### Acceptance Standard

The visual replay should help Codex and the operator quickly judge whether the thread told the right story at the right moments.

---

## Suggested Execution Order

### Phase 1: Core Semantics

1. Build level importance tiers.
2. Build primary trade area lock.
3. Build failed breakout / failed breakdown memory.

Why first:

These directly address the biggest live Discord problems:

- too many posts
- overreacting to penny flickers
- too-certain breakout language
- poor distinction between important and minor levels

### Phase 2: Trader-Facing Output

4. Rework first-post trade map.
5. Refine runner mode.

Why second:

After the system knows what matters, the posts can be rewritten around the better facts.

### Phase 3: Audit And Feedback Loop

6. Add thread health score.
7. Add trade lifecycle summary.
8. Extend visual replay dashboard.

Why third:

These make it much harder to do shallow audits and much easier to calibrate the app from saved data while the market is closed.

---

## Testing Plan

Run focused tests after each phase:

```powershell
npx tsx --test src/tests/*level-importance*.test.ts
npx tsx --test src/tests/*primary-trade-area*.test.ts
npx tsx --test src/tests/*failed-level*.test.ts
npx tsx --test src/tests/alert-router.test.ts src/tests/trader-facing-replay-language.test.ts
npx tsx --test src/tests/live-thread-post-policy.test.ts
```

Run full verification before calling the work complete:

```powershell
npm run build
npm test
npm run replay:monday -- --skip-slow
```

Run saved-data audit tooling:

```powershell
npm run audit:end-recap
npm run audit:visual-replay
```

If new scripts are added for thread health or lifecycle summaries, include them in this section and in `README.md`.

---

## Saved-Data Scenarios To Use

Use broad saved-data replay, not only hand-picked symbols.

Priority scenario types:

- boring small-cap range day with too many posts
- fast runner crossing multiple resistance levels
- failed breakout that barely pierced resistance
- failed breakdown that quickly reclaimed support
- ticker with stale/noisy candle cache
- ticker with no higher resistance surfaced
- ticker with one-cent support flicker
- ticker with major support loss
- ticker with high post count but low price movement

Known examples from prior sessions can be useful, but they should not be the whole test set:

- CYCU-like quiet range
- PBM-like stale cache / questionable late post
- FATN-like support cascade
- AKAN-like extreme runner and flush
- CUE-like no higher resistance surfaced

Acceptance requires broad replay coverage across many symbols, not a fix tuned only to those names.

---

## Documentation Updates Required

When implementing this plan, update:

- `README.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md`
- this file, with progress notes

If the shared support/resistance public API changes, update:

- `docs/51_SHARED_SUPPORT_RESISTANCE_ENGINE_BOUNDARY_2026-05-02.md`
- `docs/52_TRADER_INTELLIGENCE_V2_SHARED_ENGINE_HANDOFF_2026-05-02.md`

---

## Progress Log

### 2026-05-02

Plan created. No implementation from this file has been started yet.

The already-completed prerequisite work is in `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md`.

### 2026-05-02 Implementation Pass

Completed this plan's first implementation pass.

Implemented:

- level importance tiers in `src/lib/monitoring/level-importance.ts`
- primary trade area lock context in `src/lib/monitoring/primary-trade-area.ts`
- failed breakout / failed breakdown memory in `src/lib/monitoring/failed-level-memory.ts`
- alert metadata and Discord audit metadata for level importance, primary trade area, and failed-level memory
- live post-policy checks for locked-area weak probes and repeated weak-probe memory
- clearer first-post trade map wording with separate main support and main resistance lines
- thread health score reporting in `src/lib/review/thread-health-score.ts`
- trade lifecycle summary reporting in `src/lib/review/trade-lifecycle-summary.ts`
- visual audit replay upgrades with symbol index and issue flags

Added commands:

- `npm run audit:thread-health -- <session-folder-or-discord-delivery-audit.jsonl>`
- `npm run audit:lifecycle -- <session-folder-or-discord-delivery-audit.jsonl>`

Added/updated focused tests:

- `src/tests/level-importance.test.ts`
- `src/tests/primary-trade-area.test.ts`
- `src/tests/failed-level-memory.test.ts`
- `src/tests/thread-health-score.test.ts`
- `src/tests/trade-lifecycle-summary.test.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/live-thread-post-policy.test.ts`
- `src/tests/visual-audit-replay.test.ts`

Verification to rerun before final handoff:

```powershell
npm run build
npm test
npm run replay:monday -- --skip-slow
```
