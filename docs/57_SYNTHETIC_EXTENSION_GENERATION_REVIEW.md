# Synthetic Extension Generation Review

Status: complete

Date: 2026-05-29 America/Toronto

## Purpose

This review decides whether synthetic extension generation should be considered for forward-planning coverage when real support/resistance candidate inventory is missing or too shallow.

This is review/design only. It does not implement synthetic extensions, change support/resistance detection, change LevelEngine default output, change runtime defaults, change extension generation behavior, change scoring, change selection, change surfaced buckets, change nearest levels, change special levels, change alerts, change monitoring, change Discord behavior, or change trader-context behavior.

## Current Evidence Summary

Recent extension and clustering review gates show:

- The current extension engine is candidate-driven. It selects from real scored `FinalLevelZone` inventory.
- Extension candidate pool expansion helped only when unselected scored zones existed.
- `THIN` gained one resistance extension after candidate pool expansion, proving the fallback works for real unselected inventory.
- Remaining weak cases occur when there is no safe real candidate inventory beyond the surfaced map, or when the only real candidate is too shallow for target coverage.
- Candidate pool diagnostics showed scoring preserves inventory; scoring is not the narrowing stage.
- Cluster member tracking showed `CHOP` compression is real, but exact raw member tracking did not reveal hidden extension-depth candidates inside CHOP clusters.
- Clustering should not be changed right now.
- The current engine has no synthetic generation path. Extension diagnostics explicitly report synthetic generation as unavailable.

The remaining gap is not a proven scoring, clustering, spacing, or range bug. It is a forward-planning coverage gap when observed historical candidate inventory is absent or insufficient.

## Why Candidate Pool Expansion Only Partially Helped

Candidate pool expansion was intentionally conservative:

- It keeps strict frontier extension selection first.
- It falls back to unselected scored zones only when strict frontier candidates are empty.
- It still requires real `FinalLevelZone` inventory.
- It does not generate new zones.

That means it can improve coverage only when real scored zones exist but were not selected by the strict frontier pool.

It cannot help when:

- every useful scored zone is already surfaced
- no scored zone exists beyond the surfaced frontier
- the only eligible real extension candidate is shallow
- a runner has moved beyond nearby historical structure
- the sampled window lacks deeper or higher historical candidates

This is why candidate pool expansion should remain accepted as the real-candidate baseline, but it is not a complete forward-planning solution.

## Why Clustering Should Not Change Now

The clustering evidence is now specific enough to avoid a premature behavior change:

- `CHOP` was the only sample with high compression and hidden-depth possible warnings.
- Exact cluster member tracking was available for all generated sample clusters.
- CHOP support and resistance clusters had many members, but no exact hidden extension-depth candidate ids.
- CHOP resistance representative was already the highest tracked raw member in its cluster.
- The compression looks consistent with choppy/range behavior.

Loosening clustering now would risk noisy duplicate levels without evidence that useful extension-depth candidates are being hidden.

## Should Synthetic Extensions Be Considered?

Yes, but only as a separate, explicitly labeled forward-planning feature.

Synthetic extensions should be considered because the system is expected to help with forward planning for low-price stocks, penny-stock runners, press-release runners, and fast-moving names that can move through nearby real resistance quickly.

However, synthetic extensions must not be treated as historical support/resistance. They should be a separate continuation-map layer that fills planning gaps only when real candidate inventory cannot provide enough forward coverage.

Recommended next gate: `synthetic_extension_generation_design`.

## When Synthetic Extensions Are Justified

Synthetic extensions may be justified only when all or most of these conditions are true:

- real extension candidate inventory is missing on the needed side
- real extension candidate inventory exists but selected coverage is below a configured threshold
- the context supports a forward-planning need, such as low-price runner, fast-move profile, strong range expansion, or explicit runner context
- reference price is available and valid
- generated prices can stay inside a practical forward-planning range
- generated prices do not duplicate or crowd real surfaced levels or real extension levels
- generated levels can be clearly labeled as synthetic planning levels

The prior target idea of roughly 30% to 50% forward coverage can be used as a design target, not as a hard promise. It should be context-sensitive and bounded.

## When Synthetic Extensions Should Not Be Used

Synthetic extensions should not be used when:

- real candidate extension coverage is already adequate
- the symbol is choppy, weak-context, or low-quality without a fast-move reason
- reference price is missing, stale, or invalid
- generated prices would sit too close to real levels
- generated prices would exceed the practical forward-planning range
- generated prices would be mistaken for historical levels
- market context is insufficient to justify forward-map coverage
- output consumers cannot display synthetic labels clearly

For choppy/range profiles, the default should remain conservative. A choppy profile alone is not a reason to create synthetic continuation levels.

## What Synthetic Extensions Should Represent

Synthetic extensions should represent:

- forward-planning map levels
- continuation-map guideposts
- price areas for orientation beyond the observed real level map

Synthetic extensions should not represent:

- historical support
- historical resistance
- observed rejection zones
- observed reaction zones
- touch-confirmed levels
- scored structural levels

They should never pretend to have historical touches, rejection counts, reaction quality, follow-through evidence, or source candle evidence.

## Proposed Synthetic Extension Metadata

The next design gate should define metadata before behavior.

Possible shape:

