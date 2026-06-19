# Market Structure Open-Market Validation Plan

## Goal

Validate the market-structure gate during a real live or paper-market session, using a controlled watchlist and audit artifacts. The main thing to prove is that formal BOS/CHOCH is now conservative and clean:

- `5m|formal|...` BOS/CHOCH remains metadata-only.
- `4h|formal|...` and `daily|formal|...` can become visible/actionable.
- `5m|stable|...` can still appear separately when material.
- Tactical 5m formal structure does not bypass cooldown or post policy.

## Preconditions

- IBKR/TWS or Gateway is connected.
- The manual watchlist runtime can start.
- Use a dedicated session folder under `artifacts/long-run/`.
- Keep the run small: one to three controlled tickers.
- Use conservative runtime settings:
  - quiet posting profile
  - market-structure standalone posts off or tightly controlled
  - audit logging enabled

## Steps

1. Start a controlled live/paper session.

2. Confirm runtime plumbing:
   - IBKR connected
   - active symbols restored or started
   - live price updates arriving
   - `discord-delivery-audit.jsonl` being written
   - `market-structure-lifecycle.jsonl` being written

3. Watch the structure lanes:
   - Confirm no visible `5m|formal|...` story keys.
   - Confirm `4h|formal|...` or `daily|formal|...` can surface when present.
   - Confirm `5m|stable|...` can surface separately when material.
   - Confirm no tactical 5m formal event breaks same-story cooldown.

4. Run the live smoke check after the session:

```powershell
npm run structure:live-smoke -- artifacts\long-run\<new-session>
```

5. Run aggregate gate calibration:

```powershell
npm run structure:gate-calibrate -- artifacts\long-run --limit 25
```

6. Review failures, if any:
   - visible `5m|formal|...` means router/story visibility leaked
   - actionable 5m formal means gate policy leaked
   - missing stable `5m` context means stable-story lane needs review
   - missing audit files means runtime/audit plumbing needs review

## Tuning Rule

Do not loosen the current formal BOS/CHOCH gate unless live evidence clearly shows that valuable higher-timeframe structure is being missed. Tactical 5m formal BOS/CHOCH should remain metadata-only unless a separate evidence pack proves it can be promoted without increasing failed or mixed outcomes.

## Expected Pass Criteria

- `npm run structure:live-smoke` passes on the new session.
- No visible `5m|formal|...` story keys appear.
- Higher-timeframe formal structure remains eligible.
- Stable 5m structure remains eligible through the stable lane.
- Aggregate calibration shows actionable formal events remain cleaner than metadata-only tactical events.
