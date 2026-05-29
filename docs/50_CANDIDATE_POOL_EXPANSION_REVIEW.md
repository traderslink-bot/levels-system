# Candidate Pool Expansion Review

Date: 2026-05-29

## Purpose

This review inspects how level candidates move from raw candle structure into surfaced support/resistance buckets and extension candidates. The goal is to decide whether extension coverage issues should be addressed by preserving deeper candidate inventory, expanding internal diagnostics, adding synthetic extensions, or making no engine change yet.

This is documentation/review only. It does not change support/resistance detection, LevelEngine default output, runtimeMode defaults, extension generation behavior, level selection, bucket membership, nearest levels, extension levels, special levels, strength fields, enrichedAnalysis scoring, alerts, monitoring, Discord behavior, or trader-context behavior.

## Current Evidence

The enhanced extension diagnostics review found:

- `CHOP`: missing support and resistance extensions because no visible extension-eligible candidates existed beyond surfaced levels.
- `THIN`: missing resistance extension because no visible resistance extension candidate existed beyond surfaced resistance.
- `CLNT`: downside extension exists, but the only visible downside candidate gives 18.0328% coverage.
- `HIPO`: downside extension exists, but the only visible downside candidate gives 15.2815% coverage.
- `LPRN`: extension coverage is healthy when visible extension inventory exists.
- Recurring rejection reasons were surfaced-level related, not spacing/range related.

That points away from immediate spacing/range tuning and toward candidate inventory review.

## Current Candidate Pipeline

### 1. Candle Series Loading

`LevelEngine.generateLevels(...)` loads daily, 4h, and 5m candle series through `CandleFetchService`.

Daily and 4h are required. 5m is optional and can fall back to an empty degraded intraday series.

### 2. Swing Detection

For each available timeframe, `detectSwingPoints(...)` finds swing highs and lows using timeframe-specific config:

- `swingWindow`
- `minimumDisplacementPct`
- `minimumSwingSeparationBars`

This is the first place deeper extension inventory can be lost. If deeper highs/lows do not qualify as swings, no later extension stage can use them.

### 3. Raw Candidate Creation

`buildRawLevelCandidates(...)` converts swing points into `RawLevelCandidate` objects.

Each raw candidate carries:

- symbol
- timeframe
- support/resistance kind
- price
- source type
- touch/reaction/displacement/rejection/follow-through evidence
- first/last timestamp
- notes

`buildSpecialLevelCandidates(...)` adds session-derived candidates, such as premarket and opening range levels, into the same raw candidate list.

### 4. Clustering Into FinalLevelZone Inventory

`clusterRawLevelCandidates(...)` splits raw candidates by support/resistance side and clusters them into `FinalLevelZone` objects.

The clusterer performs:

- first-pass grouping by price proximity
- representative candidate selection
- second-pass merging when zones are close or overlapping
- max merged width protection
- final zone id normalization

This stage can reduce multiple deeper raw candidates into one zone. That may be correct, but it means extension selection no longer sees every original swing or raw level.

### 5. Scoring

`scoreLevelZones(...)` scores every clustered zone. It adds:

- `strengthScore`
- `strengthLabel`
- path-clearance notes
- crowding/recycled intraday penalties
- evidence/freshness metadata in notes

The scorer does not appear to filter zones out. It changes the score/label but keeps the scored zone inventory intact.

### 6. Surfaced Bucket Selection

`rankLevelZones(...)` creates the surfaced output buckets:

- major support/resistance
- intermediate support/resistance
- intraday support/resistance

Before selecting buckets:

- support is filtered to zones below `metadata.referencePrice`
- resistance is filtered to zones above `metadata.referencePrice` and within the surfaced forward planning range
- each side is split by preferred bucket ownership
- `selectSpacedZones(...)` picks the best zones per bucket and suppresses nearby weaker/dominated zones

This is where visible output can consume or hide deeper inventory. A zone may exist in the scored inventory but not surface if it belongs to a bucket that already reached max output or if it is too close to a stronger surfaced zone.

