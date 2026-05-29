# Clustering Diagnostics Review

Date: 2026-05-29

## Purpose

This review runs the new clustering diagnostics across the deterministic multi-sample candidate pipeline data. The goal is to verify whether clustering is actually hiding useful deeper support/resistance candidates, especially in `CHOP`, before changing clustering behavior.

This is diagnostics/review only. It does not change clustering behavior, support/resistance detection, LevelEngine default output, runtimeMode defaults, extension generation behavior, scoring, selection, alerts, monitoring, Discord behavior, trader-context behavior, or runtime behavior.

## Input Samples Used

The review uses the deterministic generated sample pipeline data used by the candidate pool diagnostics work:

- `CHOP`: choppy/messy ticker
- `THIN`: thin-liquidity ticker
- `CLNT`: clean technical mover
- `HIPO`: higher-priced stock
- `LPRN`: low-price runner

Each sample runs the existing pipeline through:

1. swing detection
2. raw candidate building
3. special candidate building
4. current clustering
5. clustering diagnostics

The saved output-only LevelEngine fixtures were not used for this review because they do not contain raw candidates or clustered-zone construction data.

## Raw Member Mapping

Raw member mapping was available only as an inferred diagnostic.

Current `FinalLevelZone` objects do not retain raw candidate member IDs. The diagnostics infer raw membership from:

- side/kind
- zone span
- source type
- timeframe

No sample produced unavailable raw-member mapping in this run. That means every clustered zone could be mapped to raw members through the current inference. It does not mean the mapping is a first-class cluster-member contract yet.

## Commands Run

```bash
npx tsx src/scripts/run-level-clustering-diagnostics.ts --format text --out docs/examples/level-quality-audit/latest-clustering-diagnostics.txt
```

```bash
npx tsx src/scripts/run-level-clustering-diagnostics.ts --format json --out docs/examples/level-quality-audit/latest-clustering-diagnostics.json
```

```bash
npx tsc --noEmit
```

```bash
npx tsx --test --test-timeout=90000 src/tests/level-clustering-diagnostics.test.ts
```

```bash
npm test
```

## Outputs

- `docs/examples/level-quality-audit/latest-clustering-diagnostics.json`
- `docs/examples/level-quality-audit/latest-clustering-diagnostics.txt`

## Summary

Across five generated samples:

- Raw candidates: 86
- Clustered zones: 53
- Average compression ratio: 2.1031
- Samples with high compression: `CHOP`
- Samples with broad clusters: none
- Samples with many-member clusters: `CHOP`
- Samples with hidden-depth possible: `CHOP`
- Samples with unavailable raw member mapping: none

## Per-Sample Results

| Sample | Raw candidates | Clustered zones | Compression ratio | Broad clusters | Many-member clusters | Hidden-depth possible |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `LPRN` | 20 | 17 | 1.1765 | 0 | 0 | 0 |
| `CHOP` | 20 | 4 | 5 | 0 | 2 | 2 |
| `THIN` | 12 | 8 | 1.5 | 0 | 0 | 0 |
| `CLNT` | 18 | 13 | 1.3846 | 0 | 0 | 0 |
| `HIPO` | 16 | 11 | 1.4545 | 0 | 0 | 0 |

## CHOP-Specific Findings

`CHOP` remains the standout compression case:

- 20 raw candidates compressed into 4 clustered zones.
- Clustered support/resistance counts were 2/2.
- Compression ratio was 5.
- Broad cluster count was 0.
- Many-member cluster count was 2.
- Hidden-depth possible cluster count was 2.
- Largest raw member span was 1.8094%.
- Largest raw member count was 9.

Flagged clusters:

| Cluster | Side | Zone | Representative | Raw members | Raw span | Warnings |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `CHOP-support-zone-1` | support | 4.8906-4.9799 | 4.9104 | 9 | 1.8094% | `many_members_single_cluster`, `hidden_depth_possible` |
| `CHOP-resistance-zone-2` | resistance | 5.2318-5.3029 | 5.3029 | 6 | 1.3498% | `many_members_single_cluster`, `hidden_depth_possible` |

