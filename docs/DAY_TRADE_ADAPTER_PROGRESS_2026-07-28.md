# Deterministic Day Trade Adapter Progress

## 2026-07-28

- [x] Confirmed canonical v2 checkout and preserved deprecated checkout.
- [x] Verified port 3010 is occupied by an unrelated Trader Intelligence
  runtime; adapter smoke testing must use another port.
- [x] Audited Yahoo, technical context, ATR, full ladder, runtime API, and admin
  UI seams.
- [x] Add shared Yahoo request coordination and diagnostics.
- [x] Add deterministic role, state, extension, and pullback interpretation.
- [x] Add runtime-only feature control, refresh API, and transition history.
- [x] Add simple admin inspection panel.
- [x] Add targeted tests.
- [ ] Run build and separate-port smoke verification.

## 2026-08-26 same-day provider continuation

- [x] Add a persisted Yahoo/Moomoo same-day candle provider separate from
  historical daily/4-hour candles and the true live-price provider.
- [x] Keep existing version-1 provider configuration compatible by defaulting
  the new field to Yahoo and writing version 2 on the next operator save.
- [x] Route the deterministic adapter and current-session technical fallback
  through the selected provider without silent provider fallback.
- [x] Preserve the last accepted adapter result and current-session range when
  a later selected-provider request fails.
- [x] Add Watchlist Admin selection, provider status, and health diagnostics.
- [ ] Perform hosted staging verification after the Coordinator authorizes the
  required runtime deployment/restart boundary.
