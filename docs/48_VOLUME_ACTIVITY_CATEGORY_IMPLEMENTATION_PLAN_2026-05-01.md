# Volume / Activity Category Implementation Plan

## Purpose

Add `volume_activity` as a quiet modular category that improves context without increasing Discord post count. Version 1 is internal/operator first. It can enrich an existing alert only when the read is reliable and the activity line helps the trader understand the same setup already being posted.

## Current Volume State

- Historical level scoring already uses candle volume ratios when scoring level evidence.
- Live monitoring receives `LivePriceUpdate.volume`.
- The IBKR live provider maps tick-size field `8` into `volume`.
- Discord posts previously did not have a clean, trader-facing activity story.
- The safe assumption for IBKR testing is that live volume can be useful only when it behaves like monotonic cumulative daily volume.

## Category Contract

`volume_activity` is part of the signal category matrix:

- `internalScoring = true` in structure-aware trader/operator profiles
- `operatorArtifacts = true` in structure-aware trader/operator profiles
- `liveDiscord = false` by default

Live Discord enrichment can be enabled only by an explicit profile/config override after tests pass. There are no standalone volume posts in v1.

For controlled testing, set:

```powershell
SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD=true
```

Leave this unset for the default live app posture.

## Volume Labels

- `strong`: current 5-minute activity is at least `2.0x` the recent 5-minute baseline
- `expanding`: current 5-minute activity is at least `1.4x` baseline and not fading
- `normal`: current activity is between `0.75x` and `1.4x` baseline
- `thin`: current activity is below `0.75x` baseline
- `fading`: recent activity is declining while price is still testing/extending
- `unknown`: data is not safe enough to interpret

## Reliability Rules

Discord-visible volume wording is omitted when:

- live volume is missing or zero
- cumulative live volume moves backward or resets
- volume repeats too long without advancing
- there are too few 5-minute baseline candles
- the relative-volume read is unavailable
- the label is `normal` and does not add meaning
- the line would repeat the same story without changing the setup interpretation

Unreliable and watch-state reads belong in operator artifacts only.

## Implementation Phases

### Phase 1: Contracts And Tracker

- Add typed volume labels, reliability labels, direction labels, and `VolumeActivityContext`.
- Add a per-symbol tracker that buckets cumulative live volume into 5-minute deltas.
- Bootstrap baseline from recent 5-minute candle volume when level data provides it.
- Mark non-monotonic, missing, repeated, or under-sampled volume as unsafe for trader-facing text.

### Phase 2: Quiet Alert Enrichment

- Thread `VolumeActivityContext` into monitoring events.
- Add optional alert metadata for label, reliability, ratio, direction, shown/suppressed state, and suppressed reason.
- Allow Discord text only when `volume_activity.liveDiscord` is enabled and reliability is `reliable`.
- Keep enrichment inside existing alerts only.

### Phase 3: Noise Gates

- Do not create volume-only alerts.
- Do not repeat `strong` or `expanding` lines while the same setup remains unchanged.
- Prefer omission during post bursts unless activity materially changes the interpretation.
- Keep unreliable volume context in audit/operator files.

### Phase 4: Audit Evidence

- Show reliable symbols.
- Show unreliable symbols.
- Show examples where volume enriched a posted alert.
- Show examples where volume was suppressed and why.
- Use these reports before allowing volume/activity wording broadly in live Discord.

## Trader-Facing Wording

Allowed:

- `activity is expanding into resistance, which makes the test more meaningful`
- `activity is still thin at support, so buyers need a better reaction`
- `activity picked up at support, which makes the reaction more meaningful`
- `activity is fading while support is under pressure, so buyers still need a reclaim`

Avoid:

- `volume confirms the breakout`
- `volume guarantees follow-through`
- `best entry`
- `buy`
- `sell`
- `can buy if`
- standalone volume-only alerts

## Rollout Rules

- Default to omission over bad certainty.
- Keep all v1 volume reads out of Discord unless explicitly enabled for testing.
- Live enrichment is controlled by `SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD=true`.
- Never use volume as direct execution advice.
- Never describe volume as confirmation or proof.
- Use activity only to qualify the same support/resistance story already being posted.
- If the same setup already showed the same activity label, suppress the next trader-facing activity line and keep the reason in audit metadata.

## Testing Checklist

- IBKR-style cumulative volume converts into 5-minute bucket deltas.
- Missing, repeated, and non-monotonic volume become unsafe.
- `strong`, `expanding`, `normal`, `thin`, and `fading` labels resolve correctly.
- Discord alert formatting includes activity only when reliable and live-gated.
- Trader-facing wording avoids direct advice and overconfident phrasing.
- Audit reports show reliable, unreliable, shown, and suppressed volume examples.

## Commands

```powershell
npx tsx --test src/tests/volume-activity.test.ts src/tests/signal-category-config.test.ts src/tests/alert-router.test.ts src/tests/discord-audit-reports.test.ts
npm run build
```

## Implementation Status

- Tracker, category config, alert metadata, Discord audit metadata, and trading-day evidence reporting are implemented.
- Live Discord enrichment remains disabled by default.
- Same-story volume/activity repeats are suppressed at event-context creation.
- The feature is ready for operator review after the next market session before enabling live trader text broadly.
