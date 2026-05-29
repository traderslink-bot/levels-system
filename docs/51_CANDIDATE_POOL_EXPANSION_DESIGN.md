# Candidate Pool Expansion Design

Date: 2026-05-29

## Status

Design only.

This document defines the smallest safe path for preserving or exposing deeper candidate inventory for extension planning. It does not change support/resistance detection, LevelEngine default output, runtimeMode defaults, extension generation behavior, level selection, bucket membership, nearest levels, extension levels, special levels, strength fields, enrichedAnalysis scoring, alerts, monitoring, Discord behavior, or trader-context behavior.

## Context

Recent enhanced extension diagnostics showed:

- `CHOP` has no eligible visible support or resistance extension candidates beyond surfaced levels.
- `THIN` has no eligible visible resistance extension candidate beyond surfaced resistance.
- `CLNT` and `HIPO` have downside extension candidates, but the only visible downside candidate is too shallow for the audit coverage threshold.
- Recurring rejection reasons are mostly surfaced-level or surfaced-map related: `already_surfaced`, `inside_surfaced_map`, `too_close_to_surfaced_level`, and `selected_extension`.
- No recurring evidence points to spacing/range rejection as the primary issue.

The extension issue appears candidate-inventory driven, not primarily spacing/range driven.

## Current Pipeline Map

```text
LevelEngine.generateLevels(...)
  -> load daily, 4h, and optional 5m candle series
  -> detectSwingPoints(...) per timeframe
  -> buildRawLevelCandidates(...) from swings
  -> buildSpecialLevelCandidates(...) from session landmarks
  -> clusterRawLevelCandidates(...) separately for support and resistance
  -> scoreLevelZones(...) for clustered support/resistance zones
  -> rankLevelZones(...)
       -> filter surfaced support below reference price
       -> filter surfaced resistance above reference price and within forward surfaced range
       -> select major/intermediate/intraday buckets with spacing
       -> buildLevelExtensions(...)
            -> support candidates below lowest surfaced support
            -> resistance candidates above surfaced resistance boundary
            -> resistance candidates capped by practical forward range
            -> extension spacing and continuity selection
  -> LevelEngineOutput
```

## Current Extension Inventory Source

Extension selection receives:

- full scored `supportZones`
- full scored `resistanceZones`
- surfaced support buckets
- surfaced resistance buckets
- extension spacing/search config
- optional reference price

This means extension selection does not only see the public surfaced buckets. It already receives the complete scored zone arrays produced by clustering and scoring.

The current extension candidate pool is derived from those scored arrays:

- support extension candidates are scored support zones below the lowest surfaced support
- resistance extension candidates are scored resistance zones above the surfaced resistance boundary and within practical forward range

Therefore, if diagnostics show no eligible candidate beyond surfaced levels, the missing inventory is not caused only by the public bucket cap. It is caused by one of these earlier or boundary stages:

- raw swing/candidate generation did not create frontier candidates
- clustering merged frontier raw candidates into surfaced zones
- scoring kept zones but they were not beyond the extension boundary
- extension boundary rules found no scored zones beyond surfaced support/resistance
- final fixture output lacks internal pre-output candidate inventory needed to prove which of those occurred

## Where Deeper Candidates Become Unavailable

The exact code handoff is:

1. `LevelEngine.buildOldOutput(...)` builds `supportZones` and `resistanceZones` by clustering raw candidates and scoring the resulting zones.
2. `rankLevelZones(...)` receives those full scored arrays.
3. `rankLevelZones(...)` surfaces bucket levels with spacing rules.
4. `rankLevelZones(...)` passes the same full scored arrays into `buildLevelExtensions(...)`.
5. `buildLevelExtensions(...)` filters those scored arrays to only zones beyond the surfaced boundary.

So the deepest currently available extension inventory is the scored zone inventory, not raw candidates or pre-cluster candidates.

Deeper candidates become unavailable to extension selection before or at scored-zone inventory construction when:

- no swing point was detected for a frontier price
- no raw candidate was built from a frontier swing
- multiple raw frontier candidates merged into a single surfaced cluster
- a frontier zone exists but is not beyond the extension boundary
- a resistance zone is beyond reference price but outside the practical resistance range

The enhanced fixture diagnostics can prove selected/scored-output visibility. They cannot yet prove raw or clustered inventory loss because saved `LevelEngineOutput` does not carry raw candidates, cluster groups, or scored-but-internal candidates.

