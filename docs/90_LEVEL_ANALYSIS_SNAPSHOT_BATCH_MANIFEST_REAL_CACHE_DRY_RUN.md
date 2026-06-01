# LevelAnalysisSnapshot Batch Manifest Real-Cache Dry Run

## Purpose

This gate runs a production-style dry run for the `LevelAnalysisSnapshot` batch
manifest workflow.

The dry run generated a small multi-symbol snapshot batch from existing local
real cached candles, indexed those artifacts with the batch manifest script,
validated the manifest, and committed compact summary artifacts.

This is operational validation only. It does not tune support/resistance
detection, change LevelEngine output behavior, change runtime-mode defaults,
change alert/monitoring/Discord behavior, or add journal interpretation.

## Source Cache Summary

The clean dry-run worktree did not contain `.validation-cache/candles`, so the
dry run used the existing original local cache:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

No network calls were made. No raw cache files were committed.

| Metric | Count |
| --- | ---: |
| Cache JSON files | 2274 |
| Providers | 2 (`ibkr`, `stub`) |
| Provider/symbol groups | 357 |
| Groups with `5m`/`4h`/`daily` | 355 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 |
| Groups with any `15m` directory | 0 |

## Selected Symbols

The dry run used five previously validated IBKR-backed symbols with
`5m`/`4h`/`daily` coverage:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

No selected symbol had local real-cache 15m data.

## Dry-Run Output Path Convention

Full generated snapshots were written to an ignored local path:

```text
artifacts/level-analysis-snapshot-real-cache-dry-run/real-cache-batch-manifest-dry-run-2026-06-01/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
```

The `artifacts/` directory is ignored by git. Full dry-run snapshots were not
committed.

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/batch-manifest-real-cache-dry-run/latest-real-cache-batch-manifest.json
docs/examples/level-analysis-snapshot/batch-manifest-real-cache-dry-run/latest-real-cache-batch-manifest.txt
```

## Commands Run

Install:

```powershell
npm ci
```

Generate ignored real-cache snapshot artifacts:

```powershell
npx tsx -
```

The inline harness normalized local cache wrapper JSON into candle arrays, then
called the existing `runLevelAnalysisSnapshotRunner` function. It did not fetch
data, alter candles, or change LevelEngine behavior.

Generate committed compact batch manifest:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot-batch-manifest.ts --input artifacts/level-analysis-snapshot-real-cache-dry-run/real-cache-batch-manifest-dry-run-2026-06-01 --out docs/examples/level-analysis-snapshot/batch-manifest-real-cache-dry-run/latest-real-cache-batch-manifest.json --output-root artifacts/level-analysis-snapshot-real-cache-dry-run/real-cache-batch-manifest-dry-run-2026-06-01 --batch-id real-cache-batch-manifest-dry-run-2026-06-01 --generated-at 2026-06-01T00:00:00.000Z
```

Validation:

```powershell
npx tsc --noEmit
npm test
```

## Manifest Summary

| Field | Value |
| --- | ---: |
| Total entries | 5 |
| Accepted | 5 |
| Failed | 0 |
| Skipped | 0 |
| Quarantined | 0 |
| With 15m input | 0 |
| Missing 15m input | 5 |
| No-lookahead applied count | 5 |
| Synthetic extensions clearly marked count | 5 |

Manifest safety:

- `noLookaheadAppliedForAccepted: true`
- `syntheticExtensionsClearlyMarkedForAccepted: true`
- `noRuntimeBehaviorChange: true`

## Per-Symbol Manifest Summary

| Symbol | As Of | Reference | Artifact Size | Status | 15m |
| --- | --- | ---: | ---: | --- | --- |
| `DEVS` | `2026-06-01T11:50:00.000Z` | `0.2705` | `161523` | `accepted` | Missing |
| `ENVX` | `2026-05-22T15:25:00.000Z` | `6.73` | `178819` | `accepted` | Missing |
| `DXYZ` | `2026-05-15T11:55:00.000Z` | `46.47` | `170856` | `accepted` | Missing |
| `QUBT` | `2026-05-12T14:20:00.000Z` | `12.799` | `189016` | `accepted` | Missing |
| `GME` | `2026-05-04T15:10:00.000Z` | `24.8` | `168721` | `accepted` | Missing |

## Missing 15m Summary

The dry run confirmed the expected local-cache condition:

- no selected symbol had `15m` cache files;
- every manifest entry has `has15mInput: false`;
- every manifest entry has `missing15mInput: true`;
- `summary.timeframeAvailability["15m"]` is `0`;
- `summary.missing15mInputCount` is `5`.

This is a data availability limitation, not a production bug.

## Checksum And File-Size Summary

The manifest recorded file sizes and SHA-256 checksums for all five generated
snapshot artifacts.

The committed manifest uses relative artifact paths under ignored `artifacts/`.
That keeps the audit surface portable while avoiding commits of bulky generated
snapshots.

## Safety And Diagnostics Summary

All five manifest entries recorded:

- `safety.noLookaheadApplied: true`
- `safety.levelOutputUnchanged: true`
- `safety.factsOnlyVWAP: true`
- `safety.shelvesAreFactsOnly: true`
- `safety.syntheticExtensionsClearlyMarked: true`
- `safety.noRuntimeBehaviorChange: true`

Unique snapshot diagnostics:

- `4h_partial_candles_filtered`
- `candle_close_as_of_filter_applied`
- `candle_inputs_reserved_for_future_fact_generation`
- `daily_partial_candles_filtered`

No validation errors were recorded.

## Limitations

- The dry run depends on a local real-cache directory outside the clean worktree.
- No real 15m cache data was present.
- Full generated snapshots were intentionally left under ignored `artifacts/`.
- The committed manifest references local ignored artifact paths; consumers
  should regenerate or copy the full artifacts when replaying the dry run.
- This is a five-symbol dry run, not a full 355-group batch.

## Production Bug Assessment

No production bug was found.

The batch manifest script successfully indexed a production-shaped real-cache
snapshot batch, and the manifest recorded accepted status, timeframe coverage,
missing-15m state, safety flags, diagnostics, file sizes, and checksums.

## Recommended Next Gate

Recommended next gate:

```text
production_snapshot_runner_batch_manifest_packaging
```

Reason: the dry run proved the workflow works with real cached symbols. The next
step should package this workflow into a repeatable command or small operator
runbook only if the project wants recurring multi-symbol artifact generation.
After that, the project can move into `levels_system_15m_fact_generation_design`
with a cleaner operational surface.
