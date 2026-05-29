# Synthetic Extension Generation Design

Status: design only

Date: 2026-05-29 America/Toronto

## Purpose

This document defines the safe implementation plan for synthetic extension levels before any code changes are made.

Synthetic extensions would exist only as forward-planning / continuation-map levels when real extension candidate inventory is missing or too shallow. They must not be treated as historical support/resistance, must not carry fake reaction evidence, and must not change surfaced support/resistance buckets, nearest levels, special levels, scoring, alerts, monitoring, Discord behavior, trader-context behavior, or runtime defaults without later explicit gates.

This gate does not implement synthetic extensions.

## Current Evidence Summary

Recent review gates produced the following evidence:

- Extension candidate pool expansion helped only when an unselected scored zone existed on the correct side of the reference price.
- `THIN` gained one resistance extension after expansion, but the upside coverage was still shallow at about 8.77%.
- `CHOP`, `CLNT`, `HIPO`, and `LPRN` still lacked extension coverage in generated post-expansion samples where no safe unselected scored zone existed.
- Candidate pool diagnostics showed raw candidates and scored zones can exist, and scoring preserves inventory.
- Extension eligibility can still drop to zero when the surfaced map owns the useful frontier.
- Cluster member tracking showed `CHOP` was the only high-compression sample.
- Exact raw member tracking was available for `CHOP`, but exact hidden extension-depth candidate count was 0.
- `CHOP` compression appears expected for choppy/range behavior rather than proof that clustering is hiding usable deeper extension levels.
- Clustering changes are not justified right now.

The remaining extension coverage gap is therefore not primarily a scoring, surfaced-bucket, nearest-level, special-level, or clustering-threshold problem. It appears when the engine has no safe real candidate inventory to extend the map far enough for forward planning.

## Current Extension Behavior

`buildLevelExtensions(...)` currently uses real `FinalLevelZone` candidates only.

Current selection behavior:

1. Build support and resistance candidate pools from scored zones.
2. Prefer strict frontier candidates:
   - support below the lowest surfaced support
   - resistance above the surfaced resistance boundary and inside practical forward range
3. If the strict frontier pool is empty, fall back to expanded unselected scored zones on the correct side of reference price.
4. Apply existing spacing, practical range, and continuity selection.
5. Mark selected real candidates with `isExtension: true`.

Important current constraints:

- No synthetic zones are generated.
- No extension candidate is created without an existing scored zone.
- Real candidates keep their original evidence, source types, strength, freshness, notes, and timestamps.
- `syntheticGenerationAvailable` is currently reported as `false` in extension diagnostics.

## Why Clustering Is Not Being Changed Now

Clustering should stay unchanged for now because exact member tracking did not prove useful deeper extension candidates are being hidden inside compressed clusters.

`CHOP` did show high compression and many-member clusters, but exact tracked members were dense inside local support/resistance ranges. The representative prices were not clearly hiding deeper support-side or resistance-side extension-depth members under the current material-depth rule.

Loosening clustering now would risk adding noisy, duplicate, low-separation levels in range-bound/choppy price action without evidence that it would fix the real extension coverage gap.

## Why Candidate Pool Expansion Only Partially Helped

Candidate pool expansion solved the case where the strict frontier pool is empty but an unselected scored zone still exists.

It cannot solve cases where:

- all real scored zones are already surfaced
- all useful real zones are inside the surfaced map
- real zones are too close to surfaced levels
- no real scored zone exists beyond the desired planning range
- available real zones exist but produce only shallow coverage
- the fixture or market structure genuinely lacks historical frontier levels

This is exactly the gap synthetic extensions would address: not by pretending new historical levels exist, but by adding explicitly labeled forward-planning map levels when real candidate inventory is absent or too shallow.

## Design Principle

Synthetic extensions should be separate, labeled continuation-map guideposts.

They should answer:

> If price moves beyond the real observed map and no deeper real candidate exists, what deterministic forward-planning prices should the system display as synthetic extension guideposts?

They should not answer:

