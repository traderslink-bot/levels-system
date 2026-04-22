# Levels System

Candle-based support/resistance, watchlist monitoring, and alert-intelligence tooling for TraderLink.

## Quickstart

1. Install dependencies with `npm ci`.
2. Create a local `.env` only when you want real integrations such as Discord or provider credentials.
3. Ensure IBKR/TWS or IB Gateway is running before using live/manual runtime paths.
4. Run `npm run check` to verify the repo.

## Runtime notes

- `npm run watchlist:manual` starts the manual watchlist server on `127.0.0.1:3010` by default.
- Validation candle cache lives under `.validation-cache/` locally and is ignored by git.
- Runtime compare and surfaced-adapter evaluation docs start in [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).

## Current capabilities

- Historical candle fetching through an injectable provider abstraction
- IBKR-backed historical candle provider
- Level generation across `daily`, `4h`, and `5m` timeframes
- Watchlist monitoring with event detection
- Alert intelligence scoring and filtering
- Sample runners for manual fetch, replay monitoring, and live monitoring

## Scripts

- `npm run check`
- `npm run build`
- `npm test`
- `npm run manual:test -- AAPL`
- `npm run watchlist:test -- AAPL`
- `npm run alert:test`
- `npm run watchlist:alerts:test -- AAPL`
- `npm run watchlist:manual`

## Docs

Start with [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).
