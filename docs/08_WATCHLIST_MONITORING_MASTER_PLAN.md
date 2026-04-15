# Watchlist Monitoring Master Plan

## Goal

Build the Phase 2 watchlist monitoring system on top of the completed Phase 1 levels engine.

Phase 1 answered:
- where the important levels are

Phase 2 answers:
- what price is doing relative to those levels right now

## Core idea

The monitoring system should:
- load a watchlist
- load or refresh stored levels for each symbol
- subscribe to live price updates
- maintain per-symbol monitoring state
- detect interactions with support and resistance zones
- emit structured monitoring events
- remain reusable by future alerting and Discord layers

## What this phase should detect

- breakout
- breakdown
- rejection
- fake breakout
- fake breakdown
- reclaim
- compression near a level

## What this phase should not do yet

- full Discord automation
- full UI dashboard
- advanced multi-user permissions
- heavy-scale infra optimization

## Dependency model

This system depends on:
- stored support and resistance levels from Phase 1
- a live price source
- a polling or streaming loop
- stateful monitoring logic

## Monitoring philosophy

Do not treat every touch as a signal.

The system should use state:
- approaching
- touching
- testing
- breaking
- confirming
- rejecting
- failing

A stateful engine will perform much better than single-candle boolean checks.
