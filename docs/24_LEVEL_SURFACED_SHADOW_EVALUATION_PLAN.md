# Level Surfaced Shadow Evaluation Plan

## Purpose

This phase broadens the surfaced-output evidence base without changing live runtime behavior.

It evaluates:
- the old surfaced runtime path
- the new surfaced selection adapter

on the same snapshot inputs and the same forward candles, then summarizes where each system wins and why.

## Why this phase exists

The first surfaced showdown was useful, but it was still a small curated sample.

Before discussing any optional runtime flag, we need a broader replayable batch that can answer:
- does the new adapter still win across more varied cases
- where does the old path still outperform
- which surfaced dimensions still need calibration

## What is being compared

Old system:
- the current bucketed surfaced runtime output path

New system:
- the new structural ranking layer
- the new surfaced selection adapter built on top of it

The batch evaluator does not replace runtime behavior.
It reuses the surfaced validation showdown logic and adds:
- tagged case grouping
- aggregate winner counts
- practical metric rollups
- manual review queue generation
- migration readiness guidance

## Categories tracked

Replayable cases can be tagged with practical labels such as:
- `support_hold`
- `resistance_rejection`
- `clean_breakout`
- `weak_clutter`
- `anchor_case`
- `broken_level_case`
- `support_case`
- `resistance_case`
- `near_price_case`
- `mixed_case`

These tags drive the category summaries so we can see where each surfaced path is strongest or weakest.

## Practical metrics tracked

Each case still uses the surfaced showdown metrics:
- actionable near-price quality
- ladder cleanliness
- forward interaction relevance
- first interaction alignment
- structural sanity
- anchor usefulness

The shadow batch then aggregates:
- overall old/new winner counts
- average validation scores and deltas
- per-tag category outcomes
- practical metric win counts
- biggest new wins
- biggest old wins
- manual review queue

## How to interpret results

Healthy shadow evidence should look like:
- new adapter wins more often overall
- new adapter improves or at least matches near-price usefulness
- old-path wins are limited and understandable
- key categories such as `support_case`, `resistance_case`, and `near_price_case` do not lean strongly back toward the old path

Warning signs:
- old path still wins repeatedly in key categories
- mixed outcomes dominate
- new wins rely mostly on structural sanity while old still wins actionable usefulness
- broken-level or ultra-near-price cases remain old-path strengths

## Migration thresholds

This batch does not switch runtime behavior.

Reasonable progression:
1. `continue_shadow_mode`
2. `ready_for_more_real_case_expansion`
3. `ready_for_optional_runtime_flag_exploration`

Blockers:
- `needs_surface_calibration`
- `blocked_by_old_path_strength_in_key_categories`

Only after broader shadow evidence remains favorable should we discuss an optional runtime flag. No live default change should happen from this phase alone.
