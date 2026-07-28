# Deterministic Day Trade Adapter Plan

## Purpose

Build a deterministic, runtime-only trade-plan adapter for volatile micro-cap
stocks. It must use the complete internal level evidence, current websocket
price, Yahoo intraday candles, existing runtime technical context, and existing
runtime ATR context. It must not call OpenAI or publish a second website plan.

## Data contract

- Current price: existing timestamped live-price entry.
- Intraday candles: shared, cached Yahoo 1-minute and 5-minute responses.
- VWAP and EMA: existing runtime technical context calculated from candles.
- ATR: existing completed-five-minute runtime ATR context. Do not calculate a
  separate Yahoo ATR for the adapter.
- Levels: active, extension, and complete `fullLadderLevels` evidence.

## Interpretation contract

The full ladder is an evidence inventory, never an ordinal list of targets.
The adapter groups overlapping or ATR-near evidence and assigns roles:

- hold area
- pullback area
- must-clear supply
- nearby obstacle
- continuation confirmation
- expansion target
- invalidation area

The state model distinguishes extreme extension, provisional base formation,
pullback tests, reclaim requirements, confirmed continuation, failure, and
recovery watch. Same-day structures remain explicitly provisional until
completed candles confirm them.

## Runtime-only first release

- Default off.
- Admin UI only.
- AI Read continues independently for comparison.
- No public watchlist publication.
- Shared Yahoo coordinator deduplicates in-flight requests, caches successful
  responses, applies conservative request spacing, and reports diagnostics.
- Keep the latest 20 material plan transitions per symbol in memory.

## Acceptance gates

1. Dense ladders do not become a mechanical next-level plan.
2. Nearby obstacles are distinct from evidence-supported expansion targets.
3. Missing ATR reduces confidence without disabling all level interpretation.
4. Forming candles can provide provisional evidence but cannot confirm a break,
   hold, or reclaim.
5. Yahoo failures, staleness, validation issues, and cache/backoff state are
   visible in admin diagnostics.
6. AI Read remains available and no website payload changes are made.
7. Targeted engine and runtime endpoint tests pass.
8. Live smoke testing uses an unoccupied port and records Yahoo request counts.

