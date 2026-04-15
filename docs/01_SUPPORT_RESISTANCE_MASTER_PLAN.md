# Support and Resistance Master Plan

## Goal

Build a candle-data-driven support and resistance engine that produces useful levels for traders and later serves as a context engine for the trader improvement system.

## Timeframes

- Daily candles for major levels
- 4 hour candles for intermediate structure
- 5 minute candles for intraday structure

## Engine pipeline

fetch → normalize → detect swings → build raw candidates → add special candidates → cluster into zones → score zones → rank zones → output