### 7. Extension Candidate Selection

`rankLevelZones(...)` passes the full scored `supportZones` and `resistanceZones` into `buildLevelExtensions(...)`, along with the surfaced bucket selections.

The extension engine then derives candidates:

- support candidates: scored support zones below the lowest surfaced support
- resistance candidates: scored resistance zones above the surfaced resistance boundary and within the practical forward planning range

Then it:

- prunes dominated forward candidates
- avoids candidates too close to surfaced levels
- selects support and resistance extensions using spacing and search-window rules
- marks selected levels as `isExtension: true`

Important: extension candidate selection currently uses the scored zone inventory, not raw candidates. If raw or clustered inventory is sparse, extension selection has nothing deeper to choose from.

## Where Extension Candidate Inventory Comes From

Extension candidates come from scored `FinalLevelZone[]` arrays:

- `supportZones`
- `resistanceZones`

These arrays are already downstream of:

- swing detection thresholds
- raw candidate construction
- special level insertion
- first-pass clustering
- second-pass merging
- zone scoring

They are not raw candle pivots, raw swing candidates, or a separate preserved frontier inventory.

## Where Deeper Levels May Be Lost

### Raw Candidate Generation

If deeper support or overhead resistance does not qualify as a swing, it never becomes a raw candidate.

This is plausible for:

- choppy samples where structure is noisy
- thin-liquidity samples where candles may not form clean swings
- higher-priced samples where meaningful farther levels may be older or outside the sampled window

### Clustering

The clusterer can merge nearby raw candidates into one `FinalLevelZone`. This is usually desirable for clean support/resistance zones, but it may collapse multiple frontier candidates into a surfaced zone and leave no separate extension candidate.

This is especially relevant when the final diagnostics show only surfaced candidates and no extension-eligible candidates beyond them.

### Scoring

The scorer does not remove zones, so it is not the most likely place where inventory is lost. However, scoring affects surfaced selection and extension usefulness ordering.

Scoring could still indirectly matter if weaker deeper zones are always outranked or dominated later.

### Surfaced Bucket Selection

Surfaced selection can hide candidate inventory from the public output, but it does not remove those zones before extension selection because `buildLevelExtensions(...)` still receives the full scored arrays.

That means missing extension inventory in enhanced diagnostics is probably not caused only by public bucket caps. It is more likely caused by the scored zone arrays themselves lacking deeper/frontier zones, or by the extension boundary filters finding no zones beyond surfaced levels.

### Extension Boundary Filters

The extension engine filters:

- support below the lowest visible support
- resistance above the surfaced resistance boundary
- resistance within the practical forward range

The enhanced review did not find recurring `outside_practical_range` reasons. The issue was not primarily a rejected candidate pool; it was that no candidate beyond the surfaced boundary was visible for the missing sides.

## Is Candidate Pool Expansion Safer Than Synthetic Generation?

Yes, as the next investigation gate.

Candidate pool expansion is safer because it tries to preserve or expose real market-derived candidates before inventing synthetic levels. Synthetic extension generation may become useful later, but it carries higher risk because it can create levels that did not come from observed candle structure.

The current evidence says:

- current extension behavior can work when candidate inventory exists (`LPRN`)
- missing cases lack visible candidate inventory (`CHOP`, `THIN`)
- limited downside cases have only one shallow eligible candidate (`CLNT`, `HIPO`)
- spacing/range rejection is not recurring

That supports reviewing real candidate inventory before adding synthetic levels.

## Option A: Preserve Deeper Scored Zones As Extension Candidates

Description:

Keep more scored zones available specifically for extension planning, even if they are not suitable for surfaced buckets.

Possible shape:

- preserve a deeper scored-zone list before surfaced bucket suppression
- mark it internal-only
- pass it to extension diagnostics first
- later decide whether to use it in extension selection

Benefits:

