# LevelAnalysisSnapshot Export Review

## Scope

This review adds a dev/review export runner for TraderLink Intelligence and journal consumers. The runner builds a serializable `LevelAnalysisSnapshot` from deterministic candle JSON inputs using the existing no-lookahead-safe from-candles builder.

This gate did not add Discord, alert, monitoring, trader-context, trade grading, coaching, P/L, giveback, or journal behavior.

## Commands Run

Generate the sample snapshot artifact:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

Validation commands:

```powershell
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot-from-candles.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot-runner.test.ts
npm test
```

## Input Fixtures

- `docs/examples/level-analysis-snapshot/sample-5m-candles.json`
- `docs/examples/level-analysis-snapshot/sample-4h-candles.json`
- `docs/examples/level-analysis-snapshot/sample-daily-candles.json`

Fixture timestamp handling:

- Candle timestamps are stored as ISO strings for review readability.
- The runner normalizes candle timestamps to millisecond timestamps before calling the snapshot builder.
- The snapshot is built as of `2026-05-01T10:20:00-04:00`.

## Output Artifact

- `docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json`

Snapshot summary from the generated artifact:

- Symbol: `SNAP`
- `asOfTimestamp`: `1777645200000`
- Reference price: `10.68`
- Total audited levels: `5`
- Support extensions: `2`
- Resistance extensions: `0`
- Synthetic continuation-map extensions: `2`
- Safety `noLookaheadApplied`: `true`
- Safety `syntheticExtensionsClearlyMarked`: `true`

## Snapshot Shape

The exported JSON includes:

- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `levelEngineOutput`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

The runner currently supports JSON output only. It prints JSON to stdout by default and writes the same deterministic JSON when `--out` is provided.

## No-Lookahead / As-Of Behavior

The runner delegates to `buildLevelAnalysisSnapshotFromCandles`, which applies the existing candle-close/as-of filtering before building levels, facts, context, intelligence, and audit output.

The generated artifact includes:

- `diagnostics`: `candle_close_as_of_filter_applied`
- `safety.noLookaheadApplied`: `true`
- `levelEngineOutput.generatedAt`: the supplied as-of timestamp

Replay/as-of behavior is also covered by the existing focused replay safety tests merged before this gate.

## Included Analysis Components

- `LevelEngineOutput`: included.
- `SessionMarketFacts`: included.
- `VolumeMarketFacts`: included.
- `VolumeShelf[]`: included.
- `MarketContextProfile`: included.
- `MarketContextFactsBundle`: included.
- `LevelIntelligenceReport`: included.
- `LevelQualityAuditReport`: included.

## Synthetic Extension Marking

The generated sample includes synthetic continuation-map support extensions. They are clearly marked in both `levelEngineOutput` and `levelIntelligenceReport`:

- `extensionMetadata.extensionSource`: `synthetic_continuation_map`
- `touchCount`: `0`
- `confluenceCount`: `0`
- Notes state that the level is a synthetic continuation-map extension for forward planning only and is not historical support/resistance.
- Evidence limitations include no touch/rejection history and no historical confluence.

## Review Result

The export runner is suitable as a deterministic local review path for downstream TraderLink Intelligence / journal contract validation. It uses candle JSON files only, does not fetch live data, and does not call Discord, alerts, monitoring, or trader-context code.

## Next Recommended Gate

Recommended next gate: `traderlink_journal_contract_fixture_review`.

Rationale: the system now has a concrete serialized `LevelAnalysisSnapshot` artifact that downstream TraderLink Intelligence / journal code can inspect against the contract from `docs/69_TRADERLINK_INTELLIGENCE_LEVEL_ANALYSIS_CONTRACT.md` before schema stabilization or real ticker replay validation.
