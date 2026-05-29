# Candidate Pool Diagnostics Review

Date: 2026-05-29

## Purpose

This review runs the new `LevelCandidatePoolDiagnosticsReport` across representative generated pipeline data. The goal is to identify where extension candidate inventory narrows before extension selection.

This is diagnostics/review only. It does not change support/resistance detection behavior, LevelEngine default output, runtimeMode defaults, extension generation behavior, scoring, selection, alerts, monitoring, Discord behavior, trader-context behavior, or runtime behavior.

## Inputs Used

The diagnostics were generated from deterministic generated candle fixtures, not LevelEngineOutput-only fixtures.

The review script builds five representative samples:

- `LPRN`: low-price runner
- `CHOP`: choppy/messy ticker
- `THIN`: thin-liquidity ticker
- `CLNT`: clean technical mover
- `HIPO`: higher-priced stock

For each sample, the script runs the existing exported pipeline functions:

1. `detectSwingPoints(...)`
2. `buildRawLevelCandidates(...)`
3. `buildSpecialLevelCandidates(...)`
4. `clusterRawLevelCandidates(...)`
5. `scoreLevelZones(...)`
6. `rankLevelZones(...)`
7. `buildLevelCandidatePoolDiagnostics(...)`

Output-only LevelEngine fixtures were not used as full-pipeline inputs because they do not contain raw candidates, clustered zones, or scored-zone inventories.

## Commands Run

```bash
npx tsx src/scripts/run-level-candidate-pool-diagnostics.ts --format text --out docs/examples/level-quality-audit/latest-candidate-pool-diagnostics.txt
```

```bash
npx tsx src/scripts/run-level-candidate-pool-diagnostics.ts --format json --out docs/examples/level-quality-audit/latest-candidate-pool-diagnostics.json
```

## Outputs

- `docs/examples/level-quality-audit/latest-candidate-pool-diagnostics.txt`
- `docs/examples/level-quality-audit/latest-candidate-pool-diagnostics.json`

## Summary Counts

Across five generated samples:

- Raw candidates: 86
- Clustered zones: 53
- Scored zones: 53
- Surfaced levels: 48
- Extension candidates: 0
- Selected extensions: 0

All five samples showed:

- raw-to-clustered narrowing
- scored-to-extension-candidate narrowing
- no support extension candidates
- no resistance extension candidates

## Per-Sample Counts

| Sample | Raw | Clustered | Scored | Surfaced | Extension candidates | Selected extensions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `LPRN` | 20 | 17 | 17 | 14 | 0 | 0 |
| `CHOP` | 20 | 4 | 4 | 4 | 0 | 0 |
| `THIN` | 12 | 8 | 8 | 7 | 0 | 0 |
| `CLNT` | 18 | 13 | 13 | 12 | 0 | 0 |
| `HIPO` | 16 | 11 | 11 | 11 | 0 | 0 |

## Candidate Depth

The generated samples did produce candidate depth at the scored-zone stage:

- `LPRN`: support depth reached 80.2393% below reference; resistance depth reached 16.3304% above reference.
- `CHOP`: support depth reached 3.1479% below reference; resistance depth reached 4.5937% above reference.
- `THIN`: support depth reached 16.3974% below reference; resistance depth reached 14.1731% above reference.
- `CLNT`: support depth reached 19.3469% below reference; resistance depth reached 48.702% above reference.
- `HIPO`: support depth reached 16.0731% below reference; resistance depth reached 33.3011% above reference.

This means raw candidate generation and scored-zone construction were not empty in these generated samples.

## Narrowing Findings

### Raw Candidates To Clustered Zones

All samples narrowed during clustering:

- `LPRN`: 20 raw candidates to 17 clustered zones.
- `CHOP`: 20 raw candidates to 4 clustered zones.
- `THIN`: 12 raw candidates to 8 clustered zones.
- `CLNT`: 18 raw candidates to 13 clustered zones.
- `HIPO`: 16 raw candidates to 11 clustered zones.

The strongest clustering compression was in `CHOP`, where repeated nearby raw levels collapsed into a small number of clustered zones. That matches the expected behavior for a messy range.

### Clustered Zones To Scored Zones

No sample narrowed between clustered zones and scored zones.

