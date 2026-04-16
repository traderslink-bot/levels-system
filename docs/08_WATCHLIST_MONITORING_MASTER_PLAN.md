# Watchlist Monitoring Master Plan

## Goal

Build the watchlist monitoring system on top of the completed levels engine and keep it reusable for alerting, Discord delivery, and future selection layers.

Phase 1 answered:
- where the important levels are

Monitoring answers:
- what price is doing relative to those levels right now

The current system now also supports:
- manual watchlist activation and deactivation
- persisted active/inactive watchlist state
- persisted Discord thread reuse per symbol

## Core idea

The monitoring system should:
- load a watchlist
- load or refresh stored levels for each active symbol
- subscribe to live price updates
- maintain per-symbol monitoring state
- detect interactions with support and resistance zones
- emit structured monitoring events
- remain reusable by downstream alert and Discord layers

## What the current system detects

- breakout
- breakdown
- rejection
- fake breakout
- fake breakdown
- reclaim
- compression near a level
- level touch

## What the current manual operations layer adds

The system can now:
- accept a manually entered symbol
- optionally store a note for that symbol
- mark the symbol active
- seed levels for that symbol
- start live monitoring for that symbol through the shared monitor/runtime path
- deactivate the symbol later without deleting its stored Discord thread id
- reactivate the symbol later from the normal add flow

## What this phase should still not do

- full Discord bot automation
- website delivery system
- AI watchlist selection
- multi-user permission management
- heavy-scale infra optimization

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

A stateful engine will perform better than single-candle boolean checks, and the manual watchlist layer should only orchestrate which symbols are currently active in that engine.
