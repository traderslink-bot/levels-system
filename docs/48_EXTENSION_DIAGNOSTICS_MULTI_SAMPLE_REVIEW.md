# Extension Diagnostics Multi-Sample Review

Date: 2026-05-28

## Purpose

This review runs extension diagnostics across the multi-sample LevelEngineOutput fixtures. The goal is to determine whether the next extension-related gate should focus on candidate inventory instrumentation, synthetic extension generation, spacing/range configuration, or no engine behavior change yet.

This is diagnostic/review only. It does not change support/resistance detection, LevelEngine output, runtime defaults, extension generation, level selection, bucket membership, nearest levels, extension levels, special levels, strength fields, enrichedAnalysis scoring, alerts, monitoring, Discord behavior, or trader-context behavior.

## Inputs Used

- `docs/examples/level-quality-audit/choppy-level-output.json`
- `docs/examples/level-quality-audit/clean-technical-level-output.json`
- `docs/examples/level-quality-audit/higher-priced-level-output.json`
- `docs/examples/level-quality-audit/low-price-runner-level-output.json`
- `docs/examples/level-quality-audit/thin-liquidity-level-output.json`

These cover:

- choppy/messy ticker
- clean technical mover
- higher-priced stock
- low-price runner
- thin-liquidity ticker

## Commands Run

```bash
npx tsx src/scripts/run-level-extension-diagnostics.ts --fixture-dir docs/examples/level-quality-audit --format text --out docs/examples/level-quality-audit/latest-extension-diagnostics.txt
```

```bash
npx tsx src/scripts/run-level-extension-diagnostics.ts --fixture-dir docs/examples/level-quality-audit --format json --out docs/examples/level-quality-audit/latest-extension-diagnostics.json
```

## Outputs

- `docs/examples/level-quality-audit/latest-extension-diagnostics.txt`
- `docs/examples/level-quality-audit/latest-extension-diagnostics.json`

## Summary

- Sample count: 5
- Missing support extension samples: 1
- Missing resistance extension samples: 2
- Limited upside coverage samples: 0
- Limited downside coverage samples: 2
- Insufficient candidate inventory samples: 2
- Undetermined rejection reasons: 0

## Per-Sample Coverage

| Sample | Support extensions | Resistance extensions | Downside coverage | Upside coverage | Warnings |
| --- | ---: | ---: | ---: | ---: | --- |
| `CHOP` | 0 | 0 | n/a | n/a | `missing_support_extension`, `missing_resistance_extension`, `insufficient_candidate_inventory` |
| `CLNT` | 1 | 1 | 18.0328% | 20.9016% | `limited_downside_extension_coverage` |
| `HIPO` | 1 | 1 | 15.2815% | 21.1796% | `limited_downside_extension_coverage` |
| `LPRN` | 1 | 2 | 33.3333% | 61.9048% | none |
| `THIN` | 1 | 0 | 25.2874% | n/a | `missing_resistance_extension`, `insufficient_candidate_inventory` |

## Missing Extension Findings

`CHOP` has no support extensions and no resistance extensions. The diagnostic can see only surfaced final levels on both sides, so all visible candidate prices are already part of surfaced support/resistance buckets.

`THIN` has a support extension but no resistance extension. The visible resistance-side candidates are all already surfaced resistance levels, leaving no final-output candidate inventory for a resistance extension.

This supports the previous audit finding that missing resistance extensions recur in choppy and thin-liquidity samples.

## Limited Coverage Findings

`CLNT` and `HIPO` both have support and resistance extensions, but downside reach falls below the audit coverage threshold:

- `CLNT`: lowest support extension is `20` versus reference price `24.4`, giving 18.0328% downside coverage.
- `HIPO`: lowest support extension is `158` versus reference price `186.5`, giving 15.2815% downside coverage.

Both samples have resistance extension coverage above 20%, so the recurring limited-coverage issue is currently downside-specific in these fixtures.

## Insufficient Candidate Inventory Findings

The diagnostics report insufficient visible candidate inventory in 2 samples:

- `CHOP`: support and resistance sides both lack eligible visible candidates beyond surfaced levels.
- `THIN`: resistance side lacks eligible visible candidates beyond surfaced levels.

Important limitation: these diagnostics are built from final LevelEngineOutput fixtures. They can show what surfaced and selected levels are present, but they cannot see the raw pre-extension candidate pool that existed before the extension selector ran. Because of that, this review cannot yet prove whether candidate inventory was truly absent, filtered out earlier, or unavailable only in final output.

## Unknown Or Undetermined Findings

The diagnostics reported 0 candidate-level undetermined rejection reasons.

That does not mean all causes are fully known. It means the final-output diagnostic had enough information to label visible candidates as surfaced levels or selected extensions. The raw pre-extension candidates and selector-stage rejection details are still not available, so deeper causes remain unobserved.

## Cause Assessment

### Candidate Inventory

Candidate inventory is the strongest next-gate hypothesis. The missing extension cases show no eligible visible candidates outside surfaced levels, and every report includes the diagnostic note that candidate inventory is limited to final LevelEngineOutput levels.

Before changing extension generation, the engine needs instrumentation around the actual pre-extension candidate inventory and selector decisions.

### Synthetic Generation Absence

The diagnostics confirm that synthetic extension generation is not available in the current extension engine. This may matter for `CHOP` and `THIN`, but the current evidence does not yet prove that synthetic extensions are the correct fix. First we need to know whether real historical candidates were available and filtered out.

### Spacing And Range Configuration

Spacing/range tuning is not the first supported change from this review. The final-output diagnostics did not show rejected eligible candidates that were too close, outside range, or otherwise filtered after becoming visible. `CLNT` and `HIPO` have limited downside reach, but that may be candidate inventory, range configuration, or expected behavior.

### Expected Behavior

Some missing coverage may be acceptable for choppy or thin-liquidity symbols, especially if the engine lacks reliable historical candidates. This review is not enough to conclude that no engine change is needed, but it also does not justify adding synthetic levels yet.

## Recommended Next Gate

Recommended next gate: `candidate_inventory_instrumentation`.

Recommended scope:

- Instrument or expose diagnostic metadata around the raw extension candidate pool before extension selection.
- Capture selected and rejected candidates with deterministic reasons.
- Separate "no candidate existed" from "candidate existed but was filtered".
- Preserve current extension generation behavior and LevelEngine output by default.
- Add tests for `CHOP`, `THIN`, `CLNT`, `HIPO`, and `LPRN` style fixtures before any engine behavior change.

Not recommended yet:

- `synthetic_extension_generation_review`
- `extension_spacing_range_tuning`
- `no_engine_change_yet`

Those may become appropriate after candidate inventory instrumentation shows whether missing or limited coverage is caused by absent inventory, filtering, or intentional range limits.

## Safety

- Extension generation behavior unchanged.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- Runtime behavior unchanged.
- Scoring and selection unchanged.
- Alert, monitoring, Discord, and trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
