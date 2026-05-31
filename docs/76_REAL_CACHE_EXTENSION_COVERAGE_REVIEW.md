# Real Cache Extension Coverage Review

## Scope

This review investigates why the real cached `LevelAnalysisSnapshot` artifacts for `DEVS`, `AIM`, and `PBM` did not include synthetic continuation-map resistance extensions despite `LevelQualityAudit` reporting missing resistance extension coverage.

This is review/audit only. No support/resistance detection, LevelEngine behavior, runtime mode, alert behavior, monitoring behavior, Discord behavior, trader-context behavior, scoring, selection, journal grading, coaching, P/L, giveback, behavior scoring, or recommendation language was changed.

## Inputs Inspected

Real-cache snapshot outputs:

- `docs/examples/level-analysis-snapshot/real-cache-outputs/low-price-runner-devs-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/clean-technical-envx-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/choppy-aim-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/thin-liquidity-pbm-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/higher-priced-dxyz-snapshot.json`

Extracted LevelEngineOutput diagnostics inputs:

- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs/aim-level-output.json`
- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs/devs-level-output.json`
- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs/dxyz-level-output.json`
- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs/envx-level-output.json`
- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs/pbm-level-output.json`

Diagnostics outputs:

- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/latest-real-cache-extension-diagnostics.json`
- `docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/latest-real-cache-extension-diagnostics.txt`

## Commands Run

Extract embedded `levelEngineOutput` objects from the real-cache snapshots:

```powershell
node -e "<extract snapshot.levelEngineOutput into docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs/>"
```

Run extension diagnostics:

```powershell
npx tsx src/scripts/run-level-extension-diagnostics.ts --fixture-dir docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs --format json --out docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/latest-real-cache-extension-diagnostics.json
npx tsx src/scripts/run-level-extension-diagnostics.ts --fixture-dir docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/level-outputs --format text --out docs/examples/level-analysis-snapshot/real-cache-extension-diagnostics/latest-real-cache-extension-diagnostics.txt
```

