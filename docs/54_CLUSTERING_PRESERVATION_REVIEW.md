# Clustering Preservation Review

Date: 2026-05-29

## Purpose

This review checks whether the clustering stage is over-compressing useful deeper support/resistance candidates that could matter for extension ladders and forward planning, especially in choppy or thin-liquidity samples.

This is documentation/review only. It does not change clustering behavior, support/resistance detection, LevelEngine default output, runtimeMode defaults, extension generation behavior, scoring, selection, alerts, monitoring, Discord behavior, trader-context behavior, or runtime behavior.

## Current Evidence

The Extension Candidate Pool Expansion Review showed that the fallback behavior is useful but narrow:

- Selected extensions improved from `0` to `1` across the deterministic multi-sample review set.
- `THIN` gained one resistance extension at `1.6968`.
- `THIN` upside extension coverage improved to `8.7692%`.
- `CHOP`, `CLNT`, `HIPO`, and `LPRN` still lacked extension coverage where no safe unselected scored zone existed.
- Support extension coverage did not improve in the generated review set.
- Surfaced buckets, nearest surfaced levels, special levels, scoring, strength labels, enrichedAnalysis scoring, and runtime behavior stayed unchanged.

Earlier candidate pool diagnostics showed where inventory narrowed before the expansion:

| Sample | Raw candidates | Clustered zones | Scored zones | Surfaced levels |
| --- | ---: | ---: | ---: | ---: |
| `LPRN` | 20 | 17 | 17 | 14 |
| `CHOP` | 20 | 4 | 4 | 4 |
| `THIN` | 12 | 8 | 8 | 7 |
| `CLNT` | 18 | 13 | 13 | 12 |
| `HIPO` | 16 | 11 | 11 | 11 |

`CHOP` is the clear compression outlier. It collapsed from 20 raw candidates to 4 clustered zones, with support and resistance each narrowing from 10 raw candidates to 2 clustered/scored/surfaced zones.

That compression may be correct for a messy range, but it is also the most likely place where useful deeper candidates could be folded into broad zones before extension selection can see them.

## Current Clustering Algorithm

The active clustering path is `src/lib/levels/level-clusterer.ts`.

`LevelEngine` builds raw candidates, adds special candidates, and calls `clusterRawLevelCandidates(...)` separately for support and resistance. The current engine path passes the larger of the daily and 4h cluster tolerances, which is `0.01` or 1%.

The clusterer has two passes.

First pass:

- filters raw candidates by side
- sorts candidates by price
- compares each candidate to the current group center
- merges the candidate into the current group when center distance is within tolerance
- starts a new group when the candidate is outside tolerance

Second pass:

- converts first-pass groups into `FinalLevelZone` objects
- sorts zones by `zoneLow`
- merges zones that overlap or are close enough
- derives merge tolerance from the zones' source timeframes
- multiplies that tolerance by `secondPassMergeToleranceMultiplier`
- allows small gap/overlap merges through `overlapMergeTolerancePct`
- rejects a merge if it would exceed `maxMergedZoneWidthPct`

Representative price selection is not an average. The raw representative prefers stronger timeframe, rejection, follow-through, reaction quality, displacement, touch count, repeated reaction count, recency, then side-appropriate price. The second-pass representative uses similar zone-level quality ordering.

## Thresholds And Config

Current clustering-related config in `src/lib/levels/level-config.ts`:

| Setting | Value | Meaning |
| --- | ---: | --- |
| `daily.clusterTolerancePct` | `0.01` | Daily raw clustering tolerance |
| `4h.clusterTolerancePct` | `0.0075` | 4h raw clustering tolerance |
| `5m.clusterTolerancePct` | `0.004` | 5m raw clustering tolerance |
| `secondPassMergeToleranceMultiplier` | `0.6` | Narrows second-pass merge tolerance |
| `overlapMergeTolerancePct` | `0.002` | Allows very close/overlapping zones to merge |
| `maxMergedZoneWidthPct` | `0.03` | Blocks overly wide merged zones |
| `surfacedSpacingPct.daily` | `0.018` | Daily surfaced spacing |
| `surfacedSpacingPct.4h` | `0.012` | 4h surfaced spacing |
| `surfacedSpacingPct.5m` | `0.007` | 5m surfaced spacing |

The most important clustering safety guard is `maxMergedZoneWidthPct: 0.03`. The second pass can merge close zones, but not if the resulting merged zone would become wider than about 3% of its midpoint.

## Existing Test Coverage

Existing tests cover these behavior boundaries:

- `src/tests/level-engine.test.ts` verifies `clusterRawLevelCandidates(...)` preserves the strongest nearby wick-led representative instead of averaging it away.
- `src/tests/level-candidate-pool-diagnostics.test.ts` verifies raw, clustered, scored, surfaced, extension-candidate, and selected-extension stage counts.
- `src/tests/level-extension-candidate-pool-expansion.test.ts` verifies extension pool expansion can use unselected scored zones while surfaced buckets, nearest surfaced levels, and special levels remain unchanged.
- `src/tests/level-strength-ranking.test.ts` covers the separate structural clustering/cluster-penalty path used by the newer ranking model.

There is not yet a focused diagnostic that exposes raw cluster members for the old LevelEngine clustering path.

## How Candidate Depth Can Be Preserved Or Lost

Clustering preserves useful evidence on each resulting `FinalLevelZone`:

