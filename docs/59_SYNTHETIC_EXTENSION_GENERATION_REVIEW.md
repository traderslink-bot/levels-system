# Synthetic Extension Generation Review

Date: 2026-05-29

## Purpose

This review reruns the multi-sample level quality audit, findings classifier, and extension diagnostics after merging Synthetic Continuation Map Extensions.

The goal is to verify whether synthetic continuation-map extensions improved forward extension coverage without changing surfaced support/resistance buckets, nearest surfaced levels, special levels, real-level scoring, alerts, monitoring, Discord behavior, trader-context behavior, or runtime defaults.

## Input Samples

The review used the deterministic generated pipeline profiles used by the prior candidate-pool and post-expansion reviews:

- `LPRN`: low-price runner
- `CHOP`: choppy/messy ticker
- `THIN`: thin-liquidity ticker
- `CLNT`: clean technical mover
- `HIPO`: higher-priced stock

The static `*-level-output.json` fixtures were not reused as the measurement source because they preserve older `extensionLevels` snapshots. The samples were rebuilt through the current engine so the merged synthetic fallback was active.

## Commands Run

Generated post-synthetic audit, findings, and extension-diagnostic artifacts from the deterministic generated sample profiles:

```bash
npx tsx $env:TEMP/generate-post-synthetic-review.ts
```

Then ran verification:

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-extension-diagnostics.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-extension-candidate-pool-expansion.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-synthetic-extension-generation.test.ts
npm test
```

## Outputs

- `docs/examples/level-quality-audit/post-synthetic-level-quality-audit.json`
- `docs/examples/level-quality-audit/post-synthetic-level-quality-audit.txt`
- `docs/examples/level-quality-audit/post-synthetic-level-quality-findings.json`
- `docs/examples/level-quality-audit/post-synthetic-level-quality-findings.txt`
- `docs/examples/level-quality-audit/post-synthetic-extension-diagnostics.json`
- `docs/examples/level-quality-audit/post-synthetic-extension-diagnostics.txt`

## Before And After Summary

The closest behavior baseline is the synthetic-disabled run on the same deterministic profiles. The prior post-expansion artifacts match that baseline for extension count and surfaced count.

| Metric | Pre-synthetic / post-expansion | Post-synthetic |
| --- | ---: | ---: |
| Sample count | 5 | 5 |
| Surfaced levels | 48 | 48 |
| Extension levels | 1 | 13 |
| Real extension levels | 1 | 1 |
| Synthetic extension levels | 0 | 12 |
| Missing support-extension samples | 5 | 1 |
| Missing resistance-extension samples | 4 | 1 |
| Limited upside-coverage samples | 1 | 0 |
| Limited downside-coverage samples | 0 | 0 |

Synthetic generation improved the recurring extension coverage issue while preserving the surfaced map count.

## Extension Coverage By Sample

| Sample | Pre extensions | Post extensions | Real post extensions | Synthetic post extensions | Downside coverage | Upside coverage | Remaining warnings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `LPRN` | 0 | 1 | 0 | 1 | n/a | 30.3571% | `no_support_extension_coverage` |
| `CHOP` | 0 | 3 | 0 | 3 | 50.6903% | 30.1775% | none |
| `THIN` | 1 | 4 | 1 | 3 | 50% | 31.4103% | none |
| `CLNT` | 0 | 2 | 0 | 2 | 50.2041% | n/a | `no_resistance_extension_coverage` |
| `HIPO` | 0 | 3 | 0 | 3 | 50% | 50% | none |

`THIN` kept its real resistance extension at `1.6968` and added synthetic fill only after that real extension. This confirms real candidate extensions remain preferred.

## Real Vs Synthetic Counts

| Sample | Real support | Real resistance | Synthetic support | Synthetic resistance |
| --- | ---: | ---: | ---: | ---: |
| `LPRN` | 0 | 0 | 0 | 1 |
| `CHOP` | 0 | 0 | 2 | 1 |
| `THIN` | 0 | 1 | 2 | 1 |
| `CLNT` | 0 | 0 | 2 | 0 |
| `HIPO` | 0 | 0 | 2 | 1 |

All synthetic extension entries include `extensionMetadata.extensionSource = "synthetic_continuation_map"` and notes identifying them as synthetic continuation-map / forward-planning levels, not historical support/resistance.

## Missing And Limited Findings

Missing extension findings mostly cleared:

- Support missing fell from all five samples to `LPRN` only.
- Resistance missing fell from four samples to `CLNT` only.
- Limited upside coverage fell from `THIN` to none.
- Limited downside coverage remained none.

The remaining `LPRN` support gap is acceptable in this sample because the low-price runner rule avoided adding an aggressive downside synthetic support ladder. The remaining `CLNT` resistance gap is also acceptable for this first pass because the synthetic fallback stayed conservative instead of forcing a resistance level where the current rules did not produce one.

## Low-Price Runner Safety

`LPRN` gained one synthetic resistance extension at `7.3`, about `30.3571%` above the `5.6` reference price.

No synthetic support extension was added for `LPRN`. That keeps the low-price runner sample from receiving an unnecessarily far downside ladder.

## Clutter And Noise

The synthetic fallback did not create a new audit clutter warning in `CHOP`, `CLNT`, `HIPO`, or `LPRN`.

`THIN` still has one clustered area, but that existed as a level-quality finding and is not caused by synthetic extension generation in this review.

Each sample stayed within the narrow synthetic ladder cap used by the implementation.

## Safety Comparison

The synthetic-disabled and post-synthetic runs confirmed:

- Surfaced counts unchanged: true
- Nearest support unchanged: true
- Nearest resistance unchanged: true
- Special levels unchanged: true
- Synthetic metadata marked: true

This means the behavior change remained limited to `extensionLevels`.

## Findings Classifier Result

Post-synthetic recurring findings:

- `sparse_level_coverage`
- `stale_levels_present`
- `weak_context_levels_present`
- `unenriched_levels_present`
- `healthy_extension_coverage`

The classifier no longer recommends an extension-specific next gate. Its recommended next gates are:

- `thin_liquidity_handling_review`
- `stale_freshness_review`
- `confluence_enrichment_review`

## Baseline Decision

Synthetic continuation-map extensions are recommended as the new extension baseline.

Reasoning:

- They improved coverage from 1 total extension to 13 total extensions across the generated samples.
- Real extension candidates remained preferred.
- Synthetic levels were clearly marked as continuation-map levels.
- Missing and limited extension findings improved materially.
- No surfaced bucket, nearest surfaced level, or special level regression appeared.
- No new extension clutter issue appeared in the audit artifacts.

## Recommended Next Gate

Recommended next gate: `accept_synthetic_extensions_baseline`.

After that, the next live-facing review can be `add_live_preview_review`, using the synthetic-marked extension output in review/test Discord previews before any live behavior change.

No more extension-generation changes are recommended from this review.

## Safety

- Support/resistance detection unchanged.
- LevelEngine default output changed only through the already-merged `extensionLevels` synthetic fallback behavior.
- `runtimeMode` defaults unchanged.
- Surfaced bucket membership unchanged.
- Nearest surfaced levels unchanged.
- Special levels unchanged.
- strengthScore and strengthLabel for real levels unchanged.
- enrichedAnalysis scoring unchanged.
- Alert behavior unchanged.
- Monitoring behavior unchanged.
- Discord behavior unchanged.
- Trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