That supports the earlier design finding: scoring does not remove candidate inventory. It scores the clustered zones and preserves the inventory count.

### Scored Zones To Surfaced Buckets

Surfaced bucket narrowing occurred in some samples, but not all:

- `LPRN`: resistance narrowed from 7 scored zones to 4 surfaced levels.
- `THIN`: resistance narrowed from 4 scored zones to 3 surfaced levels.
- `CLNT`: support narrowed from 7 scored zones to 6 surfaced levels.
- `CHOP` and `HIPO` surfaced all scored zones in this generated run.

Surfacing is not the only narrowing stage, but it can hide some scored zones from public buckets.

### Scored Zones To Extension Candidates

Every sample narrowed from scored zones to zero extension candidates on both sides.

This is the most important finding from this generated full-pipeline review. The pipeline produced scored support and resistance zones, but the extension boundary eligibility rules found no candidates beyond the surfaced map.

In these generated samples, the extension issue is not that scoring removed zones. It is that all scored frontier levels were either surfaced or inside the surfaced support/resistance map, leaving no separate candidate beyond the boundary for extension selection.

## Cause Assessment

### Raw Candidate Generation

Not the primary issue in this generated review.

All samples produced raw candidates on both sides. Raw candidate generation can still be a real-world issue, but this review did not show empty raw inventory.

### Clustering

Relevant but not the final extension blocker.

Clustering compressed raw candidates in every sample, especially `CHOP`. That explains part of the inventory narrowing and supports a later clustering-preservation review for messy symbols. However, clustered and scored zones still existed after clustering.

### Scored Zone Construction

Not the issue in this review.

Clustered and scored counts matched in every sample. Scoring preserved inventory.

### Surfaced Bucket Selection

Part of the issue.

Surfaced selection consumed or exposed the strongest visible map. In several samples, it surfaced all scored zones on at least one side. Once the surfaced map includes the deepest support or highest practical resistance, extension boundary eligibility has no remaining candidate beyond that map.

### Extension Boundary Eligibility

Primary issue in this generated review.

The scored inventory existed, but extension candidate counts were zero across all samples because current extension eligibility requires candidates beyond:

- the lowest surfaced support for support extensions
- the surfaced resistance boundary for resistance extensions

When surfaced buckets already own the frontier, no extension candidate remains.

### Insufficient Data In Current Fixtures

Partially addressed.

This gate did not rely on output-only fixtures for the full-pipeline review. It used deterministic generated candles and captured pipeline stages directly. However, these are still generated samples, not live historical market captures. The next behavior gate should still be cautious.

## What This Proves

- The diagnostic helper can now show raw, clustered, scored, surfaced, extension-candidate, and selected-extension counts.
- Full pipeline data can be generated without changing LevelEngine default output.
- Scoring is not dropping candidate inventory.
- Clustering compresses candidate inventory, especially for choppy profiles.
- The most recurring blocker in this generated run is extension boundary eligibility after surfaced buckets own the frontier.

## What It Does Not Prove

- It does not prove that real historical symbols always have this same failure mode.
- It does not prove synthetic extensions are needed.
- It does not justify changing extension generation yet.
- It does not prove clustering should change yet, though `CHOP` shows clustering compression is worth reviewing second.

## Recommended Next Gate

Recommended next gate: `extension_candidate_pool_expansion`.

Recommended scope:

- Design and test an optional diagnostic-only expanded extension candidate pool that can compare:
  - current boundary-only extension candidates
  - unselected scored zones
  - farthest scored support/resistance frontier zones
  - surfaced frontier zones that may be better treated as displayed map plus extension context
- Keep selected extensions unchanged in the first implementation.
- Produce side-by-side diagnostics showing whether an expanded pool would create useful extension candidates before changing behavior.

Secondary future gate:

- `clustering_preservation_review`, especially for choppy symbols where raw candidates compress heavily.

Not recommended yet:

- `synthetic_extension_generation_review`
- `raw_candidate_generation_review`
- `scored_zone_preservation_review`
- live extension behavior changes

## Safety

- Support/resistance detection behavior unchanged.
- LevelEngine default output unchanged.
- runtimeMode defaults unchanged.
- Extension generation behavior unchanged.
- Scoring and selection unchanged.
- Alerts, monitoring, Discord, trader-context, and runtime behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
