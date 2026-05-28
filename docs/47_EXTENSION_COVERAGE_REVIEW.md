# Extension Coverage Review

Date: 2026-05-28

## Purpose

This review follows `docs/46_LEVEL_QUALITY_FINDINGS_REVIEW.md`. The findings classifier identified extension coverage as the first evidence-backed review target:

- `CHOP` and `THIN` have missing resistance extension coverage.
- `CLNT` and `HIPO` have limited downside extension coverage.
- `LPRN` has healthy extension coverage in the audit sample.

This document reviews the current extension ladder logic before any engine change. It is review-only and does not change support/resistance detection, LevelEngine output, runtime defaults, alerts, monitoring, Discord behavior, trader-context behavior, level selection, bucket membership, nearest levels, extension levels, special levels, `strengthScore`, `strengthLabel`, or `enrichedAnalysis` scoring.

## Files Reviewed

- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-quality-audit-runner.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-validation-scenarios.test.ts`
- `src/tests/level-runtime-mode.test.ts`
- `docs/examples/level-quality-audit/*.json`
- `docs/examples/level-quality-audit/latest-level-quality-findings.txt`

## Current Extension Builder

Extensions are built in `buildLevelExtensions(...)` from already-created `FinalLevelZone` arrays:

- `supportZones`
- `resistanceZones`
- `surfacedSupport`
- `surfacedResistance`

The extension builder does not fetch candles, create raw candidates, cluster levels, score zones, or create support/resistance zones from scratch. It selects leftover zones beyond the surfaced map.

Default extension config is:

- `maxExtensionPerSide`: `3`
- `extensionSpacingPct`: `0.01`
- `extensionSearchWindowPct`: `0.05`
- `forwardPlanningRangePct`: `0.5`

In `rankLevelZones(...)`, extensions are called after surfaced buckets are selected:

```ts
buildLevelExtensions({
  supportZones,
  resistanceZones,
  surfacedSupport: [...dailySupport, ...intermediateSupport, ...intradaySupport],
  surfacedResistance: [...dailyResistance, ...intermediateResistance, ...intradayResistance],
  spacingPct: config.extensionSpacingPct,
  searchWindowPct: config.extensionSearchWindowPct,
  referencePrice: metadata.referencePrice,
});
```

### Support Extension Selection

Support extensions are selected from support candidates below the lowest surfaced support:

```ts
zone.representativePrice < lowestVisibleSupport
```

The support side uses the general spaced-extension loop. It does not apply a downside practical-range cap. Coverage depth depends on whether the supplied support zone inventory contains zones below the visible support map and whether those zones survive spacing/local dominance pruning.

### Resistance Extension Selection

Resistance extensions are selected from resistance candidates above the surfaced resistance boundary and at or below the practical forward-planning ceiling:

```ts
zone.representativePrice > highestVisibleResistance &&
zone.representativePrice <= referencePrice * 1.5
```

When `maxExtensionPerSide >= 3`, resistance uses continuity-aware selection:

1. Select a near/frontier candidate close to the surfaced resistance boundary if available.
2. Select a practical far candidate near the upper edge of available practical inventory.
3. Fill middle slots between the selected near and far candidates.

This is designed to preserve near, intermediate, and far resistance continuity while avoiding noisy near-duplicate ladder steps.

## Important Current Constraints

### Extensions Depend On Candidate Inventory

The extension engine can only select from `FinalLevelZone` objects that already exist in `supportZones` or `resistanceZones`. If earlier detection, clustering, scoring, or filtering does not produce deeper candidates, the extension ladder has nothing to add.

This means missing extensions can be caused by:

- no deeper candidate inventory
- all deeper candidates already surfaced
- candidates removed by spacing against surfaced zones
- candidates pruned as dominated forward candidates
- resistance candidates above the `referencePrice * 1.5` practical ceiling
- candidate quality being too weak to survive earlier scoring/selection stages

### No Synthetic Extension Generation Found

The current `level-extension-engine.ts` does not generate synthetic rounded levels or synthetic forward ladder steps. It only selects existing `FinalLevelZone` candidates and marks selected clones as `isExtension: true`.

Older planning docs mention synthetic extension concepts, but current code does not implement them. Adding synthetic extensions would be a new explicit behavior change and should not happen without a separate gate and focused tests.

### New Runtime Projection Reuses Legacy Extensions

The runtime projection adapter can reuse `legacyExtensionLevels` from the old runtime path. That parity behavior is separate from this review. This review concerns the existing extension ladder output supplied to the audit samples, not a replacement runtime path.

## Audit Sample Summary

| Sample | Reference | Support extensions | Resistance extensions | Lowest support extension | Highest resistance extension | Downside coverage | Upside coverage | Warnings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `CHOP` | `5.15` | `0` | `0` | n/a | n/a | n/a | n/a | `no_support_extension_coverage`, `no_resistance_extension_coverage` |
| `CLNT` | `24.4` | `1` | `1` | `20` | `29.5` | `18.0328%` | `20.9016%` | `limited_downside_extension_coverage` |
| `HIPO` | `186.5` | `1` | `1` | `158` | `226` | `15.2815%` | `21.1796%` | `limited_downside_extension_coverage` |
| `LPRN` | `0.84` | `1` | `2` | `0.56` | `1.36` | `33.3333%` | `61.9048%` | none |
| `THIN` | `1.74` | `1` | `0` | `1.3` | n/a | `25.2874%` | n/a | `no_resistance_extension_coverage` |

The audit warning threshold is `20%`, from `DEFAULT_EXTENSION_COVERAGE_WARNING_PCT` in `level-quality-audit-runner.ts`.

## Sample Findings

### `LPRN`: Healthy Low-Price Runner Coverage

The audit sample reports:

- 1 support extension
- 2 resistance extensions
- 33.3333% downside coverage
- 61.9048% upside coverage
- no extension warnings

This is why the findings classifier treats `LPRN` as healthy extension coverage.

Important caveat: the saved sample has `referencePrice = 0.84`, so the current engine's default 50% resistance ceiling would be `1.26`. The sample's highest resistance extension is `1.36`, which is above that ceiling. That means this sample is useful for audit behavior, but it should not be treated as proof that the current extension engine can generate this exact ladder under current config from live candles.

Before using `LPRN` as a regression baseline for engine behavior, create a generated fixture that runs the current engine or `buildLevelExtensions(...)` with explicit candidate inventory.

### `CHOP`: Missing Both Support And Resistance Extensions

The audit sample reports:

- surfaced support prices: `4.85`, `5.05`, `5.09`
- surfaced resistance prices: `5.45`, `5.12`, `5.18`
- support extensions: `0`
- resistance extensions: `0`
- clustered areas: `2`
- possible clutter levels: `4`

Likely explanation from the final output:

- The sample has only six total levels and no extension arrays.
- The final output does not prove whether deeper raw candidates existed.
- If the saved output was produced through the current extension builder, the most likely causes are insufficient leftover candidate inventory or nearby clustered/choppy candidates being consumed by surfaced buckets and spacing rules.

This may be expected behavior for a choppy/messy ticker if the data does not provide clean forward levels. It may also indicate the engine needs better diagnostics for when extensions are empty.

Engine change is not justified from this output alone.

### `THIN`: Missing Resistance Extension

The audit sample reports:

- surfaced support prices: `1.5`, `1.7`
- support extension: `1.3`
- surfaced resistance prices: `2.1`, `1.82`, `1.76`
- resistance extensions: `0`
- reference price: `1.74`
- practical resistance ceiling under current config: `2.61`

Likely explanation from the final output:

- Support extension coverage exists, so the extension path can add downside levels in this sample.
- Resistance extension coverage is absent, despite practical room above the highest surfaced resistance.
- Because the final output has no raw candidate inventory, the most likely cause is no additional resistance candidate above the surfaced resistance boundary and below the practical ceiling.

This may be expected for thin liquidity if the data has sparse overhead structure. It may also indicate a need for a "no candidate inventory" diagnostic before considering synthetic or fallback extensions.

Engine change is not justified yet.

### `CLNT`: Limited Downside Extension Coverage

The audit sample reports:

- reference price: `24.4`
- support extension: `20`
- downside coverage: `18.0328%`
- warning threshold: `20%`

This is not missing extension coverage. It is a threshold miss by about two percentage points.

Likely explanation:

- The engine found one deeper support extension.
- No farther support candidate was available or selected.
- Current support extension logic has no downside practical target. It walks candidate inventory below visible support, but it cannot add coverage if no deeper candidate exists.

This could be acceptable if `20` is the only meaningful deeper support. A test should verify whether a farther valid candidate exists in the source candidate set before changing the ladder.

### `HIPO`: Limited Downside Extension Coverage Plus Clustering

The audit sample reports:

- reference price: `186.5`
- support extension: `158`
- downside coverage: `15.2815%`
- one clustered area
- two possible clutter levels

Likely explanation:

- The engine found one deeper support extension.
- Downside coverage missed the audit threshold by roughly five percentage points.
- The output also has clustering/clutter evidence, so a wider support cluster near the visible map may be reducing clean deeper support inventory.

This should be reviewed with candidate-level diagnostics before tuning extension behavior. It may be an extension coverage problem, a clustering/noise problem, or simply expected behavior from the available levels.

## Is The Problem Config, Inventory, Filtering, Spacing, Or Expected Behavior?

Current evidence points mostly to candidate inventory and final-output-only observability.

### Candidate Inventory

Most likely for:

- `CHOP`
- `THIN`
- `CLNT`
- `HIPO`

The audit outputs show final ladders but not the candidate lists entering `buildLevelExtensions(...)`. Without those candidate lists, we cannot distinguish "the extension engine rejected valid candidates" from "no deeper valid candidates existed."

### Filtering

Possible for resistance only.

Resistance candidates above `referencePrice * 1.5` are filtered out. This protects practical forward planning but can also remove far overhead levels. The current samples do not prove this filter caused `CHOP` or `THIN` because their final outputs do not include the raw rejected candidate list.

### Spacing And Local Dominance

Possible for choppy/cluttered cases.

The extension engine removes candidates close to surfaced or selected levels using `extensionSpacingPct = 0.01`, and it can prune dominated forward candidates. This is desirable for avoiding noisy ladders, but it could leave no extension when all remaining candidates sit inside a crowded band.

`CHOP` is the most likely sample where spacing/clustering could explain missing extensions.

### Config

Possible, but not proven.

The audit threshold for coverage warnings is `20%`. `CLNT` misses downside coverage by about two percentage points. This could be a threshold calibration issue rather than a ladder issue. Changing the audit threshold would be easier than changing the engine, but it would not improve actual level coverage.

### Synthetic Extensions

Not currently implemented.

If future review decides the system needs fallback rounded levels for sparse or low-liquidity symbols, that should be designed as a separate explicit feature with strict facts-only labeling. It should not be slipped into this review.

### Expected Behavior

Possible for:

- `CHOP`, because choppy data may not deserve a deeper extension ladder.
- `THIN`, because thin liquidity may not have reliable overhead structure.
- `CLNT` and `HIPO`, if the only valid deeper support was already selected.

The current evidence does not prove the engine is wrong.

## Existing Test Coverage

Existing tests already cover:

- basic support/resistance extension creation beyond surfaced zones
- spacing-aware extension pruning
- preference for stronger nearby follow-through candidates
- skipping weak local leftovers when a stronger forward candidate exists
- preventing micro-structure from crowding out stronger forward resistance
- preserving practical forward resistance over far outliers
- preferring practical far frontier over absolute farthest resistance
- runtime parity preservation of the restored legacy extension ladder
- low-price runner projected extension reuse in runtime projection

These tests protect important existing behavior and should not be weakened.

## Gaps Before Any Engine Change

Before changing extension generation, add tests or diagnostics that expose:

1. Candidate inventory entering `buildLevelExtensions(...)`.
2. Candidate counts removed by surfaced-boundary filtering.
3. Candidate counts removed by practical resistance ceiling.
4. Candidate counts removed by surfaced spacing.
5. Candidate counts removed by selected-neighborhood spacing.
6. Candidate counts removed by dominated-forward pruning.
7. The selected near/frontier, far, and middle resistance candidates.
8. Whether support-side coverage is limited because no farther support exists or because a farther support was skipped.
9. Whether choppy clusters are expected to suppress extensions.
10. Whether thin-liquidity symbols should show no extension, one extension, or a clearly labeled fallback.

## Required Tests Before Changing Extension Logic

Any future extension change should add focused tests for:

- `CHOP`-like choppy output with clustered levels and no clean extension inventory.
- `THIN`-like sparse output with support extension present but resistance extension missing.
- `CLNT`-like clean technical output where downside support extension is just under the audit threshold.
- `HIPO`-like higher-priced output with downside coverage under threshold and nearby clustering.
- `LPRN`-like low-price runner output that must keep healthy extension coverage.
- Resistance candidates above `referencePrice * 1.5` are excluded unless a future explicit policy changes that.
- No synthetic extensions appear unless a future explicit synthetic-extension gate enables them.
- Extension additions do not alter surfaced buckets, nearest levels, special levels, `strengthScore`, `strengthLabel`, or `enrichedAnalysis`.
- Runtime parity tests still pass.
- Old/default LevelEngine output behavior remains unchanged unless a future gate intentionally changes it.

## Recommendation

Do not change extension generation yet.

The next implementation gate should be an extension coverage diagnostic gate, not an engine-tuning gate.

Recommended next gate:

`extension_coverage_diagnostics`

Scope:

- Add a pure diagnostic helper around `buildLevelExtensions(...)` or an audit-only wrapper that reports candidate inventory and rejection reasons.
- Run it against targeted fixture candidate sets for `CHOP`, `THIN`, `CLNT`, `HIPO`, and `LPRN`.
- Preserve current ladder output exactly.
- Use the diagnostics to decide whether the eventual tuning target is:
  - candidate inventory generation
  - surfaced-boundary filtering
  - resistance practical-range policy
  - spacing/local dominance pruning
  - audit threshold calibration
  - synthetic extension design
  - or no engine change.

Only after that diagnostic gate should we consider a narrow engine change.

## Safety Statement

This review changed no production code, no tests, no runtime behavior, and no extension generation behavior. Support/resistance detection, default LevelEngine output, runtimeMode defaults, alerts, monitoring, Discord behavior, trader-context behavior, bucket membership, nearest levels, extension levels, special levels, strength fields, and enrichedAnalysis scoring remain unchanged.
