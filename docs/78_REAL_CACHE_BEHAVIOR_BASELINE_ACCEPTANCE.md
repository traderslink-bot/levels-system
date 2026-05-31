# Real Cache Behavior Baseline Acceptance

## Scope

This document accepts the current real-cache extension behavior as the baseline for the `LevelAnalysisSnapshot` v1 candidate. It is documentation-only. No support/resistance detection, LevelEngine output behavior, runtime mode defaults, alert behavior, monitoring behavior, Discord behavior, trader-context behavior, scoring, selection, journal grading, coaching, P/L, giveback, behavior scoring, or recommendation language was changed.

## Evidence Summary

The real cached ticker replay validation confirmed that `LevelAnalysisSnapshot` works against actual cached IBKR candle data. The cache review found offline candle data under `.validation-cache/candles`, with `2265` cache JSON files, `356` provider/symbol groups, and `354` groups containing `5m`, `4h`, and daily candles. The selected validation set was:

- `DEVS` as a low-price runner
- `ENVX` as a clean technical mover
- `AIM` as a choppy ticker
- `PBM` as a thin-liquidity ticker
- `DXYZ` as a higher-priced ticker

All five generated snapshots included `LevelEngineOutput`, session facts, volume facts, volume shelves, market context, `LevelIntelligenceReport`, `LevelQualityAudit`, schema fields, and no-lookahead safety flags.

The real-cache extension coverage review then inspected why `DEVS`, `AIM`, and `PBM` had no resistance extension rows and no synthetic continuation-map rows. It found this was not a stale fixture issue and not a snapshot-from-candles path bug. The synthetic fallback was active, but the current safety rules blocked synthetic resistance rows because the roughly `30%` target landed inside the surfaced resistance map and the roughly `50%` target rounded beyond the practical max range.

The real-cache synthetic extension regression tests lock that behavior with focused deterministic cases in `src/tests/level-real-cache-synthetic-extension-cases.test.ts`.

## Accepted Behavior

The accepted baseline is:

- Real historical/candidate extensions are always preferred over synthetic continuation-map extensions.
- Synthetic continuation-map fallback remains active for missing or shallow extension coverage when it is safe.
- Synthetic extensions are not generated inside the surfaced support/resistance map.
- Synthetic extensions are not generated beyond the practical max range after round-number adjustment.
- Healthy real extension coverage, such as the `DXYZ`-style case, remains historical and is not mislabeled as synthetic.
- Shallow real extension coverage, such as the `ENVX`-style downside case, can fill extension slots with real candidates before synthetic fallback is considered.
- `DEVS`/`AIM`/`PBM`-style no-resistance-extension rows are expected under current rules when synthetic targets are either inside surfaced resistance or beyond practical max.

This baseline accepts that a snapshot can have no resistance `extensionLevels` rows while surfaced resistance levels already provide forward resistance coverage above the reference price. That is a quality-audit interpretation nuance, not evidence that synthetic generation failed.

## Guardrails Covered By Tests

The focused regression tests now cover:

- A real-cache-style missing-resistance case where the `30%` target is inside surfaced resistance and the `50%` target rounds beyond practical max.
- A surfaced-map exclusion case where synthetic resistance is blocked because it would duplicate or sit inside surfaced resistance.
- A low-price rounding case where synthetic resistance is blocked after rounding pushes the target beyond practical max.
- A healthy real-extension case where the extension remains historical/real.
- A shallow downside case where real support extensions fill available slots before synthetic fallback.
- A normal missing-extension case where synthetic fallback still works when safe.
- Guardrails proving blocked synthetic fallback leaves surfaced buckets, nearest levels, and special levels unchanged.

## What Remains Open

Open follow-up areas:

- Validate more real cached symbols before promoting the snapshot contract from v1 candidate to locked v1.
- Decide whether `LevelQualityAudit` should distinguish missing `extensionLevels` rows from forward coverage already present in surfaced support/resistance buckets.
- Evaluate whether synthetic spacing should add an in-range fallback between surfaced frontier and practical max when current `30%`/`50%` targets are blocked.
- Evaluate whether low-price round-number handling should avoid rounding just beyond max practical coverage.
- Continue hardening multi-timeframe behavior with additional real cached replay cases.

## Recommended Next Gate

Recommended next gate: `journal_connector_contract_doc`.

Rationale: the snapshot builder, replay safety tests, fixture pack, real-cache validation, extension coverage review, and real-cache synthetic guardrails now make `LevelAnalysisSnapshot` a credible v1 candidate for downstream consumption. The next most useful step for TraderLink Intelligence / journal readiness is to define exactly how the journal connector should consume the snapshot fields, which fields are stable, which fields remain optional or experimental, and what compatibility rules downstream systems should rely on.

After the connector contract is documented, the project can proceed toward `snapshot_schema_v1_lock` with clearer downstream expectations.