- where historical support/resistance reacted
- where price previously rejected or bounced
- where volume proved a level
- whether a level is strong because of touches
- whether a trade is favorable

## When Synthetic Extensions Are Justified

Synthetic extensions should be allowed only when all of these are true:

- Extension coverage is missing or below a configured threshold.
- Real candidate extensions have already been preferred and selected first.
- No safe real candidate exists for the missing side, or the selected real candidate coverage is too shallow.
- A valid positive reference price exists.
- The requested synthetic side is on the correct side of the reference price.
- Generated prices stay outside the surfaced map.
- Generated prices do not duplicate surfaced levels, real extensions, special levels, or each other within spacing tolerance.
- The symbol/context supports forward planning, such as a low-price runner, fast mover, press-release runner, high relative-volume mover, or configured review mode.
- The synthetic level can be clearly labeled as synthetic in the output contract.

## When Synthetic Extensions Should Not Be Used

Synthetic extensions should not be generated when:

- real extension coverage is already adequate
- reference price is missing, zero, negative, or invalid
- generated prices would sit inside the surfaced support/resistance map
- generated prices would be too close to surfaced levels or selected real extensions
- generated prices would exceed practical forward range
- symbol context is too weak, stale, or sparse to justify forward planning
- choppy/range behavior is the only reason for missing coverage
- a formatter cannot clearly label synthetic levels as non-historical
- the implementation would require changing surfaced buckets, nearest levels, special levels, scoring, or alert behavior in the same gate

## Proposed Synthetic Extension Strategy

Use a layered strategy that always starts with real candidates.

1. Build real extensions exactly as the engine does today.
2. Measure side-specific coverage from reference price:
   - upside coverage for resistance extensions
   - downside coverage for support extensions
3. Determine whether synthetic fill is allowed for each side.
4. Generate synthetic candidates only for missing/limited sides.
5. Filter synthetic candidates against surfaced levels, real extensions, special levels, practical range, and spacing.
6. Append only enough synthetic extensions to reach target coverage or max synthetic count.
7. Preserve real candidate ordering and real candidate preference.
8. Label every synthetic extension distinctly.

Synthetic generation should be implemented as a separate helper first, for example:

```ts
type BuildSyntheticExtensionCandidatesParams = {
  symbol: string;
  side: "support" | "resistance";
  referencePrice: number;
  surfacedLevels: FinalLevelZone[];
  realExtensions: FinalLevelZone[];
  specialLevelPrices?: number[];
  config: SyntheticExtensionConfig;
};
```

Then it can be integrated into `buildLevelExtensions(...)` only in a later implementation gate with focused parity tests.

## Proposed Type And Metadata Changes

The current `FinalLevelZone.sourceTypes` type is `RawLevelCandidateSourceType[]`, which only allows real raw candidate source types:

- `swing_high`
- `swing_low`
- `premarket_high`
- `premarket_low`
- `opening_range_high`
- `opening_range_low`

Synthetic levels need type-safe labeling without pretending to be raw candidates.

### Option A: Extend sourceTypes

Add a synthetic source type:

```ts
export type SyntheticLevelSourceType = "synthetic_extension" | "continuation_map";

export type LevelSourceType = RawLevelCandidateSourceType | SyntheticLevelSourceType;
```

Then change `FinalLevelZone.sourceTypes` to `LevelSourceType[]`.

Benefits:

- Simple and visible in existing output.
- Formatters can identify synthetic levels without inspecting notes.

Risks:

- Broader type change may touch scorers, explainers, tests, and output consumers.
- Existing code may assume every source type came from raw candle evidence.

### Option B: Add explicit extension metadata

Keep `sourceTypes` historical, and add optional metadata:

```ts
export type ExtensionOrigin = "historical_candidate" | "synthetic_forward_map";

export type SyntheticExtensionGenerationMethod =
  | "percentage_ladder"
  | "round_number_ladder"
  | "price_band_ladder"
  | "prior_spacing_ladder";

export type ExtensionMetadata = {
  origin: ExtensionOrigin;
  generationMethod?: SyntheticExtensionGenerationMethod;
  referencePrice?: number;
  targetCoveragePct?: number;
  syntheticIndex?: number;
  evidenceLimitations?: string[];
};
```

