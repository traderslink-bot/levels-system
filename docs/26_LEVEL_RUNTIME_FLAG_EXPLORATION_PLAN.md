# Level Runtime Flag Exploration Plan

## Purpose

This phase adds a safe runtime exploration boundary for the new surfaced adapter without changing the live default behavior.

The goal is controlled experimentation, not silent migration.

## Why this stage is justified

The repo now has:

- the old live surfaced runtime path
- the new structural ranking layer
- the new surfaced selection adapter
- surfaced validation showdown evidence
- surfaced shadow batch evidence
- a targeted calibration pass that materially improved the new adapter in:
  - first-interaction alignment
  - near-price actionable usefulness
  - anchor usefulness

The remaining unresolved weakness is still the broken-level edge case.

That means the next safe step is a non-default runtime flag, not a default switch.

## Runtime modes

Environment variables:

- `LEVEL_RUNTIME_MODE`
  - `old`
  - `new`
  - `compare`
- `LEVEL_RUNTIME_COMPARE_ACTIVE_PATH`
  - `old`
  - `new`
  - only used when `LEVEL_RUNTIME_MODE=compare`
  - defaults to `old`

Behavior:

- `old`
  - current live runtime path only
  - default
- `new`
  - new structural ranking plus surfaced selection adapter
  - projected through a runtime compatibility adapter into the existing bucketed `LevelEngineOutput`
- `compare`
  - one path remains active for runtime behavior
  - the other path is observational only
  - a compact side-by-side comparison payload is logged

Invalid values safely fall back to `old`.

## Compatibility adapter

The runtime still expects the legacy `LevelEngineOutput` contract:

- `majorSupport`
- `majorResistance`
- `intermediateSupport`
- `intermediateResistance`
- `intradaySupport`
- `intradayResistance`
- `extensionLevels`

The new surfaced adapter does not naturally emit those buckets, so this pass adds an explicit projection layer.

Current projection rules:

- surfaced actionable levels are mapped into the closest matching bucket by dominant source timeframe
- deeper anchors become runtime `extensionLevels`
- strength labels are approximated from surfaced-selection strength rather than pretending the old scorer produced them

This is intentionally explicit in code and comments so later migration work can refine it without hidden assumptions.

## Compare mode usage

Compare mode is for controlled evidence gathering.

It should answer:

- would the new surfaced adapter have changed the trader-facing ladder here
- did top actionable support or resistance change
- did the surfaced level count change
- is the new path suppressing clutter or handling broken levels differently
- what state/confidence/explanation would the new path have exposed

Compare logs are compact JSON payloads with:

- active path
- alternate path
- active top support/resistance
- alternate top support/resistance
- surfaced visible counts
- notable differences
- new-path top-level state/confidence/explanation context

## Why old stays default

Old remains default because:

- downstream runtime consumers still rely on the old bucketed contract
- the new path still uses an adapter projection
- broken-level edge cases are still the main unresolved weak spot
- optional runtime exploration should happen before any default change discussion

## What remains unresolved

Before making `new` the default, we still need:

1. more real compare-mode evidence from runtime use
2. another focused pass on broken-level edge cases
3. confidence that the compatibility projection is not distorting trader-facing behavior in downstream consumers
4. proof that rollback remains trivial in actual use, not just tests

## Recommended path forward

1. Keep `LEVEL_RUNTIME_MODE` unset or set to `old` for normal use.
2. Use `compare` first for controlled live observation.
3. Only use `new` selectively when intentional real-world experimentation is desired.
4. Do not discuss a default switch until compare-mode evidence remains favorable across a broader live sample.
