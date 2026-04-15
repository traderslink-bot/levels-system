# SYSTEM BLUEPRINT

## Purpose

This file defines system architecture only.

## High-Level Architecture

Data flow:

API → Normalize → Cache → Level Engine → Level Store → Monitoring → Events → Alerts

## Engines

### Level Engine
- builds support and resistance
- uses historical candles

### Watchlist Engine (future)
- monitors live prices
- compares price to levels

### Event Engine (future)
- detects breakouts, rejections, and fakeouts

### Alert Engine (future)
- formats and sends alerts
