# Levels System 15m Facts Contract

## Purpose

This document records the additive facts-only `15m` contract for
`LevelAnalysisSnapshot` v1.

The contract gives `levels-system` a stable place to carry future 15m-derived
chart context without feeding 15m candles into LevelEngine support/resistance
detection. This gate defines TypeScript types, validation helpers, deterministic
fixtures, and optional snapshot passthrough only. It does not implement
candle-based 15m fact generation.

## Completion Status

The contract surface is now present as:

```ts
type LevelAnalysisTimeframeFacts = {
  "15m"?: FifteenMinuteFacts;
};
```

`LevelAnalysisSnapshot` can now carry this optional additive field:

```ts
timeframeFacts?: LevelAnalysisTimeframeFacts;
```

The field is optional and v1-compatible. Existing snapshots without
`timeframeFacts` remain valid.

## Contract Shape

`FifteenMinuteFacts` uses this schema identifier:

```text
level-analysis-15m-facts/v1
```

Required factual sections:

- `symbol`
- `asOfTimestamp`
- `dataCompleteness`
- `range`
- `trend`
- `structure`
- `diagnostics`
- `limitations`
- `safety`

Optional factual section:

- `volume`

Safety flags:

- `noLookaheadApplied`
- `levelOutputUnchanged`
- `factsOnly`
- `noRuntimeBehaviorChange`

All safety flags must be true for a valid facts object.

## Current 15m Behavior

Current from-candles behavior remains unchanged:

- optional 15m candles can be supplied to the snapshot builder path;
- 15m candles are filtered with candle-close as-of rules;
- 15m input counts are reported in `inputSummary`;
- supplied 15m input is diagnosed as reserved for future fact generation;
- 15m candles are not fed into LevelEngine;
- 15m candles do not change surfaced support/resistance buckets.

This gate does not add automatic generation of `timeframeFacts["15m"]` from
candles. That remains a future gate.

## Validation Helpers

New helper module:

```text
src/lib/analysis/level-analysis-timeframe-facts.ts
```

Helpers:

- `isFifteenMinuteFacts(value)`
- `validateFifteenMinuteFacts(value)`
- `assertFifteenMinuteFactsAreFactsOnly(value)`
- `createUnavailableFifteenMinuteFacts(input)`
- `summarizeFifteenMinuteFacts(value)`

Validation checks:

- schema version is `level-analysis-15m-facts/v1`;
- identity fields are present;
- required factual sections are objects;
- diagnostics and limitations are arrays;
- safety flags exist and are true;
- facts-only boundaries are preserved.

## Fixture Pack

Deterministic contract fixtures live in:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m/
```

Fixtures:

- `15m-facts-unavailable.json`
- `15m-facts-limited.json`
- `15m-facts-mixed.json`
- `15m-facts-compression.json`
- `15m-facts-expansion.json`

These fixtures are manual deterministic contract samples. They are not generated
from real candles and must not be treated as validation of a production 15m fact
builder.

## Facts-Only Boundary

15m facts may describe:

- data availability and completeness;
- recent range state;
- reference price position relative to the recent 15m range;
- trend-state counts from closed candles;
- volume participation when available;
- simple structure-state facts;
- diagnostics and limitations.

15m facts must not:

- create support/resistance levels;
- create raw level candidates;
- alter LevelEngine input series;
- alter LevelEngine output;
- alter surfaced buckets;
- create synthetic historical evidence;
- change runtime behavior;
- change alerts, monitoring, or Discord behavior;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Snapshot Compatibility

`timeframeFacts` is additive and optional.

Compatibility rules:

- v1 snapshots without `timeframeFacts` remain valid;
- downstream tolerant readers should preserve unknown fields;
- `timeframeFacts["15m"]` must not replace `inputSummary`;
- `timeframeFacts["15m"]` must not replace `levelEngineOutput`;
- adding `timeframeFacts["15m"]` must not change `levelEngineOutput`,
  nearest-level derivation, or safety semantics.

The focused tests compare snapshots with and without supplied 15m facts and
assert that `levelEngineOutput` remains unchanged.

## No-Lookahead Rules

The contract assumes the same candle-close as-of rules already used by the
from-candles snapshot builder:

- future candles are excluded;
- still-forming candles are excluded;
- counts are reported as factual completeness;
- `asOfTimestamp` is the snapshot boundary;
- facts must not be derived from data after `asOfTimestamp`.

For this contract-only gate, deterministic fixtures set `noLookaheadApplied` to
true because they represent already-filtered factual states.

## Intentionally Unchanged

This gate does not:

- implement 15m candle-to-fact generation;
- feed 15m candles into LevelEngine;
- tune support/resistance detection;
- change LevelEngine default output behavior;
- change `runtimeMode` defaults;
- change alert behavior;
- change monitoring behavior;
- change Discord behavior;
- modify the journal app;
- add journal interpretation behavior.

## Test Coverage

Focused tests were added in:

```text
src/tests/level-analysis-15m-facts-contract.test.ts
```

Coverage includes:

- fixture parsing and validation;
- malformed and unsafe payload rejection;
- helper behavior for unavailable facts and summaries;
- unavailable, limited, mixed, compression, and expansion fixture states;
- facts-only boundary checks;
- optional snapshot additive compatibility;
- `levelEngineOutput` equality with and without supplied 15m facts.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_facts_builder
```

Reason: the additive facts contract and deterministic fixture states now exist.
The next safe step is a pure 15m fact builder from already-filtered closed 15m
candles, still isolated from LevelEngine and runtime behavior.
