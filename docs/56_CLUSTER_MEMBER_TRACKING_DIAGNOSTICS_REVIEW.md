# Cluster Member Tracking Diagnostics Review

Status: complete

Date: 2026-05-29 America/Toronto

## Purpose

This review reruns clustering diagnostics across deterministic multi-sample pipeline data after adding diagnostics-only raw member tracking. The goal is to determine whether CHOP's heavy raw-to-cluster compression is hiding useful deeper extension candidates, or whether the compression is expected for choppy range behavior.

This is review/audit only. No clustering behavior, support/resistance detection, LevelEngine output, runtime defaults, extension generation, scoring, selection, alerts, monitoring, Discord behavior, or trader-context behavior was changed.

## Input Samples

The review used the deterministic generated candle samples from `src/scripts/run-level-clustering-diagnostics.ts`:

- LPRN: low-price runner
- CHOP: choppy/messy ticker
- THIN: thin-liquidity ticker
- CLNT: clean technical mover
- HIPO: higher-priced stock

Each sample runs through the existing deterministic pipeline:

1. swing detection
2. raw level candidate building
3. special level candidate building
4. existing clustering behavior
5. diagnostics-only cluster member tracking
6. clustering diagnostics report generation

## Commands Run

```bash
npx tsx src/scripts/run-level-clustering-diagnostics.ts --format text --out docs/examples/level-quality-audit/latest-clustering-member-diagnostics.txt
npx tsx src/scripts/run-level-clustering-diagnostics.ts --format json --out docs/examples/level-quality-audit/latest-clustering-member-diagnostics.json
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-clustering-diagnostics.test.ts
npm test
```

## Outputs

- Text output: `docs/examples/level-quality-audit/latest-clustering-member-diagnostics.txt`
- JSON output: `docs/examples/level-quality-audit/latest-clustering-member-diagnostics.json`

## Raw Member Tracking

Raw member tracking was exact for this review.

All generated sample clusters reported:

- `rawMemberMapping: "tracked_from_clusterer_diagnostics"`
- `exactRawMemberTrackingAvailable: true`

No sample required inferred raw member mapping.

## Summary By Sample

| Sample | Raw Candidates | Clustered Zones | Compression Ratio | Broad Clusters | Many-Member Clusters | Hidden-Depth Possible |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LPRN | 20 | 17 | 1.1765 | 0 | 0 | 0 |
| CHOP | 20 | 4 | 5.0000 | 0 | 2 | 2 |
| THIN | 12 | 8 | 1.5000 | 0 | 0 | 0 |
| CLNT | 18 | 13 | 1.3846 | 0 | 0 | 0 |
| HIPO | 16 | 11 | 1.4545 | 0 | 0 | 0 |

## CHOP Findings

CHOP remains the only sample with high compression, many-member clusters, and hidden-depth possible warnings.

### CHOP Support Cluster

- Cluster: `CHOP-support-zone-1`
- Zone: 4.8906 to 4.9799
- Representative price: 4.9104
- Raw member count: 9
- Raw member prices: 4.8906, 4.9005, 4.9104, 4.9401, 4.95, 4.9599, 4.97, 4.97, 4.9799
- Raw price span: 1.8094%
- Warnings: `many_members_single_cluster`, `hidden_depth_possible`
- Exact hidden extension-depth member ids: none

The cluster is member-heavy and spans materially different prices, but tracked member diagnostics did not identify a deeper support-side extension-depth member beyond the representative under the current material-depth rule.

### CHOP Resistance Cluster

- Cluster: `CHOP-resistance-zone-2`
- Zone: 5.2318 to 5.3029
- Representative price: 5.3029
- Raw member count: 6
- Raw member prices: 5.2318, 5.2318, 5.2419, 5.2826, 5.2928, 5.3029
- Raw price span: 1.3498%
- Warnings: `many_members_single_cluster`, `hidden_depth_possible`
- Exact hidden extension-depth member ids: none

The resistance representative is already the highest tracked member in the cluster. Exact member tracking does not show a deeper resistance-side candidate hidden above the representative.

## Other Sample Findings

LPRN, THIN, CLNT, and HIPO did not show high compression, broad clusters, many-member cluster warnings, or hidden-depth possible warnings.

HIPO had one support cluster with materially different prices:

- Cluster: `HIPO-support-zone-3`
- Zone: 167.96 to 170.28
- Representative price: 167.96
- Raw member count: 4
- Raw price span: 1.3718%
- Hidden extension-depth member ids: none

This did not cross the many-member or hidden-depth warning thresholds.

## Is Clustering Hiding Useful Extension-Depth Candidates?

Current evidence says no.

CHOP compression is real, but exact raw member tracking did not reveal hidden extension-depth candidates inside the compressed support or resistance clusters. The support cluster is dense around the same local range, and the resistance cluster's representative is already the top raw member in that cluster.

This makes CHOP look more like expected choppy-range compression than a clear case where clustering is hiding deeper extension candidates.

## Should Clustering Behavior Change Now?

No.

The tracked-member diagnostics do not justify loosening clustering thresholds or changing clustering preservation behavior. Changing clustering now risks adding noisy, duplicate, or low-separation levels without evidence that it would improve extension planning.

## Recommended Next Gate

Recommended next gate: `no_clustering_change_yet`.

If extension coverage remains the priority, the evidence now points away from clustering threshold changes and toward a separate `synthetic_extension_generation_review` or raw candidate coverage review. That should be treated as a separate gate, not a clustering behavior change.

## Safety Confirmations

- Clustering behavior unchanged.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- `runtimeMode` defaults unchanged.
- Extension generation unchanged.
- Scoring and selection unchanged.
- Alert, monitoring, Discord, and trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language was added.