Regenerate real-cache snapshots from current main to check for stale pre-synthetic artifacts:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol DEVS --as-of 2026-05-29T13:40:00.000Z --reference-price 0.2592 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/daily-candles.json --previous-close 0.127 --out docs/examples/level-analysis-snapshot/real-cache-outputs/low-price-runner-devs-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol ENVX --as-of 2026-05-22T15:25:00.000Z --reference-price 6.73 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/daily-candles.json --previous-close 6.26 --out docs/examples/level-analysis-snapshot/real-cache-outputs/clean-technical-envx-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol AIM --as-of 2026-05-28T14:00:00.000Z --reference-price 0.373 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/daily-candles.json --previous-close 0.3815 --out docs/examples/level-analysis-snapshot/real-cache-outputs/choppy-aim-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol PBM --as-of 2026-05-07T12:15:00.000Z --reference-price 6.07 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/daily-candles.json --previous-close 5.98 --out docs/examples/level-analysis-snapshot/real-cache-outputs/thin-liquidity-pbm-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol DXYZ --as-of 2026-05-15T11:55:00.000Z --reference-price 46.47 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/daily-candles.json --previous-close 48.94 --out docs/examples/level-analysis-snapshot/real-cache-outputs/higher-priced-dxyz-snapshot.json
```

Validation:

```powershell
npx tsc --noEmit
npm test
```

## Diagnostic Summary

| Symbol | Reference | Support Extensions | Resistance Extensions | Synthetic Extensions | Audit Warning | Diagnostics Finding |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `DEVS` | `0.2592` | `3` | `0` | `0` | `missing_resistance_extension` | No eligible resistance candidate beyond surfaced map |
| `ENVX` | `6.73` | `3` | `1` | `0` | `limited_downside_extension_coverage` | Real resistance extension is healthy; real support extensions fill all slots but downside depth is shallow |
| `AIM` | `0.373` | `3` | `0` | `0` | `missing_resistance_extension` | No eligible resistance candidate beyond surfaced map |
| `PBM` | `6.07` | `3` | `0` | `0` | `missing_resistance_extension` | No eligible resistance candidate beyond surfaced map |
| `DXYZ` | `46.47` | `3` | `1` | `0` | None | Healthy two-sided real extension coverage |

Diagnostics summary:

- Sample count: `5`
- Missing support extension samples: `0`
- Missing resistance extension samples: `3`
- Limited upside coverage samples: `0`
- Limited downside coverage samples: `1`
- Insufficient candidate inventory samples: `3`
- Undetermined rejection reasons: `0`

## Synthetic Continuation-Map Presence

No selected real-cache snapshot contains `extensionMetadata.extensionSource = "synthetic_continuation_map"`.

This was not caused by stale artifacts. Regenerating the five snapshots from current main produced no diff in `docs/examples/level-analysis-snapshot/real-cache-outputs/`.

## Why DEVS, AIM, And PBM Did Not Get Synthetic Resistance Rows

The synthetic fallback is active in the `LevelAnalysisSnapshot` from-candles path because it uses `rankLevelZones`, which calls `buildLevelExtensions`.

The absence of synthetic resistance rows is explained by the current synthetic safety rules:

- Real historical/candidate extensions are considered first.
- Synthetic resistance levels must be outside the surfaced resistance map.
- Synthetic resistance levels must stay inside the practical forward range, currently about `50%` above reference.
- The deterministic ladder tries roughly `30%` and `50%` targets when no real extension exists.
- Round-number-aware rounding can push the `50%` target just above the practical max, especially for low-priced names.

For the three missing-resistance cases, the `30%` target was inside the surfaced resistance map, and the `50%` target rounded beyond the practical max.

| Symbol | Surfaced Resistance Range | Practical Max | 30% Synthetic Target | 50% Synthetic Target | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `DEVS` | `0.2624` to `0.3501` | `0.3888` | `0.34`, inside surfaced map | `0.39`, above max after rounding | Synthetic blocked by design |
| `AIM` | `0.375` to `0.5392` | `0.5595` | `0.49`, inside surfaced map | `0.56`, above max after rounding | Synthetic blocked by design |
| `PBM` | `6.09` to `8` | `9.105` | `7.9`, inside surfaced map | `9.2`, above max after rounding | Synthetic blocked by design |

The audit warning says there are no resistance `extensionLevels`, but these snapshots still have surfaced resistance levels extending meaningfully above reference. The synthetic engine intentionally avoids adding duplicate continuation-map rows inside the surfaced map.

## ENVX

`ENVX` has one real resistance extension at `9.86`, giving `46.5082%` upside extension coverage. That behavior is expected.

The audit warning is downside-only: support extension coverage is `16.9391%`. Synthetic support did not fill the downside because all three extension slots were already occupied by real support extension candidates. This is consistent with the rule that real candidates are preferred over synthetic continuation-map levels.

## DXYZ

`DXYZ` has healthy two-sided real extension coverage:

- Support extensions: `3`
- Resistance extensions: `1`
- Downside coverage: `48.3538%`
- Upside coverage: `45.6639%`
- Audit warnings: none

This is expected behavior and is the cleanest real-cache extension example in this batch.

## Is This A Bug?

No production extension-generation bug was found.

The most likely explanation is expected behavior from the synthetic safety conditions:

- The snapshot-from-candles path is using the current extension engine.
- Synthetic fallback is available.
- The artifacts were not stale.
- DEVS, AIM, and PBM had no eligible resistance candidate beyond the surfaced map.
- Synthetic target prices were either inside the surfaced map or outside the practical max after rounding.
- Real extensions remained preferred over synthetic extensions.

The subtle issue is review semantics: `LevelQualityAudit` reports missing resistance extension rows, while the surfaced resistance map may already provide forward resistance coverage. That is an audit interpretation gap, not evidence that synthetic generation failed.

## Implementation Changes Needed

No extension generation change is recommended from this review.

Potential future improvements:

- Add real-cache tests proving synthetic extensions are not added when surfaced resistance already covers the target ladder area.
- Add audit wording or diagnostics that distinguish "no extensionLevels rows" from "no forward resistance coverage anywhere in surfaced plus extension map."
- Consider support-side synthetic fill behavior later only if real extensions fill all slots but remain too shallow across more real-cache samples.

## Recommended Next Gate

Recommended next gate: `add_real_cache_synthetic_extension_tests`.

Rationale: lock in the expected behavior with real-cache fixtures before tuning synthetic conditions. The tests should prove:

- synthetic fallback is active in the snapshot-from-candles path,
- synthetic rows are not added inside the surfaced map,
- synthetic rows are not added beyond practical max after round-number adjustment,
- real extensions remain preferred over synthetic rows,
- surfaced buckets and nearest levels remain unchanged.