Interpretation:

- The high compression is real.
- The compressed clusters are member-heavy.
- The compressed clusters are not broad under the current 2% broad-span threshold.
- This looks consistent with a choppy symbol where repeated nearby raw reactions collapsed into compact zones.
- It may hide multiple raw candidate depths, but the spans are still tight enough that a clustering threshold change is not justified yet.

## Thin-Liquidity Findings

`THIN` did not show clustering as the primary issue in this diagnostic run:

- 12 raw candidates compressed into 8 clustered zones.
- Compression ratio was 1.5.
- Broad clusters: 0.
- Many-member clusters: 0.
- Hidden-depth possible clusters: 0.
- Largest raw span was 0.3968%.
- Largest raw member count was 2.

This suggests `THIN`'s remaining extension weakness is not primarily from over-compression in clustering. It is more likely due to limited candidate inventory or shallow candidate depth.

## CLNT And HIPO Findings

`CLNT` and `HIPO` did not show strong clustering danger signals:

- `CLNT`: compression ratio 1.3846, no broad/many-member/hidden-depth flags.
- `HIPO`: compression ratio 1.4545, no broad/many-member/hidden-depth flags.

`HIPO` had a largest raw span of 1.3718% and largest raw member count of 4, but that remained below the many-member threshold and below the broad-span warning threshold.

Their remaining extension limitations look more related to available candidate depth than harmful clustering compression.

## Low-Price Runner Findings

`LPRN` looked healthy from a clustering perspective:

- 20 raw candidates compressed into 17 clustered zones.
- Compression ratio was 1.1765.
- Broad clusters: 0.
- Many-member clusters: 0.
- Hidden-depth possible clusters: 0.
- Largest raw span was 0.0969%.

The low-price runner sample does not support loosening clustering behavior.

## Did Clustering Likely Cause Extension Candidate Loss?

Partially possible for `CHOP`, but not proven.

The diagnostics show that `CHOP` compresses many raw members into only four clustered zones. That can reduce the number of scored zones available to extension selection. However, the flagged cluster spans are compact and below the broad-span threshold.

For the other samples, clustering does not look like the main extension blocker:

- `THIN` has mild compression and no hidden-depth flags.
- `CLNT` has mild compression and no hidden-depth flags.
- `HIPO` has mild compression and no hidden-depth flags.
- `LPRN` has very light compression and no hidden-depth flags.

The current evidence supports treating `CHOP` as a clustering diagnostics case, not as proof that clustering thresholds should be loosened.

## Should Clustering Behavior Change Now?

No.

Current evidence is still not strong enough to change clustering behavior. The diagnostics show member-heavy compression in `CHOP`, but the spans are tight and consistent with messy range behavior. Loosening clustering now could create duplicate nearby levels and change surfaced buckets, nearest levels, extension ladders, and downstream monitoring behavior.

The system needs exact member-tracking diagnostics before any clustering behavior change.

## Recommended Next Gate

Recommended next gate: `cluster_member_tracking_diagnostics`.

Reasoning:

- Current raw member mapping is inferred, not exact.
- `CHOP` needs exact cluster member lineage before tuning thresholds.
- The next diagnostic should show first-pass groups, second-pass merges, raw member IDs, cluster span changes, and whether any member crossed an extension-relevant depth boundary.

Not recommended yet:

- `cluster_width_threshold_review`
- `raw_candidate_generation_review`
- `synthetic_extension_generation_review`
- any clustering behavior change

## Safety

- Clustering behavior unchanged.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- runtimeMode defaults unchanged.
- Extension generation unchanged.
- Scoring and selection unchanged.
- Alerts, monitoring, Discord behavior, trader-context behavior, and runtime behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
