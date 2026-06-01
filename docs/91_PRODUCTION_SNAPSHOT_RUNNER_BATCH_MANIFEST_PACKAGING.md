# Production Snapshot Runner Batch Manifest Packaging

## Purpose

This gate packages the `LevelAnalysisSnapshot` batch workflow into a repeatable
operator path.

The packaged path can read existing local validation-cache candle files, generate
per-symbol snapshot artifacts under an ignored output directory, create a v1
batch manifest, and validate the result without fetching data or changing
LevelEngine behavior.

This is operational packaging only. It does not tune support/resistance
detection, change runtime-mode defaults, change alerts, change monitoring,
change Discord behavior, or add journal interpretation.

## Current Tools

Single-symbol snapshot runner:

```text
src/scripts/run-level-analysis-snapshot.ts
```

Batch manifest runner for already-generated artifacts:

```text
src/scripts/run-level-analysis-snapshot-batch-manifest.ts
```

Local real-cache batch runner:

```text
src/scripts/run-level-analysis-snapshot-real-cache-batch.ts
```

Package commands:

```powershell
npm run snapshot:level-analysis
npm run snapshot:level-analysis:review
npm run snapshot:level-analysis:smoke
npm run snapshot:level-analysis:batch:real-cache -- --cache-root <path> --symbols <symbols> --out-root <path> --batch-id <id> --generated-at <ISO> --provider <provider>
npm run manifest:level-analysis:snapshots
npm run manifest:level-analysis:snapshots:review
```

## Packaging Decision

The packaging scope is a small operator workflow, not a broad production
orchestrator.

The new real-cache batch runner handles the gap exposed by the dry run: before a
manifest can index a batch, the selected symbols need snapshot artifacts. The
runner creates those artifacts from an explicit local cache root and then writes
the batch manifest in the same batch directory.

No personal local paths are hardcoded into package scripts.

## Recommended Operator Workflow

1. Choose an explicit local cache root.
2. Choose a provider such as `ibkr`.
3. Choose a symbol list with known `5m`, `4h`, and `daily` cache coverage.
4. Choose a stable batch id.
5. Run the real-cache batch package command.
6. Inspect the printed summary.
7. Inspect the generated manifest.
8. Preserve or transfer the generated snapshot artifacts and manifest together.
9. Do not commit bulky generated snapshots unless a later gate explicitly asks
   for a compact deterministic fixture.

Example:

```powershell
npm run snapshot:level-analysis:batch:real-cache -- --cache-root .validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --out-root artifacts/level-analysis-snapshot-real-cache-batch --batch-id real-cache-batch-2026-06-01 --generated-at 2026-06-01T00:00:00.000Z
```

## Required Local Inputs

The real-cache batch runner requires:

- `--cache-root <path>`
- `--symbols <comma-separated>`
- `--out-root <path>`
- `--batch-id <id>`

Optional:

- `--generated-at <ISO>`
- `--provider <ibkr|stub|twelve_data>`

The default provider is `ibkr`.

## Cache Expectations

The runner expects validation-cache-style files under:

```text
<cache-root>/<provider>/<SYMBOL>/<timeframe>/<lookbackBars>-<endTimeMs>.json
```

Required timeframes for every selected symbol:

- `5m`
- `4h`
- `daily`

Optional timeframe:

- `15m`

Cache files may be validation-cache wrapper JSON with `response.candles`, an
object with a top-level `candles` array, or a candle array.

The runner uses only local files. It does not call live providers or network
fetch paths.

## Output Paths

The runner writes full snapshot artifacts to:

```text
<out-root>/<batch-id>/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
```

The runner writes the manifest to:

```text
<out-root>/<batch-id>/level-analysis-snapshot-batch-manifest-v1.json
```

Recommended output root:

```text
artifacts/level-analysis-snapshot-real-cache-batch
```

`artifacts/` is ignored by git. Generated full snapshots should remain local
operational artifacts unless a later gate explicitly creates a compact fixture.

## Batch Id Conventions

Use stable, readable batch ids:

- `real-cache-batch-2026-06-01`
- `journal-handoff-cache-batch-2026-06-01`
- `multi-symbol-replay-batch-2026-06-01-open`

Avoid batch ids that depend on local machine paths.

## Symbol List Conventions

Pass symbols as a comma-separated list:

```text
DEVS,ENVX,DXYZ,QUBT,GME
```

The runner uppercases symbols and removes duplicates. If any selected symbol is
missing required `5m`, `4h`, or `daily` cached candles, the run fails with an
explicit missing-cache message.

## Artifact Retention Rules

- Keep full snapshot artifacts with the manifest when handing off a batch.
- Do not edit generated snapshot JSON by hand.
- Use manifest `fileSizeBytes` and `checksumSha256` for audit checks.
- Regenerate the batch when candle cache files, symbol lists, or batch ids
  change.
- Do not commit local cache files.

## Manifest Validation Steps

The generated manifest should show:

- `schemaVersion: level-analysis-snapshot-batch-manifest/v1`
- `producer: levels-system`
- accepted entries for all generated snapshots;
- per-entry `fileSizeBytes` and `checksumSha256`;
- locked timeframe coverage keys for `5m`, `15m`, `4h`, and `daily`;
- safety flags copied from each snapshot;
- summary counts for accepted, failed, quarantined, missing 15m, and with 15m.

For downstream readiness, accepted entries should have:

- `noLookaheadApplied: true`
- `syntheticExtensionsClearlyMarked: true`
- `status: accepted`

## Missing 15m Handling

`15m` remains optional and reserved for future fact generation.

If `15m` cache files are absent, the runner still generates snapshots from
required `5m`, `4h`, and `daily` inputs. The manifest records:

- `has15mInput: false`
- `missing15mInput: true`
- `summary.missing15mInputCount`

If `15m` cache files are present, the runner passes them into the snapshot
builder for inputSummary and no-lookahead filtering only. 15m candles are still
not used for LevelEngine support/resistance generation.

## Safety Checks

The packaged runner path preserves the existing snapshot safety boundary:

- no lookahead is applied by candle-close filtering;
- LevelEngine output behavior is unchanged;
- VWAP and volume shelves remain facts-only;
- synthetic continuation-map rows remain clearly marked;
- no runtime behavior changes are introduced.

## Downstream Handoff Steps

Downstream systems should receive:

- the generated manifest;
- every full snapshot artifact referenced by accepted manifest entries;
- the batch id and generated-at timestamp;
- any operator note about missing 15m cache coverage.

Downstream systems should validate the manifest first, then load accepted
snapshot artifacts by path and checksum.

## Limitations

- Local file cache only.
- JSON output only.
- No scheduling, cloud storage, retention automation, Discord posts, alerting,
  or monitoring hooks.
- The runner fails on missing required timeframe cache instead of inventing
  partial batches.
- 15m remains inputSummary/future-fact readiness only.

## Validation Added

`src/tests/level-analysis-snapshot-batch-runner-packaging.test.ts` creates a
temporary validation-cache-shaped fixture from committed candle examples, runs
the packaged batch runner, validates generated snapshots and manifest output,
checks missing/supplied 15m behavior, and confirms the script stays isolated
from network, alert, monitoring, Discord, and trader behavior paths.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_fact_generation_design
```

Reason: the operational path now exposes missing or supplied 15m coverage
clearly. The next meaningful levels-system step is to design what 15m facts
should eventually contribute without feeding 15m into LevelEngine level
generation prematurely.