- stays based on real candle-derived levels
- may improve extension coverage without synthetic levels
- fits the existing candidate-driven design
- easier to test against current extension output because it can be diagnostic-only first

Risks:

- could reintroduce noisy/choppy levels if used too early
- may increase clutter if later exposed without strict filters
- may require careful ownership boundaries so internal candidates do not alter public output

## Option B: Add An Internal extensionCandidatePool

Description:

Add an internal diagnostic output or helper result that exposes candidate pools without changing `LevelEngineOutput`.

Possible shape:

- `ExtensionCandidatePool`
- support/resistance arrays of scored candidate zones
- raw counts by source stage
- rejection or suppression reasons
- diagnostics only, not public output

Benefits:

- safest next implementation step
- directly answers whether deeper candidates existed before extension selection
- avoids changing default output shape
- avoids changing extension behavior

Risks:

- requires plumbing through internal helpers or a review runner
- if added carelessly, it could be confused with public level output
- tests must prove old/default output serialization remains unchanged

## Option C: Add Synthetic Extension Generation

Description:

Generate extension zones when real candidate inventory is missing or too shallow.

Benefits:

- can fill empty overhead or downside planning gaps
- can help symbols with sparse real historical structure
- may be useful for thin or choppy symbols when output clearly lacks coverage

Risks:

- highest chance of creating levels that are not market-derived
- could reduce trust in support/resistance output
- needs very strict labeling and probably separate synthetic confidence
- should not happen before real candidate inventory is fully understood

## Option D: Do Nothing Yet

Description:

Leave extension behavior as-is and continue gathering evidence.

Benefits:

- zero behavior risk
- preserves the current known-good `LPRN` behavior

Risks:

- leaves recurring missing/limited extension coverage unexplained
- does not improve diagnostic confidence enough for a later engine change
- may slow support/resistance quality improvement

## Tests Needed Before Any Behavior Change

Before changing extension behavior, add tests that prove:

- old/default LevelEngine output remains unchanged unless an explicit later gate changes it
- runtimeMode `old` remains default
- existing `LPRN` healthy extension behavior is preserved
- `CHOP` and `THIN` missing-extension cases are diagnosed with real pre-extension candidate counts
- `CLNT` and `HIPO` limited downside cases show whether deeper candidates existed upstream
- candidate-pool diagnostics do not change selected extensions
- candidate-pool diagnostics do not alter surfaced buckets, nearest levels, special levels, strength fields, or enrichedAnalysis scoring
- no alert, monitoring, Discord, or trader-context behavior changes
- internal-only candidate pools are not serialized into public `LevelEngineOutput`

## Recommended Next Gate

Recommended next gate: `internal_extension_candidate_pool_diagnostics`.

Scope:

- Add a pure/internal diagnostic helper or review runner that exposes raw candidate counts, clustered zone counts, scored zone counts, surfaced bucket counts, extension candidate counts, and selected extension counts.
- Keep it optional and review-only.
- Do not change `LevelEngineOutput`.
- Do not change extension selection.
- Use generated fixtures or existing sample fixtures to compare `CHOP`, `THIN`, `CLNT`, `HIPO`, and `LPRN`.

This should come before:

- `synthetic_extension_generation_review`
- `extension_spacing_range_tuning`
- `cluster_cleanup_review`
- any live/runtime integration

## Conclusion

The current evidence supports candidate-pool diagnostics and possible future candidate-pool expansion, not synthetic extension generation yet.

The extension engine is receiving scored zones and selecting from real candidates. The missing/limited samples appear to lack enough visible frontier candidates by the time extension selection runs. The next safest step is to expose the internal inventory across the pipeline so we can tell whether deeper candidates are never generated, merged away, deprioritized, or only absent from final output fixtures.

## Safety

- Documentation-only review.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- runtimeMode defaults unchanged.
- Extension generation behavior unchanged.
- Level selection, buckets, nearest levels, extensions, special levels, strength fields, and enrichedAnalysis scoring unchanged.
- Alert, monitoring, Discord, and trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
