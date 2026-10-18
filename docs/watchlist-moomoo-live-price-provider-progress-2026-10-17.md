# Moomoo live-price provider progress - 2026-10-17

## Approved scope

- Add Moomoo as a separate selection under the existing **Live Price Provider** control.
- Poll the deployed protected Platform Moomoo quote bridge once every 15 seconds for the active Watchlist symbols in one request.
- Select `preMarketPrice` from 04:00 to 09:30, `lastPrice` from 09:30 to 16:00, `afterMarketPrice` from 16:00 to 20:00, and `overnightPrice` at other U.S. Eastern times.
- If Moomoo fails or lacks the selected session price, use a fresh matching-session Yahoo intraday price. If Yahoo has no fresh matching-session price, retain the prior runtime price. Do not use EODHD.
- Keep EODHD available as a separate selectable provider because it may be used again later.

## Local implementation

- [x] Added `PlatformMoomooLivePriceProvider`, which calls the protected `/api/live-watchlist/moomoo-quote` bridge using the existing publisher credential.
- [x] Added `moomoo` to runtime provider parsing, factory creation, persisted provider settings, health status, and the existing live-provider dropdown.
- [x] Added a Yahoo intraday fallback for Moomoo bridge failures and missing active-session prices, with no EODHD fallback.
- [x] Left historical-candle and same-day-candle provider behavior unchanged.
- [ ] Restart the local runtime and manually select Moomoo.
- [ ] Confirm an active symbol receives the correct session-specific price before any release or production change.

## Boundaries

Selecting Moomoo calls Yahoo only when Moomoo fails or has no active-session price. It does not call EODHD; selecting EODHD continues to use its existing WebSocket provider.