Then add this optional field to `FinalLevelZone`:

```ts
extensionMetadata?: ExtensionMetadata;
```

Benefits:

- Cleanly separates historical source evidence from extension origin.
- Avoids pretending synthetic levels came from raw candidates.
- Allows real extensions to carry `origin: "historical_candidate"` later if needed.

Risks:

- Adds a new optional field to level objects.
- Consumers must learn the new metadata field.

### Recommended Type Path

Use Option B first: add optional `extensionMetadata` and keep `sourceTypes` as historical evidence.

For synthetic extensions:

- `isExtension: true`
- `extensionMetadata.origin: "synthetic_forward_map"`
- `extensionMetadata.generationMethod` set deterministically
- `sourceTypes: []` if allowed by tests, or a future explicit synthetic source type if empty source types are unsafe
- `notes` include neutral text such as `Synthetic forward-planning continuation map level; not historical support/resistance.`

If empty `sourceTypes` breaks assumptions, add a new source type in the same implementation gate with explicit tests proving downstream consumers handle it safely.

## Proposed Synthetic Level Shape

Synthetic extension zones should use the existing `FinalLevelZone` shape with conservative values and explicit metadata.

Example:

```ts
const syntheticResistance: FinalLevelZone = {
  id: `${symbol}-synthetic-resistance-extension-${index}`,
  symbol,
  kind: "resistance",
  timeframeBias: "mixed",
  zoneLow,
  zoneHigh,
  representativePrice,
  strengthScore: 0,
  strengthLabel: "weak",
  touchCount: 0,
  confluenceCount: 0,
  sourceTypes: [],
  timeframeSources: [],
  reactionQualityScore: 0,
  rejectionScore: 0,
  displacementScore: 0,
  sessionSignificanceScore: 0,
  followThroughScore: 0,
  sourceEvidenceCount: 0,
  firstTimestamp: 0,
  lastTimestamp: 0,
  isExtension: true,
  freshness: "fresh",
  notes: [
    "Synthetic forward-planning continuation map level; not historical support/resistance.",
  ],
  extensionMetadata: {
    origin: "synthetic_forward_map",
    generationMethod: "round_number_ladder",
    referencePrice,
    targetCoveragePct,
    syntheticIndex: index,
    evidenceLimitations: ["no_real_extension_candidate_available"],
  },
};
```

The exact timestamp handling needs implementation care. If `firstTimestamp` and `lastTimestamp` cannot be zero without confusing freshness logic, use the supplied engine `generatedAt` or reference candle timestamp, but label it as generation metadata only and do not imply historical reaction timing.

## Proposed Config

Add a small optional config surface, defaulting off at first if the implementation gate wants a diagnostic/shadow phase.

```ts
export type SyntheticExtensionConfig = {
  enabled: boolean;
  targetCoveragePct: number;
  maxCoveragePct: number;
  minCoveragePctBeforeFill: number;
  minSpacingPct: number;
  maxSyntheticExtensionsPerSide: number;
  priceBandRules: SyntheticExtensionPriceBandRule[];
  preferRoundNumbers: boolean;
  requireRunnerLikeContext: boolean;
};

export type SyntheticExtensionPriceBandRule = {
  minPrice: number;
  maxPrice: number;
  stepPct: number;
  roundTo: number;
  maxSyntheticExtensionsPerSide?: number;
};
```

Suggested starting defaults for design review:

