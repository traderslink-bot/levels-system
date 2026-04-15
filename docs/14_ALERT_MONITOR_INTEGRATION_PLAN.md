# Alert Monitor Integration Plan

## Goal

Integrate Phase 3 alert intelligence directly into the Phase 2 watchlist monitor so the live monitoring loop emits trader-facing alerts instead of only raw monitoring events.

## New flow

live price update
→ event detection
→ alert intelligence scoring
→ weak alert suppression
→ formatted alert output

## Why this matters

Before integration:
- Phase 2 emitted raw events
- Phase 3 could score synthetic sample events

After integration:
- the real watchlist stream produces scored and filtered alerts in one pipeline

## Immediate target

- keep raw monitoring events available internally
- add an alert-aware sample runner
- only print formatted alerts when the intelligence layer approves them
