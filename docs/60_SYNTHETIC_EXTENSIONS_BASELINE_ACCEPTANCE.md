# Synthetic Extensions Baseline Acceptance

Date: 2026-05-29

## Purpose

This document accepts synthetic continuation-map extensions as the baseline behavior for `extensionLevels`.

The acceptance is based on the post-synthetic review in `docs/59_SYNTHETIC_EXTENSION_GENERATION_REVIEW.md`. That review showed materially better forward extension coverage with no regressions to surfaced support/resistance buckets, nearest surfaced levels, special levels, real-level scoring, runtime defaults, alerts, monitoring, Discord behavior, or trader-context behavior.

## Evidence Summary

The deterministic multi-sample review covered:

- `LPRN`: low-price runner
- `CHOP`: choppy/messy ticker
- `THIN`: thin-liquidity ticker
- `CLNT`: clean technical mover
- `HIPO`: higher-priced stock

Post-synthetic results:

| Metric | Pre-synthetic / post-expansion | Post-synthetic |
| --- | ---: | ---: |
| Sample count | 5 | 5 |
| Surfaced levels | 48 | 48 |
| Extension levels | 1 | 13 |
| Real extension levels | 1 | 1 |
| Synthetic extension levels | 0 | 12 |
| Missing support-extension samples | 5 | 1 |
| Missing resistance-extension samples | 4 | 1 |
| Limited upside-coverage samples | 1 | 0 |
| Limited downside-coverage samples | 0 | 0 |

The review also confirmed:

- Surfaced counts unchanged: true
- Nearest support unchanged: true
- Nearest resistance unchanged: true
- Special levels unchanged: true
- Synthetic metadata marked: true

## Accepted Baseline Behavior

Synthetic continuation-map extensions are now accepted as normal `extensionLevels` fallback behavior.

The accepted behavior is narrow:

- Real historical/candidate extensions are preferred first.
- Synthetic extensions are considered only after real candidates are selected.
- Synthetic extensions fill missing or shallow forward extension coverage.
- Synthetic extensions are forward-planning continuation-map levels.
- Synthetic extensions are not historical support or resistance.
- Synthetic extensions do not create or change surfaced support/resistance buckets.
- Synthetic extensions do not change nearest surfaced support or resistance.
- Synthetic extensions do not change special levels.
- Synthetic extensions do not change `strengthScore`, `strengthLabel`, or `enrichedAnalysis` scoring for real levels.

## Required Synthetic Labeling

Synthetic extension levels must remain clearly marked.

Required metadata:

```ts
extensionMetadata.extensionSource = "synthetic_continuation_map"
```

Required evidence limits:

- No fake touch history.
- No fake rejection history.
- No fake volume confluence.
- No fake historical source evidence.
- Notes must identify the level as synthetic / continuation-map / forward-planning only.
- Notes must not imply the level is historical support/resistance.

The accepted synthetic levels are map levels for forward coverage, not claims that price previously respected that level.

## Real Extension Preference

Real candidate extensions remain the priority.

If real extension coverage is healthy, synthetic extensions should not be added. If real extension coverage exists but is shallow, the real extension should remain first and synthetic levels may fill after it.

The post-synthetic review confirmed this with `THIN`, where the real resistance extension at `1.6968` remained and synthetic fill was added only after that real level.

## Guardrails Locked By Tests

The current test coverage in `src/tests/level-synthetic-extension-generation.test.ts` already locks the acceptance guardrails:

- Missing resistance extension gets synthetic continuation-map extensions.
- Missing support extension gets synthetic continuation-map extensions.
- Shallow real resistance coverage gets synthetic fill after the real extension.
- Shallow real support coverage gets synthetic fill after the real extension.
- Real extensions are preferred and no synthetic is added when coverage is healthy.
- Synthetic extensions do not duplicate surfaced or real extension levels.
- Low-price support synthetic ladder stays within practical coverage.
- Ranked surfaced buckets, nearest levels, and special levels remain unchanged.
- Diagnostics include synthetic selected coverage while preserving real inventory signal.
- `runtimeMode` old remains default.

No additional tests were added in this acceptance gate because the required guardrails are already covered by focused tests and the full suite.

## Risks

The main risks are presentation and interpretation risks, not level-selection risks:

- Synthetic continuation-map levels could be mistaken for historical support/resistance if formatters omit the metadata/notes.
- Future Discord or live-preview output could overstate synthetic levels if it removes the forward-planning label.
- Low-price runners may need tighter tuning if synthetic spacing creates visually aggressive downside ladders in future real samples.
- Higher-priced stocks may need spacing tuning if preview output becomes too dense.

These risks should be handled through preview/review gates before live behavior changes.

## Future Tuning Candidates

Potential future gates, only if evidence supports them:

- Tune synthetic spacing for very low-priced stocks.
- Tune high-priced synthetic ladder density.
- Add richer preview wording for synthetic continuation-map levels.
- Compare real sample Discord previews with synthetic levels visible.
- Revisit stale/freshness, confluence enrichment, and thin-liquidity handling separately.

No immediate extension-generation tuning is recommended from the current review.

## Accepted Baseline Decision

Synthetic continuation-map extensions are accepted as the baseline `extensionLevels` fallback behavior.

The behavior should remain in place because it:

- Materially improves extension coverage.
- Keeps real extensions preferred.
- Clearly labels synthetic levels.
- Preserves surfaced buckets.
- Preserves nearest surfaced levels.
- Preserves special levels.
- Does not change real-level scoring.
- Does not change alert, monitoring, Discord, trader-context, or runtime behavior by itself.

## Next Recommended Gate

Next recommended gate: `add_live_preview_review`.

That gate should generate review/test output with synthetic levels visible and verify that preview language keeps synthetic continuation-map levels distinct from historical support/resistance before any live-facing behavior changes.

## Safety

- Support/resistance detection unchanged.
- LevelEngine default output changed only through the already-merged `extensionLevels` synthetic fallback behavior.
- `runtimeMode` defaults unchanged.
- Surfaced bucket membership unchanged.
- Nearest surfaced levels unchanged.
- Special levels unchanged.
- strengthScore and strengthLabel for real levels unchanged.
- enrichedAnalysis scoring unchanged.
- Alert behavior unchanged.
- Monitoring behavior unchanged.
- Discord behavior unchanged.
- Trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
