# Extension Candidate Pool Expansion Review

Date: 2026-05-29

## Purpose

This review reruns level quality audit, level quality findings, and extension diagnostics after merging the Extension Candidate Pool Expansion gate.

The goal is to verify whether the expansion improved actual extension coverage across the representative multi-sample profiles before moving to another support/resistance tuning gate.

This is review-only. It does not change support/resistance detection, surfaced bucket membership, nearest surfaced levels, special levels, scoring, strength labels, enrichedAnalysis scoring, alerts, monitoring, Discord behavior, trader-context behavior, runtime defaults, or runtime behavior.

## Input Source

The post-expansion artifacts were generated from the deterministic generated pipeline sample profiles used by the candidate pool diagnostics review:

- `LPRN`: low-price runner
- `CHOP`: choppy/messy ticker
- `THIN`: thin-liquidity ticker
- `CLNT`: clean technical mover
- `HIPO`: higher-priced stock

The saved LevelEngineOutput-only fixtures under `docs/examples/level-quality-audit/` were not reused as the post-change measurement source because they preserve pre-expansion `extensionLevels`. Replaying those static JSON files would not exercise the merged selector behavior.

The generated samples were rebuilt through the current engine and then audited.

## Commands Run

```bash
npx tsx src/scripts/run-level-candidate-pool-diagnostics.ts --format json --out %TEMP%\post-expansion-candidate-pool-diagnostics.json
```

Generated post-expansion audit/findings/diagnostic artifacts using the same deterministic pipeline sample definitions and current engine modules.

```bash
npx tsc --noEmit
```

```bash
npx tsx --test --test-timeout=90000 src/tests/level-extension-diagnostics.test.ts
```

```bash
npx tsx --test --test-timeout=90000 src/tests/level-extension-candidate-pool-expansion.test.ts
```

```bash
npm test
```

## Outputs

- `docs/examples/level-quality-audit/post-expansion-level-quality-audit.json`
- `docs/examples/level-quality-audit/post-expansion-level-quality-audit.txt`
- `docs/examples/level-quality-audit/post-expansion-level-quality-findings.json`
- `docs/examples/level-quality-audit/post-expansion-level-quality-findings.txt`
- `docs/examples/level-quality-audit/post-expansion-extension-diagnostics.json`
- `docs/examples/level-quality-audit/post-expansion-extension-diagnostics.txt`

## Before And After Summary

The closest apples-to-apples baseline is `docs/52_CANDIDATE_POOL_DIAGNOSTICS_REVIEW.md`, which used the same deterministic generated pipeline profiles before the expansion.

| Metric | Before expansion | After expansion |
| --- | ---: | ---: |
| Sample count | 5 | 5 |
| Raw candidates | 86 | 86 |
| Clustered zones | 53 | 53 |
| Scored zones | 53 | 53 |
| Surfaced levels | 48 | 48 |
| Selected extensions | 0 | 1 |

The expansion changed only extension selection. It did not change raw candidate generation, clustering, scoring, or surfaced bucket counts in this generated sample set.

## Post-Expansion Extension Coverage

| Sample | Support extensions | Resistance extensions | Downside coverage | Upside coverage | Warnings |
| --- | ---: | ---: | ---: | ---: | --- |
| `LPRN` | 0 | 0 | n/a | n/a | `missing_support_extension`, `missing_resistance_extension`, `insufficient_candidate_inventory` |
| `CHOP` | 0 | 0 | n/a | n/a | `missing_support_extension`, `missing_resistance_extension`, `insufficient_candidate_inventory` |
| `THIN` | 0 | 1 | n/a | 8.7692% | `missing_support_extension`, `limited_upside_extension_coverage`, `insufficient_candidate_inventory` |
| `CLNT` | 0 | 0 | n/a | n/a | `missing_support_extension`, `missing_resistance_extension`, `insufficient_candidate_inventory` |
| `HIPO` | 0 | 0 | n/a | n/a | `missing_support_extension`, `missing_resistance_extension`, `insufficient_candidate_inventory` |

## What Improved