```ts
const DEFAULT_SYNTHETIC_EXTENSION_CONFIG: SyntheticExtensionConfig = {
  enabled: false,
  targetCoveragePct: 0.35,
  maxCoveragePct: 0.5,
  minCoveragePctBeforeFill: 0.2,
  minSpacingPct: 0.03,
  maxSyntheticExtensionsPerSide: 2,
  preferRoundNumbers: true,
  requireRunnerLikeContext: true,
  priceBandRules: [
    { minPrice: 0, maxPrice: 1, stepPct: 0.1, roundTo: 0.01 },
    { minPrice: 1, maxPrice: 5, stepPct: 0.08, roundTo: 0.05 },
    { minPrice: 5, maxPrice: 20, stepPct: 0.06, roundTo: 0.1 },
    { minPrice: 20, maxPrice: Number.POSITIVE_INFINITY, stepPct: 0.05, roundTo: 0.5 },
  ],
};
```

Implementation can tune these numbers through tests. The important design constraint is deterministic, bounded, and sparse output.

## Deterministic Spacing Rules

Synthetic ladders should be deterministic and should not require `Date.now`, network calls, or external data.

### Resistance Ladder

For resistance:

1. Start from the farthest of:
   - reference price
   - highest surfaced resistance
   - highest real resistance extension
2. Generate candidate prices upward toward target coverage.
3. Prefer round-number-aware prices near the percent ladder step.
4. Stop at `referencePrice * (1 + maxCoveragePct)`.

### Support Ladder

For support:

1. Start from the nearest lower of:
   - reference price
   - lowest surfaced support
   - lowest real support extension
2. Generate candidate prices downward toward target coverage.
3. Prefer round-number-aware prices near the percent ladder step.
4. Stop before levels become absurd for low-price names, such as below zero or below a configured floor.

### Round-Number Awareness

Round-number snapping should be price-band-aware:

- sub-dollar names: pennies or nickel boundaries, depending on price
- 1 to 5 dollar names: nickel or ten-cent boundaries
- 5 to 20 dollar names: ten-cent, quarter, or half-dollar boundaries
- higher-priced names: half-dollar or whole-dollar boundaries

Snapping must not move a synthetic level inside the surfaced map or inside spacing tolerance. If snapping creates a duplicate or invalid level, keep the unsnapped deterministic price or skip the level.

## Coverage Rules

Synthetic generation should fill only the shortfall.

Definitions:

- `selectedCoveragePct`: farthest selected extension distance from reference price
- `targetCoveragePct`: desired planning coverage, initially around 30% to 35%
- `maxCoveragePct`: absolute cap, initially around 50%
- `minCoveragePctBeforeFill`: if real coverage is below this, synthetic fill is allowed

Examples:

- Missing resistance extension and runner-like context: generate up to target coverage.
- One real resistance extension at 8.77% and target is 35%: preserve the real extension and add at most two synthetic levels farther out.
- Real resistance coverage already above target: generate nothing.
- No support extension but reference price is low and downside ladder would produce near-zero levels: generate fewer or none.

## Context Gate

Synthetic extensions should not be unconditional in the first behavior gate.

The first implementation should require either:

- explicit config enabling synthetic extensions in a review/test path, or
- runner-like market context supplied by existing facts, such as low-price runner, fast move, press-release runner, high relative volume, or parabolic/extension context.

If market context is not available in `buildLevelExtensions(...)`, the first implementation should keep config explicit and avoid trying to infer context from incomplete inputs.

## Exact Implementation Sequence

Recommended implementation sequence:

1. Add type-only metadata support for synthetic extension identity.
2. Add a pure synthetic extension candidate builder that accepts already-known surfaced levels, real extensions, reference price, special level prices, and config.
3. Add tests for the synthetic builder without wiring it into `buildLevelExtensions(...)`.
4. Add an optional synthetic config to `BuildLevelExtensionsParams`, defaulting disabled.
5. When enabled, run current real extension selection first.
6. Measure coverage by side.
7. Generate synthetic fill only for missing/limited sides.
8. Append synthetic levels after real extension levels, preserving deterministic sort order.
9. Extend diagnostics to report synthetic generation availability, generated count, method, and skipped synthetic candidate reasons.
10. Keep all runtime/live callers on default disabled behavior unless a later explicit runtime gate enables it.

## Required Tests Before Implementation Merge

Behavior and safety tests:

