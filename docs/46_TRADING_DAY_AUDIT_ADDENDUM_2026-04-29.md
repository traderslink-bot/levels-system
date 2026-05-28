# Trading Day Audit Addendum - 2026-04-29

## Scope

This addendum records the extra audits run after the deeper support/resistance level audit and the post-noise improvements.

Reviewed:

- combined Discord delivery audit for April 29
- generated report pack in `artifacts/`
- manual-watchlist runtime logs across April 29 session folders
- current source for old trader-facing wording
- stock-context opener bodies in the saved Discord audit
- cached candle replay quality reports after the level-surfacing changes

## Runtime And Delivery Findings

- Combined Discord audit rows: `394`
- Posted rows: `393`
- Failed rows: `1`

Only delivery failure found:

- `SEGG breakdown`
- operation: `post_alert`
- failure: Discord API `503`
- message: upstream connect / reset before headers

Interpretation:

- This looks like a transient Discord/API transport failure, not a local alert-formatting bug.
- Current code already has audited delivery records, so this remains visible in future reports.

## Trader-Language Findings

The combined April 29 Discord audit still contains old wording such as:

- `LEVEL SNAPSHOT`
- `Status:`
- `Signal:`
- `Decision area`
- `alert direction`
- `after the alert`
- `moving toward`
- `no longer immediate resistance/support`
- `Next levels`
- `dip-buy`

Interpretation:

- Most hits are from posts created before the later Discord wording cleanup commits.
- Current source search did not find these as active trader-visible formatter output, except tests/docs that intentionally assert against them.
- Current source also has tests guarding these boundaries.

Remaining watch item:

- Future live Discord output should be checked again after restart to confirm no old wording appears from stale runtime code.

## Stock Context Findings

Saved April 29 stock-context posts showed old opener formats:

- source labels like `Exchange (Finnhub)` and `Yahoo context`
- `Current price (Yahoo): n/a`
- Yahoo regular/premarket/postmarket rows with `n/a`
- one `Shares outstanding: 0.00K` example on `SLGB`

Interpretation:

- Current formatter source and tests already address this:
  - current price is shown at the top without source labels
  - Yahoo/Finnhub labels are removed from trader-facing output
  - unavailable Yahoo rows are omitted
  - zero market cap / shares outstanding values are omitted
- No additional code change was needed in this addendum.

## Level Audit Follow-Up

After the level-surfacing fixes, replay audits against cached April 29 IBKR candles showed healthy forward ladders for:

- `SKYQ`
- `ATER`
- `BIYA`
- `SEGG`
- `SAGT`
- `VSME`
- `ABTS`
- `XTLB`
- `SLGB`
- `OSRH`
- `DRCT`

Remaining level warning:

- `KIDZ` still has a thin support ladder.
- The cached candles only exposed one forward support, so the system should not invent extra support there.

## Posting-Frequency Findings

The post-count audit still shows the heaviest symbols from the raw April 29 output:

- `SAGT`: 60 posted rows
- `SEGG`: 55 posted rows plus 1 failed row
- `XTLB`: 54 posted rows
- `SKYQ`: 53 posted rows
- `KIDZ`: 50 posted rows
- `ATER`: 46 posted rows

Interpretation:

- These counts are from the actual trading day before the latest burst-control and same-story cooldown changes.
- The replay profile comparison after code changes showed lower simulated counts:
  - quiet: `318`
  - balanced: `338`
  - active: `351`
  - original: `387`

Remaining watch item:

- The next live run should be audited with the same report pack to confirm the calmer policy works in real runtime, not only replay.

## Data Quality Findings

The cached IBKR candle audits repeatedly showed degraded data flags:

- stale final candles
- missing recent candles
- suspicious gaps
- insufficient bars
- incomplete current session data

Interpretation:

- This is consistent with IBKR being a temporary test provider.
- Level logic should not be overfit to IBKR quirks.
- Provider switch testing should compare the same symbols and audit criteria against the new provider.

## Conclusion

No new urgent code issue was found after the latest level and wording fixes.

The remaining useful work is verification on the next live run:

- confirm current runtime posts no longer show old system-shaped wording
- confirm stock-context openers use the clean format
- confirm post counts are calmer for runner symbols
- confirm `KIDZ`-style thin ladders are rare or data-supported
- compare level quality after switching away from IBKR