```ts
type ExtensionOrigin = "historical_candidate" | "synthetic_forward_map";

type SyntheticExtensionMetadata = {
  isSynthetic: true;
  extensionOrigin: "synthetic_forward_map";
  generationMethod:
    | "percentage_ladder"
    | "round_number_ladder"
    | "prior_spacing_ladder"
    | "range_based_ladder";
  referencePrice: number;
  coverageTargetPct: number;
  generatedAt: number;
  evidenceLimitations: string[];
  label: "synthetic_forward_map";
};
```

If this metadata is added later, it should be explicit and separate from real level evidence.

## Proposed Generation Methods

### Percentage-Based Ladder

Generate levels at fixed percentage offsets from reference price.

Possible use:

- low-price runners
- fast movers with no overhead real candidate inventory
- first-pass simple fallback

Risks:

- can feel arbitrary without round-number alignment
- may create too many mechanical levels

### ATR Or Range-Based Ladder

Use realized volatility, ATR-like range, or recent candle range if facts exist.

Possible use:

- symbols with high intraday range expansion
- runners where a static percentage ladder is too coarse or too tight

Risks:

- requires reliable volatility facts
- should not be introduced until the fact inputs are stable and tested

### Prior Extension Spacing

If real extensions exist on one side or near the current map, reuse spacing patterns.

Possible use:

- adding one farther continuation level after a real extension
- preserving continuity with observed level spacing

Risks:

- limited when no real extension exists at all
- could inherit noisy spacing from poor candidate inventory

### Round-Number-Aware Ladder

Snap or bias synthetic prices toward meaningful round numbers.

Possible use:

- low-price stocks where whole, half, quarter, ten-cent, or five-cent areas matter
- forward map readability

Risks:

- round numbers are not automatically support/resistance
- must be labeled as round-number confluence or synthetic map only

### Low-Price-Specific Spacing

Use price-band-specific increments for sub-$1, $1-$5, $5-$10, and higher-priced names.

Possible use:

- penny-stock runners
- low-price press-release movers

Risks:

- needs careful tests to avoid dense clutter
- should be capped by max synthetic count and practical range

## Safety Rules

Any future synthetic extension implementation should obey these rules:

- Real candidate extensions are always preferred over synthetic extensions.
- Synthetic extensions are generated only when real extension coverage is missing or too shallow.
- Synthetic extensions are marked as synthetic in type/metadata.
- Synthetic extensions do not affect surfaced support/resistance buckets.
- Synthetic extensions do not affect nearest surfaced levels.
- Synthetic extensions do not affect special levels.
- Synthetic extensions do not affect real `strengthScore` or `strengthLabel`.
- Synthetic extensions do not claim touches, rejections, reactions, or confluence evidence.
- Synthetic extensions do not overwrite real extension candidates.
- Synthetic extensions stay in `extensionLevels` or a separate optional synthetic extension field, never mixed invisibly into real level buckets.
- Output formatting must label synthetic levels as forward-map/continuation-map levels.
- Runtime, alerts, monitoring, Discord, and trader-context integration remain separate future gates.

## Proposed Tests Before Implementation

Before behavior changes, add tests proving:

- old/default LevelEngine output remains unchanged when synthetic generation is disabled
- runtimeMode old remains default
- real candidate extensions are preferred over synthetic extensions
- synthetic generation activates only when configured and when real coverage is missing or too shallow
- synthetic levels are marked as synthetic
- synthetic levels do not change surfaced buckets
- synthetic levels do not change nearest levels
- synthetic levels do not change special levels
- synthetic levels do not change `strengthScore`, `strengthLabel`, or enrichedAnalysis scoring for real levels
- synthetic levels have no touch/rejection/reaction evidence
- synthetic levels remain on the correct side of reference price
- synthetic levels respect spacing and practical forward range
- low-price runner coverage can reach the target band without excessive clutter
- choppy/range context does not generate synthetic continuation levels by default
- input objects are not mutated
- output is deterministic
- no alert, monitoring, Discord, or trader-context behavior changes occur

## Risks

Synthetic extensions introduce real risk:

- They can reduce trust if users confuse them with historical support/resistance.
- They can add clutter.
- They can create false precision.
- They can over-map choppy symbols.
- They can make downstream messages look more confident than the evidence supports.
- They can accidentally become behavior-affecting if routed into alerts too soon.

These risks are manageable only if synthetic levels are clearly labeled, optional, and separated from real level scoring and bucket selection.

## Recommended Next Implementation Gate

Recommended next gate: `synthetic_extension_generation_design`.

That gate should remain design or type-only unless explicitly expanded. It should decide:

- exact metadata shape
- whether synthetic levels live inside `extensionLevels` with metadata or in a separate field
- activation conditions
- coverage thresholds
- context gates for low-price/runner/fast-move profiles
- spacing and round-number rules
- formatting labels
- tests required before behavior changes

Do not implement synthetic generation until that design is complete.

## Decision

Synthetic extension generation is recommended for further design, not immediate implementation.

The current evidence supports a narrow optional synthetic forward-map feature for cases where real candidate inventory is absent or too shallow and forward-planning coverage is needed. The feature must remain separate from historical support/resistance, must be clearly labeled, and must not change live behavior until a later explicit implementation gate.

## Safety Confirmations

- Documentation-only review.
- No production behavior changed.
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
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language was added.
