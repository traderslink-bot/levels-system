# Under100M Candle Warehouse Backfill Plan

This is the operating plan for filling `data/candles` with historical candle data for the NASDAQ under-$100M universe.

Use this when the operator asks to "backfill the warehouse", especially for the ticker list in `docs/nasdaq-under-100m-checklist-with-previous-tickers.md`.

## Purpose

The goal is candle coverage, not Discord wording tuning.

The warehouse is the source of saved candle evidence used by replay, level-quality checks, missed-move proof, support/resistance story replay, startup cache readiness, and future closed-market audits. If a ticker lacks warehouse candles, later audits may look like app behavior problems when the real issue is missing evidence.

## Trusted Ticker Source

Primary source:

- `docs/nasdaq-under-100m-checklist-with-previous-tickers.md`

Important boundary:

- The trusted universe is the `All bucketed NASDAQ under $100M tickers, deduped` section.
- The `Previously given tickers from chat` section is useful history, but it is not the canonical under-$100M backfill universe.
- Do not manually mark coverage in the checklist. Let the backfill script refresh the coverage section from `data/candles/ibkr`.

## Current Snapshot

Latest dry run: 2026-05-07

Command:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --dry-run --out-dir artifacts\under100m-candle-backfill-plan-2026-05-07
```

Result:

- Universe: 275
- Covered: 267
- Missing: 8
- Target timeframes: `daily`, `4h`, `5m`

Missing symbols:

- `ATNF`
- `BSGM`
- `CYCC`
- `CYTO`
- `FGEN`
- `KTRA`
- `NBY`
- `WTOU`

Actual backfill attempt: 2026-05-07

Command:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --symbols ATNF,BSGM,CYCC,CYTO,FGEN,KTRA,NBY,WTOU --timeframes daily,4h,5m --out-dir artifacts\under100m-candle-backfill-2026-05-07-execute --throttle-ms 1500 --ibkr-timeout-ms 30000
```

Result:

- IBKR socket was reachable on `127.0.0.1:7497`.
- Runtime completed without timing out.
- All 8 symbols failed on IBKR contract lookup with code `200`: `No security definition has been found for the request.`
- No candles were added.
- Coverage stayed 267/275.
- Result log: `artifacts/under100m-candle-backfill-2026-05-07-execute/under100m-candle-backfill.jsonl`

Interpretation:

- This is no longer a generic backfill/pacing problem.
- Treat these 8 as a contract qualification / rename / delist / OTC-move alias queue.
- Do not keep retrying the same symbols blindly until their current IBKR contracts are qualified or explicit aliases are added.

Warehouse audit snapshot:

```powershell
npm run candles:audit -- data\candles --out-dir artifacts\under100m-candle-backfill-plan-2026-05-07\warehouse-audit
```

Result:

- Symbol/timeframe groups: 1101
- Rows: 314110
- Watch groups: 250
- Broken groups: 0
- Artifact: `artifacts/under100m-candle-backfill-plan-2026-05-07/warehouse-audit/candle-warehouse-audit.md`

## Main Script

Use:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts
```

Script:

- `src/scripts/run-under100m-candle-warehouse-backfill.ts`

Default behavior:

- Reads `docs/nasdaq-under-100m-checklist-with-previous-tickers.md`
- Parses only the canonical bucketed under-$100M section
- Writes candles under `data/candles/ibkr/<SYMBOL>/<timeframe>/YYYY-MM-DD.jsonl`
- Updates the checklist coverage section after each symbol
- Logs per-symbol results to `artifacts/under100m-candle-backfill/under100m-candle-backfill.jsonl`

Default timeframes:

- `daily`: 220 trading days
- `4h`: 180 days
- `5m`: 240 candles

Optional timeframe:

- `1m`: 390 candles

Use `1m` only for focused replay or trade-window work. Do not add it to the broad under-$100M sweep unless the operator explicitly wants the heavier fetch.

## Safe Backfill Flow

1. Refresh target list without connecting to IBKR:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --dry-run --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-plan
```

2. Confirm warehouse structure is clean:

```powershell
npm run candles:audit -- data\candles --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-plan\warehouse-audit
```

3. Run the missing-symbol backfill while TWS or IB Gateway is open:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --symbols ATNF,BSGM,CYCC,CYTO,FGEN,KTRA,NBY,WTOU --timeframes daily,4h,5m --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-execute --throttle-ms 1500 --ibkr-timeout-ms 30000
```

4. Verify coverage after the fetch:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --dry-run --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-verify
```

5. Re-run warehouse audit:

```powershell
npm run candles:audit -- data\candles --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-verify\warehouse-audit
```

6. If coverage reaches 275/275, record the result in:

- `docs/nasdaq-under-100m-checklist-with-previous-tickers.md`
- `docs/81_AUDIT_AND_REPLAY_COVERAGE_INDEX.md`
- this file

The checklist should be updated by the script. The index and this plan should be updated manually as the durable audit trail.

## IBKR Runtime Notes

The actual backfill requires TWS or IB Gateway to be open and reachable.

The script uses:

- `LEVEL_BACKFILL_IBKR_CLIENT_ID`
- `LEVEL_BACKFILL_IBKR_HOST`
- `LEVEL_BACKFILL_IBKR_PORT`

Fallbacks:

- `LEVEL_VALIDATION_IBKR_CLIENT_ID`
- `LEVEL_VALIDATION_IBKR_HOST`
- `LEVEL_VALIDATION_IBKR_PORT`

Default client id:

- `202`

If the connection fails or hangs:

- Do not treat that as a market-story bug.
- Keep the failed symbols in the backfill lane.
- Re-run with `--retry-failed` when the IBKR provider is stable.
- Use smaller batches with `--max-symbols` or explicit `--symbols` if IBKR pacing becomes the problem.

If IBKR returns code `200` / no security definition:

- Treat the symbol as unresolved, not temporarily missing candles.
- Check whether the ticker was renamed, delisted, moved to OTC/PINK, or needs a different primary exchange/currency/security type.
- Add a validated explicit alias only after qualifying the current IBKR contract.
- Then rerun the failed symbol with `--symbols SYMBOL --force` if needed.

## Retry Rules

Use this when a provider failure is expected to be temporary:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --retry-failed --timeframes daily,4h,5m --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-retry --throttle-ms 2000 --ibkr-timeout-ms 30000
```

Use this when a ticker is known to need a clean refresh:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --symbols SYMBOL --force --timeframes daily,4h,5m --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-force
```

Do not use `--force` broadly unless there is evidence the stored candles are stale or malformed. The normal path skips covered symbols and avoids needless provider load.

## Relationship To Replay Audits

This backfill lane feeds replay quality, but it is not itself a Discord-story audit.

After symbols are backfilled, use the normal audit/replay docs:

- `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md`
- `docs/81_AUDIT_AND_REPLAY_COVERAGE_INDEX.md`
- `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md`
- `docs/77_TRADER_INTELLIGENCE_HISTORICAL_BACKFILL_AND_ASOF_PLAN_2026-05-05.md`

The practical rule:

- If a replay verdict is `data_limited`, fix candle coverage first.
- If candles are present and replay still tells a bad trader story, then investigate story state, level maps, post policy, or runtime behavior.

## Next Target

Next target is contract resolution, not another blind fetch:

```text
ATNF, BSGM, CYCC, CYTO, FGEN, KTRA, NBY, WTOU
```

Required condition:

- Current IBKR contract or validated alias found for each symbol.

Expected success state:

- Under-$100M checklist shows 275 covered, 0 missing.
- Provider failures are cleared or explicitly documented as inactive/delisted symbols.
- Warehouse audit still reports 0 broken groups.
