# Levels System

> Current/canonical Levels System v2 worktree. Use this checkout for new
> levels-system runtime, manual watchlist, level analysis, and Trader
> Intelligence integration work unless the user explicitly provides a different
> v2 path.

Candle-based support/resistance, watchlist monitoring, and alert-intelligence tooling for TraderLink.

## Current capabilities

- Historical candle fetching through an injectable provider abstraction
- IBKR-backed historical candle provider
- Level generation across `daily`, `4h`, and `5m` timeframes
- Watchlist monitoring with event detection
- Alert intelligence scoring and filtering
- Sample runners for manual fetch, replay monitoring, and live monitoring

## Scripts

- `npm run build`
- `npm test`
- `npm run manual:test -- AAPL`
- `npm run watchlist:test -- AAPL`
- `npm run alert:test`
- `npm run watchlist:alerts:test -- AAPL`

## Docs

Start with [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).

## TradersLink AI Read cost tracking

The manual watchlist admin records each completed AI Read in the git-ignored
`artifacts/traderslink-ai-read-costs.jsonl` ledger. The admin reports estimated
cost for today, 7 days, 30 days, all time, each ticker, refresh reason, and
model. Estimates use token usage returned by the Responses API plus the actual
number of `web_search_call` output items. OpenAI billing remains the invoice
authority.

Automatic refresh is range-aware rather than based on a flat small-cap price
percentage. It refreshes near 85% consumption of the mapped outer range,
immediately after an outer-boundary gap, or after a 60-minute maximum age.
Manual refresh, activation, and card re-enable remain explicit triggers.

External OpenAI web research defaults to off. The admin's `AI Research
Controls` switch persists the setting in the git-ignored
`artifacts/traderslink-ai-read-settings.json` file. Turning it off removes the
Responses API web-search tool but leaves the local TradersLink press-release
and SEC lookup enabled. Changing the switch does not regenerate an existing
read.

Runtime restarts do not generate fresh AI Reads for every already-active
ticker. Existing cards remain published; an operator can explicitly refresh a
read. Newly activated tickers still receive their normal activation read.

Optional overrides:

- `TRADERSLINK_AI_READ_COST_LEDGER_FILE`
- `TRADERSLINK_AI_READ_PRICE_INPUT_PER_1M`
- `TRADERSLINK_AI_READ_PRICE_CACHED_INPUT_PER_1M`
- `TRADERSLINK_AI_READ_PRICE_OUTPUT_PER_1M`
- `TRADERSLINK_AI_READ_WEB_SEARCH_PRICE_PER_1K`
- `TRADERSLINK_AI_READ_SETTINGS_FILE`
- `TRADERSLINK_AI_READ_WEB_SEARCH_ENABLED` (initial default before a persisted admin setting; defaults to `false`)
- `TRADERSLINK_AI_READ_STARTUP_REFRESH_ENABLED` (defaults to `false`)