## Design Goal

Expose deeper candidate inventory for diagnostics and future extension planning without changing current live behavior.

The first implementation should answer:

- how many raw candidates existed per side/timeframe
- how many clustered zones existed per side
- how many scored zones existed per side
- how many zones were surfaced
- how many scored zones were beyond surfaced extension boundaries
- which zones were excluded because they were surfaced, inside the surfaced map, too close to surfaced levels, outside practical resistance range, or on the wrong side of reference price
- whether missing extensions are caused by raw scarcity, clustering, boundary filters, or genuinely missing historical structure

It should not change selected extensions yet.

## Proposed extensionCandidatePool Shape

The safest first shape is internal and diagnostics-only:

```ts
type ExtensionCandidatePoolStage =
  | "raw_candidate"
  | "clustered_zone"
  | "scored_zone"
  | "surfaced_level"
  | "extension_preselection"
  | "extension_selected";

type ExtensionCandidatePoolItem = {
  id: string;
  side: "support" | "resistance";
  price: number;
  zoneLow?: number;
  zoneHigh?: number;
  stage: ExtensionCandidatePoolStage;
  sourceTimeframes: Array<"daily" | "4h" | "5m">;
  sourceTypes: string[];
  strengthScore?: number;
  strengthLabel?: "weak" | "moderate" | "strong" | "major";
  isSurfaced: boolean;
  isExtensionEligible: boolean;
  isSelectedExtension: boolean;
  exclusionReasons: string[];
};

type ExtensionCandidatePoolDiagnostics = {
  symbol: string;
  referencePrice?: number;
  support: {
    rawCandidateCount: number;
    clusteredZoneCount: number;
    scoredZoneCount: number;
    surfacedCount: number;
    extensionEligibleCount: number;
    selectedExtensionCount: number;
    items: ExtensionCandidatePoolItem[];
  };
  resistance: {
    rawCandidateCount: number;
    clusteredZoneCount: number;
    scoredZoneCount: number;
    surfacedCount: number;
    extensionEligibleCount: number;
    selectedExtensionCount: number;
    items: ExtensionCandidatePoolItem[];
  };
  safety: {
    diagnosticOnly: true;
    levelOutputUnchanged: true;
    extensionGenerationUnchanged: true;
  };
};
```

The exact production type can be narrower. The important contract is that it remains diagnostic-only and does not become part of default `LevelEngineOutput`.

## Public vs Internal vs Diagnostics-Only

Recommended: diagnostics-only internal result, not public default output.

Do not add this to default `LevelEngineOutput.metadata` yet. Adding it to metadata would change serialized output shape for old consumers and could be mistaken for live level output.

Safer options:

- add a pure helper that returns candidate-pool diagnostics from already supplied raw/scored/surfaced inputs
- add an explicit review runner that uses engine internals to produce diagnostics artifacts
- add an optional separate diagnostic API beside `LevelEngineOutput`, not inside default output

If metadata is ever used later, it should be behind an explicit diagnostic mode and tests must prove old/default serialized output remains unchanged.

## Option A: Preserve A Deeper Scored Zone Inventory As Internal extensionCandidatePool

Description:

Keep the scored support/resistance zones available in a named diagnostic pool before extension filtering and selection.

Benefits:

- smallest behavior risk
- uses existing real market-derived zones
- explains current extension selection without creating new zones
- can be added to a separate diagnostic result without changing default output

Risks:

- only shows post-clustering inventory, not raw candidate loss
- may not explain whether a deeper swing was merged away
- if later used for behavior without a separate gate, it could alter extension output

Best use:

First implementation gate for diagnostics, paired with tests proving selected extensions remain identical.

## Option B: Add An Optional Diagnostics-Only Candidate Pool To LevelEngine Metadata

Description:

Attach candidate-pool diagnostics under metadata only when explicitly requested.

Benefits:

- convenient for review artifacts
- keeps diagnostics near the generated output
- can make fixture generation easier

Risks:

- changes output shape when enabled
- may leak into consumers if not carefully isolated
- could confuse diagnostics with public level contracts

Best use:

Not the first choice. Consider only after a separate diagnostic result proves useful and consumers need a single-file artifact.

## Option C: Add An Internal Adapter That Passes Deeper Scored Zones To Extension Selection

