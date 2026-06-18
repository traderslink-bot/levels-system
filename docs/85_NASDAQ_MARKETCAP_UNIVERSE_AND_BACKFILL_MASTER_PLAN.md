# Nasdaq Marketcap Universe And Backfill Master Plan

This is the operating plan for replacing hand-maintained Nasdaq market-cap ticker lists with one generated universe and derived under-$500M backfill queues.

## Purpose

The project should treat Nasdaq membership and market-cap buckets as a generated data source, not a permanent markdown list.

The generator creates:

- one canonical current Nasdaq master JSON,
- a clean common-stock-like universe,
- under-$500M market-cap bucket reports,
- a diff against the old under-$100M checklist,
- and dry-run candle-backfill stages.

## Source

Primary source:

```text
https://api.nasdaq.com/api/screener/stocks?exchange=nasdaq&download=true
```

The old reference doc is:

- `docs/nasdaq-under-100m-marketcap-watchlist.md`

That doc says to ignore it unless instructed, but it is useful here because the operator explicitly asked to work from it and it records the Nasdaq screener endpoint.

## Commands

Preview current Nasdaq universe without writing durable files:

```powershell
npm run nasdaq:universe:check
```

Write the canonical master universe, dated artifacts, generated under-$500M markdown, and old-checklist diff:

```powershell
npm run nasdaq:universe -- --write
```

Generate a dry-run candle-backfill plan from the current master universe:

```powershell
npm run nasdaq:under500:backfill-plan
```

Generate a stricter executable backfill plan without connecting to IBKR:

```powershell
npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 25
```

Run an actual bounded provider batch only after the operator explicitly approves IBKR use:

```powershell
npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 25 --execute --throttle-ms 1500 --ibkr-timeout-ms 30000
```

## Output Files

Canonical machine-readable source:

- `data/nasdaq-universe/nasdaq-current-universe.json`

Dated artifacts:

- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/nasdaq-raw-screener.json`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/nasdaq-clean-universe.json`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/nasdaq-under500m-universe.json`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/nasdaq-under500m-universe.md`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/nasdaq-existing-doc-diff.json`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/nasdaq-existing-doc-diff.md`

Operator-facing generated doc:

- `docs/nasdaq-under-500m-marketcap-universe.md`

Backfill plan artifacts:

- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/under500-backfill-plan/nasdaq-under500m-backfill-plan.json`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/under500-backfill-plan/nasdaq-under500m-backfill-plan.md`

Executable dry-run / execute artifacts:

- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/under500-candle-backfill/nasdaq-under500m-candle-backfill-plan.json`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/under500-candle-backfill/nasdaq-under500m-candle-backfill-plan.md`
- `artifacts/nasdaq-marketcap-universe/YYYY-MM-DD/under500-candle-backfill/nasdaq-under500m-candle-backfill-results.jsonl`

## Latest Generated Baseline

Generated: 2026-05-07

Current Nasdaq universe:

- Raw Nasdaq screener rows: 4042
- Clean common-stock-like rows: 2979
- Clean under `$500M` rows: 1663

Under `$500M` bucket counts:

- Under `$100M`: 1011
- `$100M-$200M`: 242
- `$200M-$300M`: 168
- `$300M-$400M`: 133
- `$400M-$500M`: 109

Dry-run candle coverage plan:

- Total under `$500M` missing full `daily,4h,5m` warehouse coverage: 1433
- Stage 1 under `$100M`: 205 covered, 806 missing
- Stage 2 `$100M-$200M`: 10 covered, 232 missing
- Stage 3 `$200M-$300M`: 9 covered, 159 missing
- Stage 4 `$300M-$400M`: 4 covered, 129 missing
- Stage 5 `$400M-$500M`: 2 covered, 107 missing

Stricter executable backfill dry run:

- Command: `npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 25 --out-dir artifacts\nasdaq-marketcap-universe\2026-05-07\under500-candle-backfill-stage1-dry-run-25`
- Mode: `dry_run`
- IBKR connection attempted: no
- Full under `$500M` strict coverage: 149 covered, 82 partial, 1432 missing
- Stage 1 strict coverage: 140 covered, 66 partial, 805 missing
- Selected first Stage 1 fetch batch: 25 symbols

First live Stage 1 smoke batch:

- Command: `npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 25 --execute --throttle-ms 3000 --ibkr-timeout-ms 30000 --out-dir artifacts\nasdaq-marketcap-universe\2026-05-07\under500-candle-backfill-stage1-live-001`
- Result rows: 70 fetched, 0 failed
- Post-run strict coverage: 172 covered, 80 partial, 1411 missing
- Post-run Stage 1 strict coverage: 163 covered, 64 partial, 784 missing

Overnight Stage 1 batch:

- Command: `npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 700 --execute --throttle-ms 3000 --ibkr-timeout-ms 30000 --out-dir artifacts\nasdaq-marketcap-universe\2026-05-07\under500-candle-backfill-stage1-overnight-001`
- Runtime: about 5.7 hours
- Unique symbols selected: 700
- Result rows: 2036 fetched, 3 failed
- Failed rows:
  - `BON` `5m`: IBKR fetch timeout after 30000ms
  - `GDTC` `4h`: IBKR fetch timeout after 30000ms
  - `GYRO` `5m`: IBKR code 162 / HMDS query returned no data