`THIN` gained one resistance extension from the expanded unselected scored-zone pool:

- selected resistance extension: `1.6968`
- upside coverage: `8.7692%`
- resistance missing-extension warning cleared

This confirms the expansion works for the specific failure mode it was designed to handle: the strict frontier pool is empty, but an unselected scored zone still exists on the correct side of reference price.

## What Did Not Improve

Support extension coverage did not improve in the generated set. All five samples still have no support extensions.

Four samples still have no resistance extensions:

- `LPRN`
- `CHOP`
- `CLNT`
- `HIPO`

The expansion does not add synthetic zones. If all available scored zones are already surfaced, too close to surfaced levels, or otherwise unavailable as unselected scored zones, there is still no deeper extension inventory to select.

## Clustered And Sparse Findings

Post-expansion findings still include:

- sparse level coverage in `CHOP`, `HIPO`, `LPRN`, and `THIN`
- stale levels across all five samples
- weak context and unenriched levels across all five samples
- one clustered/cluttered area in `THIN`

The earlier candidate pool review also showed heavy raw-to-clustered compression in `CHOP`. The expansion does not address clustering compression, so cluster preservation/cleanup remains a valid next investigation.

## Low-Price Runner Safety

`LPRN` did not gain a questionable extension in the generated post-expansion sample. That is acceptable from a safety perspective: the fallback did not manufacture coverage when no safe unselected scored zone was available.

The focused unit test coverage still confirms low-price practical forward range behavior remains bounded.

## Did This Fix The Recurring Extension Issues?

Partially, but not broadly.

The expansion fixed one representative missing-resistance case (`THIN`) where an unselected scored zone was available. It did not fix the broader missing support coverage or the no-inventory cases where every useful scored zone is already surfaced.

This means the change is useful and safe, but it is not a complete extension coverage solution.

## Did It Introduce New Issues?

No new runtime or surfaced-output issues were found in this review.

The tests confirm:

- surfaced buckets remain unchanged
- nearest surfaced levels remain unchanged
- special levels remain unchanged
- strict frontier behavior remains preferred when candidates exist beyond the surfaced frontier
- low-price practical range behavior remains bounded
- runtimeMode defaults remain unchanged

The review artifacts still show extension coverage warnings because the fallback is intentionally conservative.

## Is Synthetic Extension Generation Still Needed?

Not as the immediate next gate.

Synthetic generation may eventually be useful for cases where no real scored candidate exists beyond the displayed map. However, the current evidence still points first to understanding and improving candidate preservation, especially around clustering and surfaced-map compression.

Adding synthetic zones before resolving candidate preservation would be premature.

## Is Cluster Cleanup Now The Next Priority?

Yes, as the next evidence-backed review gate.

Recommended next gate: `clustering_preservation_review`.

Reasoning:

- `CHOP` previously showed heavy raw-to-clustered compression.
- The expansion cannot help when clustering leaves no unselected scored depth.
- Sparse coverage and weak context remain recurring findings.
- The fallback behavior should be accepted as a narrow extension baseline, then clustering/noise preservation should be reviewed next.

## Should This Extension Behavior Be Accepted As The New Baseline?

Yes.

The behavior is narrow, deterministic, and evidence-backed:

- It preserves strict frontier selection first.
- It uses unselected scored zones only when strict frontier candidates are empty.
- It stays facts-only and does not add synthetic levels.
- It changes only `extensionLevels` in tested fallback cases.
- It did not change surfaced buckets, nearest surfaced levels, special levels, scoring, strength labels, enrichedAnalysis scoring, or runtime behavior.

## Safety

- Support/resistance detection unchanged.
- LevelEngine default output unchanged except `extensionLevels` in tested fallback cases.
- runtimeMode old remains default.
- Surfaced bucket membership unchanged.
- Nearest surfaced levels unchanged.
- Special levels unchanged.
- strengthScore and strengthLabel unchanged.
- enrichedAnalysis scoring unchanged.
- Alert behavior unchanged.
- Monitoring behavior unchanged.
- Discord behavior unchanged.
- Trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
