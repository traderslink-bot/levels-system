# MASTER PLAN (ENTRY POINT)

## Purpose

This file is the top-level guide for the entire levels system.

It summarizes:
- what the system does
- what to build first
- where detailed logic lives

## System Overview

This project builds a candle-based support and resistance engine that:

- generates levels from historical data
- supports manual trading decisions
- evolves into a real-time monitoring system
- feeds a trader improvement system

## Core Components

1. Support and Resistance Engine
2. Watchlist Monitoring System (later phase)
3. Alerting and Discord Integration (later phase)
4. Trader Improvement System Integration (later phase)

## Source of Truth Docs

- `01_SUPPORT_RESISTANCE_MASTER_PLAN.md`
- `02_SUPPORT_RESISTANCE_IMPLEMENTATION_BLUEPRINT.md`
- `03_MANUAL_TESTING_PLAN.md`
- `04_WATCHLIST_AND_MONITORING_SYSTEM_PLAN.md`
- `05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `06_DATA_PROVIDER_AND_CACHING_STRATEGY.md`
- `07_TRADER_IMPROVEMENT_SYSTEM_INTEGRATION_PLAN.md`

## Current Phase

Phase 1: Build Support and Resistance Engine

Focus only on:
- candle data
- level generation
- clustering
- scoring
- manual testing
