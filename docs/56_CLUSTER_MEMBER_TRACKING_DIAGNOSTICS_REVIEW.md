# Cluster Member Tracking Diagnostics Review

Status: complete

Date: 2026-05-29 America/Toronto

## Purpose

This review reruns clustering diagnostics across deterministic multi-sample pipeline data using exact diagnostics-only cluster member tracking.

The goal is to decide whether clustering should be changed now, especially for CHOP, where earlier diagnostics showed high raw-to-cluster compression and possible hidden depth.

This is review/audit only. No clustering behavior, support/resistance detection, LevelEngine output, runtime defaults, extension generation, scoring, selection, alerts, monitoring, Discord behavior, or trader-context behavior was changed.

## Input Samples

The review used the deterministic generated candle samples from `src/scripts/run-level-clustering-diagnostics.ts`:

- CHOP: choppy/messy ticker
- THIN: thin-liquidity ticker
- CLNT: clean technical mover
- HIPO: higher-priced stock
- LPRN: low-price runner

Each sample runs through the existing deterministic pipeline:

1. swing detection
2. raw level candidate building
3. special level candidate building
4. existing clustering behavior
5. diagnostics-only exact cluster member tracking
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

Exact raw member tracking was available for this review.

Every generated sample cluster reported:

- `rawMemberMapping: "tracked_from_clusterer_diagnostics"`
- `exactRawMemberTrackingAvailable: true`

No sample required inferred raw member mapping.

## Summary By Sample

| Sample | Raw Candidates | Clustered Zones | Compression Ratio | Many-Member Clusters | Broad Clusters | Hidden-Depth Possible | Exact Hidden-Depth Candidate Count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CHOP | 20 | 4 | 5.0000 | 2 | 0 | 2 | 0 |
| THIN | 12 | 8 | 1.5000 | 0 | 0 | 0 | 0 |
| CLNT | 18 | 13 | 1.3846 | 0 | 0 | 0 | 0 |
| HIPO | 16 | 11 | 1.4545 | 0 | 0 | 0 | 0 |
| LPRN | 20 | 17 | 1.1765 | 0 | 0 | 0 | 0 |

## CHOP Member Tracking Findings

CHOP remains the only sample with high compression, many-member clusters, and hidden-depth possible warnings.

### CHOP Support Cluster

- Cluster: `CHOP-support-zone-1`
- Zone: 4.8906 to 4.9799
- Representative price: 4.9104
- Raw member count: 9
- Raw member prices: 4.8906, 4.9005, 4.9104, 4.9401, 4.95, 4.9599, 4.97, 4.97, 4.9799
- Raw price span: 1.8094%
- Warnings: `many_members_single_cluster`, `hidden_depth_possible`
- Exact hidden-depth candidate ids: none
- Potential extension-depth member ids: none

The support cluster is member-heavy and spans materially different prices, but exact tracking did not identify a deeper support-side extension-depth member beyond the selected representative under the current material-depth rule.

### CHOP Resistance Cluster

- Cluster: `CHOP-resistance-zone-2`
- Zone: 5.2318 to 5.3029
- Representative price: 5.3029
- Raw member count: 6
- Raw member prices: 5.2318, 5.2318, 5.2419, 5.2826, 5.2928, 5.3029
- Raw price span: 1.3498%
- Warnings: `many_members_single_cluster`, `hidden_depth_possible`
- Exact hidden-depth candidate ids: none
- Potential extension-depth member ids: none

The resistance representative is already the highest tracked raw member in the cluster. Exact tracking does not show a deeper resistance-side candidate hidden above the representative.

## Other Sample Findings

THIN, CLNT, HIPO, and LPRN did not show high compression, broad clusters, many-member cluster warnings, hidden-depth possible warnings, or exact hidden-depth candidate ids.

HIPO had one materially wide support cluster:

- Cluster: `HIPO-support-zone-3`
- Zone: 167.96 to 170.28
- Representative price: 167.96
- Raw member count: 4
- Raw price span: 1.3718%
- Exact hidden-depth candidate ids: none

This did not cross the many-member or hidden-depth warning thresholds.

## Does CHOP Compression Appear Harmful Or Expected?

CHOP compression appears expected for choppy/range behavior, not clearly harmful.

The earlier warning was useful because CHOP compressed 20 raw candidates into 4 clustered zones. However, exact member tracking shows the compressed members are dense inside local support/resistance ranges rather than hiding clear deeper extension-depth candidates.

The warnings still identify that CHOP is compressed and messy, but they do not justify changing clustering behavior.

## Should Clustering Behavior Change Now?

No.

Changing clustering now would risk surfacing noisy, duplicate, or low-separation levels without evidence that useful extension-depth candidates are being lost inside clusters. The exact tracking review supports leaving clustering behavior unchanged for now.

## Recommended Next Gate

Recommended next gate: `no_clustering_change_yet`.

If extension coverage remains the priority, the next separate review should be `synthetic_extension_generation_review`, because this review points away from clustering as the current blocker.

## Safety Confirmations

- Clustering behavior unchanged.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- `runtimeMode` defaults unchanged.
- Extension generation unchanged.
- Scoring unchanged.
- Selection unchanged.
- Alert behavior unchanged.
- Monitoring behavior unchanged.
- Discord behavior unchanged.
- Trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language was added.