- Post-run strict coverage: 854 covered, 39 partial, 770 missing
- Post-run Stage 1 strict coverage: 845 covered, 23 partial, 143 missing
- Warehouse audit after run: 3085 symbol/timeframe groups, 744523 rows, 953 watch groups, 0 broken groups
- Proof artifacts:
  - `artifacts/nasdaq-marketcap-universe/2026-05-07/under500-candle-backfill-stage1-overnight-001/`
  - `artifacts/nasdaq-marketcap-universe/2026-05-07/under500-candle-backfill-stage1-after-overnight-001-dry-run/`
  - `artifacts/nasdaq-marketcap-universe/2026-05-07/under500-candle-backfill-stage1-after-overnight-001-warehouse-audit/`

Old under-$100M checklist diff:

- Still current under `$100M`: 213
- Current but moved bucket or filtered: 27
- Not in current Nasdaq screener: 34
- Possible alias candidate: 1
- New under `$100M` candidates: 798

Important ticker resolution:

- `ATNF`, `BSGM`, `CYCC`, `CYTO`, `FGEN`, `KTRA`, and `NBY` were not found in the current Nasdaq screener.
- `WTOU` was not found, but `WTO` was found and flagged as the likely current-symbol candidate.

## Bucket Rules

The generated under-$500M buckets are non-overlapping:

- `under_100m`: `0 < marketCap < 100,000,000`
- `100m_to_200m`: `100,000,000 <= marketCap < 200,000,000`
- `200m_to_300m`: `200,000,000 <= marketCap < 300,000,000`
- `300m_to_400m`: `300,000,000 <= marketCap < 400,000,000`
- `400m_to_500m`: `400,000,000 <= marketCap < 500,000,000`
- `500m_plus`: retained in the master JSON, not targeted for under-$500M backfill.

## Common Equity Filter

The clean universe keeps raw rows visible but only treats a ticker as likely common equity when:

- symbol is valid,
- market cap is greater than zero,
- name does not look like warrant, right, unit, preferred, note, ETF, fund, or trust,
- symbol suffix does not look like a common non-equity suffix such as `W`, `WS`, `WT`, `U`, or `R`.

This filter is intentionally conservative. Excluded rows stay in the raw master for audit visibility.

## Old Checklist Diff

The generated diff compares the old under-$100M checklist against the current Nasdaq screener universe and classifies rows as:

- `still_current_under_100m`
- `current_but_moved_bucket`
- `not_in_current_nasdaq_screener`
- `possible_alias_candidate`
- `new_under_100m_candidate`

Known current expectation from the 2026-05-07 probe:

- `WTO` is current in Nasdaq screener.
- `WTOU` is not current and should be treated as stale unless a validated alias proves otherwise.
- `ATNF`, `BSGM`, `CYCC`, `CYTO`, `FGEN`, `KTRA`, and `NBY` should be treated as inactive/unresolved unless current Nasdaq or IBKR evidence proves otherwise.

## Backfill Rules

Do not backfill all Nasdaq tickers yet.

The first operational target is only the clean common-stock-like under-$500M universe, staged by market-cap bucket:

- Stage 1: under `$100M`
- Stage 2: `$100M-$200M`
- Stage 3: `$200M-$300M`
- Stage 4: `$300M-$400M`
- Stage 5: `$400M-$500M`

Default broad-backfill timeframes:

- `daily`
- `4h`
- `5m`

Do not include broad `1m` backfill unless the operator explicitly asks for it.

The under-$500M backfill-plan command is a dry-run planning artifact. It checks existing `data/candles/ibkr` coverage and lists missing symbols by stage. It does not fetch provider data.

The `nasdaq:under500:backfill` command is the executable path, but it is still dry-run by default. It only connects to IBKR when `--execute` is present.

Duplicate protection:

- Before fetching, covered symbol/timeframe pairs are skipped.
- Partial or missing timeframes are fetched as whole lookback windows for that timeframe.
- Execute mode writes through `DurableCandleWarehouse.upsertCandles`, which merges rows by timestamp inside each symbol/timeframe/date file.
- The planner reports partial data when row counts are low, candles are stale, invalid rows exist, or duplicate timestamps are detected.

Completeness baseline for the broad under `$500M` sweep:

- `daily`: at least 120 unique rows, latest candle within 14 days
- `4h`: at least 60 unique rows, latest candle within 14 days
- `5m`: at least 100 unique rows, latest candle within 14 days
- `1m`: excluded from broad runs unless explicitly requested

Overnight operation:

- Use small batches first, then increase `--max-symbols` only after provider behavior is stable.
- A reasonable overnight command is `npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 100 --execute --throttle-ms 2000 --ibkr-timeout-ms 30000 --out-dir artifacts\nasdaq-marketcap-universe\YYYY-MM-DD\under500-candle-backfill-stage1-overnight-001`.
- Keep TWS or IB Gateway open for the whole run.
- Codex does not need to stay involved while the terminal process runs; token usage only happens when the operator asks Codex to start it, inspect logs, or summarize progress.
- If the process is launched from a normal terminal or background PowerShell session, it can continue without continuous chat interaction.

## Future Workflow

1. Run `npm run nasdaq:universe:check`.
2. If the endpoint is healthy, run `npm run nasdaq:universe -- --write`.
3. Read the generated old-checklist diff and alias candidates.
4. Run `npm run nasdaq:under500:backfill-plan`.
5. Backfill candles in stages, starting with Stage 1 under `$100M`.
6. If IBKR returns code `200` / no security definition, mark the ticker as contract-unresolved and do not retry blindly.
7. After under `$500M` coverage is clean, extend the same system to `$500M+`.