- `zoneLow`
- `zoneHigh`
- `representativePrice`
- `touchCount`
- `sourceEvidenceCount`
- `sourceTypes`
- `timeframeSources`
- reaction, rejection, displacement, session, follow-through, and gap-continuation scores
- first and last timestamps
- notes

However, clustering does not currently expose the full raw member list in normal output. Once several raw candidates become one zone, downstream scoring, ranking, and extension selection see one scored zone, not every raw member that formed it.

That is usually desirable: support/resistance should often be a zone rather than a pile of tiny adjacent prices. The risk is that choppy symbols can compress multiple separate reaction prices into one surfaced zone, leaving no separate deeper scored zone for extension planning.

## CHOP Compression Findings

`CHOP` is the strongest signal for this review:

- 20 raw candidates became 4 clustered zones.
- Support raw/clustered/scored/surfaced counts were `10/2/2/2`.
- Resistance raw/clustered/scored/surfaced counts were `10/2/2/2`.
- Scored-zone support depth reached only about `3.1479%` below reference.
- Scored-zone resistance depth reached only about `4.5937%` above reference.
- Post-expansion, `CHOP` still had no support extensions and no resistance extensions.

This compression is consistent with a messy ticker trapped in a tight range. The clustering may be correctly reducing noise. But the review cannot yet prove whether raw candidates inside those clusters contained separate deeper prices that would have mattered for extension planning.

The missing visibility is member-level composition:

- raw member prices per cluster
- raw member source timeframe and source type per cluster
- raw member price span compared with final `zoneLow`/`zoneHigh`
- whether any raw member sits beyond the surfaced frontier
- whether a cluster is broad because of genuine repeated reactions or because multiple distinct levels were merged

## Is Clustering Causing Extension Coverage Issues?

Possibly, but not proven enough for a behavior change.

Evidence that clustering may matter:

- `CHOP` has the heaviest raw-to-clustered compression.
- `CHOP` still lacks extensions after the expansion.
- The expansion cannot help if clustering leaves no unselected scored depth.
- Extension selection only sees scored zones after clustering, not raw candidate members.

Evidence against changing clustering now:

- The clusterer is intentionally designed to reduce noisy adjacent candidates into usable zones.
- `CHOP` may be behaving correctly because the symbol is genuinely range-bound and compressed.
- Scoring preserved all clustered zones, so scoring is not the narrowing stage.
- Loosening clustering could create duplicate micro-levels in the exact messy case that produced this evidence.
- Current diagnostics do not show whether each cluster's raw member prices were distinct enough to deserve preservation.

The safest interpretation is that clustering is a plausible contributor to remaining weak extension coverage, especially for `CHOP`, but the next step should be diagnostics, not threshold tuning.

## Is A Clustering Change Justified Now?

No.

The evidence supports investigation, not a behavior change. A clustering change would happen before scoring, bucket selection, nearest-level selection, special-level handling, and extension selection. That makes it too broad to adjust without member-level evidence.

The current expansion behavior should remain the new extension baseline while clustering diagnostics answer whether useful depth is being hidden inside clusters.

## Risks Of Loosening Clustering

Changing clustering too early could:

- add duplicate nearby support/resistance zones
- increase clutter in choppy tickers
- change surfaced bucket membership
- change nearest support/resistance behavior
- change extension ladders for reasons unrelated to actual quality
- destabilize alert, monitoring, and Discord-readable outputs later
- inflate level counts without improving forward planning quality

Because clustering sits before scoring, ranking, surfaced buckets, nearest levels, and extension selection, even a small threshold change can have a wide output impact.

## Tests Needed Before Any Clustering Behavior Change

Before changing clustering behavior, add tests or diagnostics that prove:

- raw candidate member prices are visible per cluster
- cluster width and member span are measured by side
- representative price choice is preserved
- surfaced buckets remain unchanged unless an explicit future gate allows a change
- nearest surfaced levels remain unchanged unless explicitly allowed
- special levels remain unchanged
- extension behavior changes only in expected fixture cases
- `CHOP`-style fixtures show whether deeper raw members were merged away
- clean technical, thin-liquidity, higher-priced, and low-price runner fixtures do not gain noisy duplicate levels
- input objects are not mutated
- output is deterministic
- runtimeMode old remains default

Any future clustering behavior change should include before/after comparisons for `LPRN`, `CHOP`, `THIN`, `CLNT`, and `HIPO`.

## Recommended Next Gate

Recommended next gate: `clustering_diagnostics`.

Scope for that gate:

- Add a pure diagnostics helper or review script that reports cluster member composition without changing clustering behavior.
- Capture raw member prices per cluster.
- Capture member timeframe/source-type distribution per cluster.
- Capture cluster width percentage and member price span.
- Capture whether raw members inside a cluster sit beyond the surfaced frontier.
- Identify clusters whose member span may hide deeper support/resistance candidates.
- Compare existing clusters against hypothetical split thresholds in diagnostics only.

Not recommended yet:

- `cluster_width_threshold_review`
- `raw_candidate_generation_review`
- `synthetic_extension_generation_review`
- any clustering behavior change

## Safety

- Support/resistance detection behavior unchanged.
- Clustering behavior unchanged.
- Extension generation behavior unchanged.
- LevelEngine default output unchanged.
- runtimeMode defaults unchanged.
- Scoring and selection unchanged.
- Alerts, monitoring, Discord behavior, trader-context behavior, and runtime behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
