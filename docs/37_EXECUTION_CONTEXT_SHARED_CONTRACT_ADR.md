# ADR 37: Execution Context Shared Contract Boundary

## Status

Accepted for planning and future implementation guardrails.

This ADR is documentation only. It does not authorize code changes, production behavior changes, deletion of `journal-context`, or changes in the trading journal repo.

## Context

`docs/35_TRADING_JOURNAL_EXECUTION_CONTEXT_PLAN.md` introduced a factual execution context snapshot that evaluates a supplied execution against already-built level output and market facts. The first implementation added `src/lib/journal-context/execution-market-context.ts` in levels-system as a pure helper that:

- accepts an existing `LevelEngineOutput`
- finds nearest supplied support and resistance
- carries optional session, volume, shelf, market-context, and facts-bundle metadata
- keeps VWAP and volume shelves facts-only
- does not call LevelEngine internally
- does not score behavior
- does not produce coaching

`docs/36_LEVELS_SYSTEM_VS_JOURNAL_ARCHITECTURE_BOUNDARY_AUDIT.md` confirmed that the trading journal app already has execution timeline, trade analysis, support/resistance mapping, pattern detection, behavior analysis, execution feedback, coaching, and UI/product workflow modules. It also confirmed that the journal already consumes levels-system through `levels-system-phase1/support-resistance-engine`.

That means the factual execution context module can be useful as a shared contract, but only if it stays inside the levels-system responsibility boundary. It must not turn levels-system into the trading journal's grading, coaching, behavior, or product interpretation layer.

## Decision

The factual execution context snapshot may remain in levels-system only as a shared, facts-only contract for downstream apps, including the trading journal app.

Any execution-context code in levels-system must remain factual and reusable. It may describe supplied level proximity, supplied market facts, supplied session facts, supplied volume facts, supplied volume shelves, and safety diagnostics. It must not grade trades, coach traders, score behavior, calculate P/L, analyze giveback, or create journal-specific product interpretation.

Anything that grades, coaches, scores, interprets, or turns execution facts into journal product workflows belongs in the trading journal repo.

Implementation note: the boundary-alignment refactor renamed the module from `src/lib/journal-context` to `src/lib/execution-context` to clarify that it is a shared factual contract, not journal product logic. The rename preserved behavior and did not add grading, coaching, behavior scoring, P/L, giveback analysis, or runtime integration.

## What levels-system owns

Levels-system owns shared market and level facts:

- support/resistance levels
- `FinalLevelZone` runtime transport and level metadata
- optional `enrichedAnalysis` shadow metadata
- no-lookahead candle-close filtering
- formal market-structure `asOfTimestamp` filtering
- market structure facts
- market context facts
- session facts
- volume facts
- volume shelves as facts
- VWAP as market facts only by default
- factual execution context contracts when those contracts are shared by downstream apps

For execution context, levels-system may expose factual helpers that operate on already-supplied inputs:

- nearest supplied support/resistance around an execution
- factual distance percentages
- factual execution location labels that do not imply good or bad behavior
- factual risk-context fields such as nearest supplied invalidation or target level
- diagnostics and safety flags

## What trading journal owns

The trading journal app owns product and trader-specific interpretation:

- trade ingestion and broker import workflows
- raw execution timelines
- journal-specific execution context windows
- PatternInput construction
- pattern detection and normalization
- trade grading
- behavior scoring
- execution feedback
- coaching
- P/L calculations
- giveback analysis
- trade summaries
- journal UI and product workflows
- any user-facing judgment about whether a trade, entry, add, or exit was good, bad, disciplined, chased, late, early, or risk-reducing

The journal may consume levels-system facts, but it owns the final interpretation of those facts inside trader review workflows.

## Current confusing naming

The original module path was confusing:

```text
src/lib/journal-context/execution-market-context.ts
```

That name suggests levels-system owns a journal-specific context layer. The intended boundary is narrower: this is a shared factual execution-context contract over supplied levels and market facts.

The shared-contract path is now:

```text
src/lib/execution-context
```

Do not reintroduce journal-specific naming for this module unless the code is actually moved into the trading journal repo.

## Follow-up refactor recommendation

The boundary-alignment source rename has been completed. Remaining future follow-up:

1. Keep exported type and helper names stable unless a separate compatibility plan is approved.
2. If levels-system package exports are formalized, expose the module through a stable public subpath.
3. Confirm the trading journal imports only the public package export, not source internals.

Any further refactor should be done as a small PR with focused tests. It should not include behavior changes, journal integration, scoring, coaching, or cleanup-by-deletion.

## Non-goals

This ADR does not:

- change production code
- delete the execution context module
- move code into the trading journal repo
- modify the trading journal repo
- integrate execution context into LevelEngine default output
- change `runtimeMode` defaults
- change old/default `LevelEngineOutput` behavior
- change alerts
- change monitoring
- change trader-context behavior
- add trade grading
- add coaching output
- add behavior scoring
- add P/L calculations
- add giveback analysis
- convert volume shelves into support/resistance levels
- use VWAP for trader interpretation by default

## Safety rules

Future levels-system execution-context work must follow these rules:

- keep the module pure and deterministic
- do not call `Date.now`
- do not make network calls
- do not mutate supplied `LevelEngineOutput`, facts, shelves, or market context
- do not call LevelEngine inside execution-context builders
- do not generate new levels
- do not change support/resistance selection
- do not change bucket membership, nearest runtime levels, extension levels, special levels, `strengthScore`, or `strengthLabel`
- keep VWAP facts-only unless a later explicit policy allows interpretation
- keep volume shelves facts-only and never convert them into support/resistance levels inside this module
- preserve old/default LevelEngine output behavior
- keep any market-context or enriched-analysis usage observational and additive
- keep journal-specific grading, coaching, behavior scoring, P/L, giveback, and UI workflows out of levels-system

## Test expectations for any future rename

Any future rename or package-export refactor for `src/lib/execution-context` must include tests proving:

- nearest support below an execution is still found
- nearest resistance above an execution is still found
- extension levels can still be used as factual target/context levels
- support/resistance distance percentages remain unchanged
- factual trade location labels remain deterministic
- factual risk context remains deterministic
- supplied `LevelEngineOutput` is not mutated
- supplied `SessionMarketFacts` are not mutated
- supplied `VolumeMarketFacts` are not mutated
- supplied `VolumeShelf[]` remain facts-only
- supplied `MarketContextProfile` remains facts-only metadata
- supplied `MarketContextFactsBundle` remains facts-only metadata
- no LevelEngine calls happen inside the builder
- old/default LevelEngine output behavior remains unchanged
- `runtimeMode` old remains default
- existing import/export behavior is either preserved or migrated through an explicit compatibility step

The rename should not be combined with a behavior change. If behavior changes are needed later, they should happen after the rename through separate, test-first implementation gates.
