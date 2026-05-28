# Website Shared Candle Engine Execution Plan

## Purpose

This plan records the next seven useful improvements for keeping `levels-system` as one repo today while separating the two product surfaces inside it:

- the Discord/manual-watchlist app
- the shared candle, level, structure, volume, and trade-analysis engine that future TraderLink website tools can reuse

The goal is not to split the repo yet. The goal is to make the candle/structure side clean enough that other apps can consume it without copying files or learning Discord-specific behavior.

## Product Direction

Keep this project together for now because Discord posts are still the fastest real-world feedback loop for level and candle-quality mistakes. Build strong module boundaries so the shared engine can later become a package or service when the API is mature.

## Step 1: Durable Candle Warehouse

### Goal

Move beyond request-shaped validation cache files toward a durable candle store organized by provider, symbol, timeframe, and session date.

### Implementation

1. Add a `src/lib/candle-warehouse/` module.
2. Store normalized candle rows as JSONL:

```text
data/candles/
  provider/
    SYMBOL/
      timeframe/
        YYYY-MM-DD.jsonl
```

3. Support:
   - `upsertCandles`
   - `getCandles`
   - `findMissingRanges`
   - `getCoverage`
4. Keep provider metadata, source fetch time, and raw adjustment mode on each row.
5. Add a `DurableCandleWarehouseFetchService` that can reuse stored candles and write fresh provider responses back to the warehouse.

### Acceptance

- Querying stored candles returns sorted, deduped candles.
- Upserting the same candle twice does not duplicate it.
- Missing-range checks work per timeframe.
- Shared consumers can import the warehouse types from the public support/resistance boundary.

## Step 2: Provider Abstraction Hardening

### Goal

Keep IBKR as the current provider but prevent future tools from depending on IBKR details directly.

### Implementation

1. Keep provider choice inside `levels-system`.
2. Keep returned candles normalized to the shared `Candle` type.
3. Store provider name on warehouse rows.
4. Keep provider diagnostics in responses.
5. Make later provider swaps happen behind the same fetch-service contract.

### Acceptance

- Consumer apps ask for context, not IBKR calls.
- Provider identity appears only as metadata/diagnostics.

## Step 3: End-Of-Day Replay Verdict

### Goal

Provide a practical per-symbol operator verdict after each session.

### Implementation

Already implemented as:

```powershell
npm run audit:eod-verdict -- <session-folder-or-discord-delivery-audit.jsonl>
```

It writes:

- `end-of-day-symbol-verdict.json`
- `end-of-day-symbol-verdict.md`

### Acceptance

Each symbol answers:

- Did the first post give a good trade map?
- Did the app post too much?
- Did it need candle-backed missed-move audit?
- Were levels complete enough?
- Did trader wording make sense?

## Step 4: Session Behavior Classification

### Goal

Classify the current trading session behavior, not a permanent ticker personality.

### Implementation

Use existing audit and trader-context layers:

- range-bound chop
- active runner
- extended runner
- low-volume drift
- thin ladder
- missing candle proof

### Acceptance

The classification stays operator-facing unless it becomes clean enough to support a trader-facing line.

## Step 5: Candle-Backed First Post Quality

### Goal

Make the first Discord post read like a practical trade map.

### Implementation

Already partially implemented through first-post trade plan lines and session behavior audit.

The first post should include:

- current price
- closest useful support/resistance
- main support that matters
- cleaner-above resistance
- likely chop zone or range
- room above / room below
- data quality only when it changes trust

### Acceptance

Audit reports should flag weak first posts even when support/resistance ladders exist.

## Step 6: Bulk Replay Benchmark

### Goal

Use all saved data, not just named examples, to test post quality and missed moves.

### Implementation

Use:

```powershell
npm run stress:all-symbols
npm run audit:session-behavior -- <session-folder>
npm run audit:missed-moves -- <session-folder>
npm run audit:eod-verdict -- <session-folder>
```

### Acceptance

The benchmark should highlight:

- too noisy
- too quiet
- missed meaningful move
- bad wording
- level gap
- good behavior

## Step 7: Trade-Window Candle Pack For Website Tools

### Goal

Let `trader-intelligence-v2` and future TraderLink tools request a full candle/structure package for trades without fetching candles locally.

### Implementation

Already exposed through:

```ts
buildTradeAnalysisCandleContext(...)
```

The next strengthening layer is durable warehouse support so bulk imports can reuse stored candles.

### Acceptance

The response includes:

- support/resistance context
- pre-trade candles
- trade-window candles
- post-trade candles
- VWAP / EMA
- market structure
- diagnostics

## Current Execution Status

- Step 1: implemented as a first JSONL warehouse layer with query/upsert/coverage/missing-range support and a warehouse-backed fetch service.
- Step 2: implemented foundation. Provider remains behind fetch-service contracts and warehouse rows carry provider identity. Final provider-swap validation waits until the next provider is chosen.
- Step 3: implemented.
- Step 4: implemented as operator-facing audit context and still improving from saved sessions.
- Step 5: implemented enough for first-post audits; continue tuning from saved sessions.
- Step 6: implemented through existing audit scripts; keep using full saved-data passes.
- Step 7: implemented at API level; durable warehouse support now improves bulk-import readiness.