- missing resistance extension gets a synthetic extension only when synthetic config is enabled
- missing support extension gets a synthetic extension only when synthetic config is enabled
- real extensions are always preferred over synthetic extensions
- real extension coverage above target generates no synthetic levels
- shallow real extension coverage may be filled without removing the real extension
- synthetic extensions do not duplicate surfaced levels
- synthetic extensions stay outside the surfaced map
- synthetic extensions do not duplicate special levels
- synthetic extensions are on the correct side of reference price
- synthetic extensions respect max coverage and max count
- synthetic extensions respect min spacing from surfaced and real extension levels
- low-price runner support remains practical and does not create absurd far-away levels
- higher-priced symbols avoid over-dense ladders

Output-contract tests:

- synthetic extensions are marked with `isExtension: true`
- synthetic extensions carry explicit synthetic/forward-map metadata
- synthetic notes say they are forward-planning / synthetic continuation map levels
- synthetic extensions do not carry fake touch history
- synthetic extensions do not carry fake rejection history
- synthetic extensions do not carry fake historical confluence
- synthetic `strengthScore`, `strengthLabel`, and evidence fields stay conservative
- real extension metadata remains historical-candidate based or unchanged

Regression tests:

- default `buildLevelExtensions(...)` output is unchanged when synthetic config is absent
- surfaced buckets are unchanged
- nearest support/resistance are unchanged
- special levels are unchanged
- `strengthScore` and `strengthLabel` for real levels are unchanged
- enrichedAnalysis scoring is unchanged
- runtimeMode old remains default
- alert, monitoring, Discord, and trader-context behavior are unchanged
- no trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language appears

## Risks

Synthetic extension generation carries real trust risks:

- Readers may confuse synthetic levels for historical support/resistance.
- Synthetic ladders can appear too precise if zone widths and notes are not careful.
- Over-dense ladders can clutter fast-moving charts.
- Low-price support ladders can produce absurd levels if downside rules are not bounded.
- Round-number snapping can create duplicates or levels too close to real zones.
- Runtime or Discord integration could accidentally present synthetic levels without enough labeling.
- Adding source type values may affect consumers that assume `sourceTypes` are raw candidate evidence.

These risks are manageable only if synthetic levels are explicit, sparse, deterministic, bounded, and disabled by default until a later integration gate.

## Non-Goals

This design does not propose:

- changing support/resistance detection
- changing clustering behavior
- changing raw candidate generation
- changing scoring
- changing surfaced bucket membership
- changing nearest support/resistance
- changing special levels
- changing real extension candidate selection
- changing alert behavior
- changing monitoring behavior
- changing Discord behavior
- changing trader-context behavior
- adding trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language

## Recommended Next Implementation Gate

Recommended next gate: `extension_synthetic_metadata_types`.

Reasoning:

Before generating any synthetic levels, the engine needs a type-safe way to label synthetic extensions so they cannot be confused with historical support/resistance. This should be the smallest implementation gate:

- add optional synthetic extension metadata types
- keep default behavior unchanged
- add tests proving existing real level output is unchanged
- add tests proving a synthetic-shaped fixture can be identified and formatted safely
- do not generate synthetic levels yet

After that, the next gate can implement a pure synthetic ladder builder behind disabled/default-off config.

## Decision

Synthetic extension generation is recommended for further implementation design and type preparation, but not as an immediate behavior change.

The safe path is:

1. Add explicit metadata support first.
2. Build synthetic candidates in a pure helper behind config.
3. Integrate only after default-off parity tests prove no existing output behavior changes.
4. Keep real candidates preferred over synthetic levels forever.

## Safety Confirmations

- No production behavior changed by this document.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- runtimeMode defaults unchanged.
- Extension generation behavior unchanged.
- Scoring unchanged.
- Selection unchanged.
- Surfaced buckets unchanged.
- Nearest levels unchanged.
- Special levels unchanged.
- Alert behavior unchanged.
- Monitoring behavior unchanged.
- Discord behavior unchanged.
- Trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