Description:

Create an internal adapter that can pass a broader scored-zone pool to extension selection while preserving the existing default path.

Benefits:

- prepares for a later behavior gate
- allows A/B comparison between current extension input and expanded extension input
- still avoids synthetic zones

Risks:

- even if gated, it is closer to behavior change
- expanded inventory may add noisy extensions for choppy symbols
- needs strong parity tests before any runtime use

Best use:

Second-stage implementation after diagnostics prove the broader scored pool exists and is useful.

## Option D: Delay Pool Expansion And Add Synthetic Extension Generation Instead

Description:

Generate synthetic extension zones when real candidate inventory is missing or too shallow.

Benefits:

- can fill empty planning gaps when no real candidate exists
- may help sparse/thin symbols where historical structure is genuinely limited

Risks:

- creates non-observed levels
- can reduce trust in support/resistance output
- needs explicit synthetic labeling, separate confidence, and many tests
- current evidence does not prove real candidate inventory is exhausted upstream

Best use:

Not next. Revisit only after internal candidate-pool diagnostics prove real candidate inventory is truly absent or insufficient.

## Recommended Next Implementation Gate

Recommended next gate: `internal_extension_candidate_pool_diagnostics`.

Scope:

- Add a pure diagnostic helper that accepts raw candidates, clustered zones, scored zones, surfaced levels, selected extensions, reference price, and extension config.
- Return an internal `ExtensionCandidatePoolDiagnostics` object.
- Do not add it to default `LevelEngineOutput`.
- Do not change `buildLevelExtensions(...)` selected output.
- Add a review script only if needed to generate artifacts from deterministic fixtures.

This gate should answer whether deeper candidates existed before extension selection for `CHOP`, `THIN`, `CLNT`, `HIPO`, and `LPRN`.

## Tests Required Before Any Behavior Change

Before changing extension behavior, tests should prove:

- current `buildLevelExtensions(...)` output remains identical with diagnostics enabled
- old/default `LevelEngineOutput` shape remains unchanged
- runtimeMode `old` remains default
- candidate-pool diagnostics capture raw candidate counts by side/timeframe
- candidate-pool diagnostics capture clustered and scored zone counts by side
- candidate-pool diagnostics capture surfaced exclusions
- candidate-pool diagnostics capture extension boundary eligibility
- candidate-pool diagnostics identify missing inventory vs boundary filtering
- candidate-pool diagnostics do not mutate raw candidates, zones, or output
- selected extension parity remains unchanged for current fixtures
- no bucket, nearest-level, special-level, strength, label, or enrichedAnalysis scoring changes occur
- no alert, monitoring, Discord, or trader-context behavior changes occur

## Migration Path

1. Add diagnostics-only `ExtensionCandidatePoolDiagnostics` helper.
2. Add focused tests proving extension output and default LevelEngine output are unchanged.
3. Generate multi-sample candidate-pool diagnostics artifacts.
4. Review whether missing extensions are caused by raw generation, clustering, boundary filtering, or genuinely absent inventory.
5. If real deeper scored zones exist but are not used, design an explicit behavior gate for expanded extension input.
6. If real deeper zones do not exist, review synthetic extension generation separately.
7. If clusters are merging away useful frontier levels, review clustering/noise tuning separately.

## Risks Of Changing Extension Input Inventory

Changing extension input inventory can:

- surface noisy frontier levels in choppy symbols
- make extension ladders less stable between refreshes
- reduce spacing quality if deeper candidates are too close or low-confidence
- change downstream alert/monitoring behavior if wired directly into live paths
- blur the difference between observed levels and synthetic planning levels

Those risks are why the next gate should remain diagnostic-only.

## Non-Goals

- No support/resistance detection changes.
- No LevelEngine default output changes.
- No runtimeMode default changes.
- No extension generation behavior changes.
- No level selection, bucket membership, nearest-level, extension-level, special-level, strength, label, or enrichedAnalysis scoring changes.
- No alert, monitoring, Discord, or trader-context changes.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language.

## Final Decision

Do not change extension generation yet.

The safest next implementation is an internal diagnostics-only candidate pool that exposes pipeline inventory across raw candidates, clustered zones, scored zones, surfaced levels, extension preselection, and selected extensions.

Only after that evidence exists should the system consider expanded extension input, clustering changes, or synthetic extension generation.
