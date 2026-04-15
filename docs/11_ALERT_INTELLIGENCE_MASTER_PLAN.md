# Alert Intelligence Master Plan

## Goal

Build the Phase 3 alert intelligence layer on top of the completed Phase 1 levels engine and Phase 2 monitoring engine.

Phase 2 answered:
- what price is doing relative to important levels

Phase 3 answers:
- which events matter most
- how strong each signal is
- how to present signals in a trader-friendly way
- which signals should be suppressed or downgraded

## Core idea

Raw monitoring events are not the final product.

The alert intelligence layer should:
- score event importance
- classify confidence
- attach context from level strength and zone type
- suppress weak/noisy events
- format readable output for humans
- prepare the system for Discord and app alerts later

## What this phase should do

- classify monitoring events by severity
- assign confidence labels
- prioritize stronger multi-timeframe zones
- filter weak single-timeframe noise
- produce human-readable alert objects

## What this phase should not do yet

- real Discord posting
- push notification delivery
- user-level permissions
- brokerage execution logic

## Alert philosophy

The system should prefer fewer, better alerts.

Good alerts:
- happen near meaningful levels
- come from strong zones
- fit a believable event pattern
- are easy to understand quickly

Weak alerts:
- come from weak 5m-only zones
- are low-context compression signals
- conflict with stronger nearby zones
- add little decision value
