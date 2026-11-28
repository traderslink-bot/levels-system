# Levels and permanent market-data corrections

Assigned Runtime base: `7ef87be6dc3c6866d22cac8f37b09a1973205719`.
Owner authorized general durable corrections and a coordinated release.
Charts owns the sole durable correction ledger; Levels must not create another.

## Discovery and bounded plan

- On-demand Levels uses a dedicated uncached historical service, Daily/4H only,
  and a new engine result for every completed request. Only concurrent requests
  are coalesced. Both native and verified requests opt into accepted history.
- Consequently the corrected shared history must cover native Daily, native
  4H and qualified regular-session 4H, including the accepted-evidence branch.
  A correction overlay limited to 1-minute chart bars cannot repair Levels.
- Saved maps retain original source facts. Their current use as chart evidence
  must fail when the authoritative contributing inputs are superseded. Charts
  is defining accepted-input invalidation; source snapshots/receipts must not
  be overwritten or recreated.
- The active selected historical/live/same-day provider is Alpaca, confirmed by
  Release. Dormant EODHD history must not be silently treated as compatible raw
  SIP minutes. No provider change is part of this correction.
- Watchlist retains in-memory derived levels and startup cache. Release routed
  that separate consumer to Admin Watchlist; Levels does not edit its manager,
  cache, AI or notification lifecycle in parallel.
- Add a consumer regression through the actual Gateway adapter, candle service,
  engine and Generator: updated Daily/4H high/volume affects a new calculation,
  earlier snapshots remain immutable, Runtime recreation consumes the updated
  source, and empty history cannot resurrect a completed result. Cover multiple
  tickers and both wire formats without real provider requests.
- Pending shared contract: correction during calculation/receipt lookup/save,
  affected-window and basis identity, and current-vs-superseded receipt lookup.
  Review the frozen contract before deciding whether a Runtime change is needed.

## Implemented consumer correction

- The shared Runtime reader validates the authoritative SIP correction manifest
  on both legacy and neutral transports. It never turns unavailable/malformed
  metadata into an empty correction set. Admin Watchlist consumes this same
  reader in its separately owned manager/cache work.
- On-demand Levels and private generation now use one frozen history cutoff
  inside one exact half-open 730-day manifest scope. The current default Daily
  plan spans 650 days. Requests beyond the bounded scope fail visibly; history
  is not silently truncated. Other historical providers preserve their behavior.
- Before generating, pending corrections hold the calculation. After all frames
  complete, the same symbol's scoped revision must still match. Global changes
  from unrelated symbols are ignored. An affected Daily or 4H frame needs its
  bound qualifying accepted input; a contained frame error cannot escape as a
  successful partial map. In particular, native Daily is not reconstructed by
  summing minutes. An unqualified corrected Daily response holds the result.
- The shared Gateway remains the only correction writer and canonical history
  source. Existing saved-map JSON remains immutable. Charts owns invalidating
  current accepted-input lookups, current chart projection and the Platform
  generation/save fence. Their integrated qualification is a release dependency.
- Reviewed the existing Watchlist Help guide in the Coordinator-authorized
  Platform source. No guide update is needed for this data-integrity change:
  no user control, scoring, spacing, card cap or workflow has changed.

## Verification and release handoff

Final guarded run: `/tmp/levels-durable-corrections-w2dsslq6/run-20261128T004757100072Z`.
The preceding complete run passed too; a final no-store directive was then added
to correction metadata reads and asserted in both transport tests, followed by
this final source check.
The command-generated result and independent closeout contain actual UTC times.

- 19 focused tests pass: actual shared adapter/candle service/engine/Generator
  with two synthetic symbols and both transports; corrected high and volume,
  immutable earlier map, consumer recreation, no stale completed-result reuse;
  plus pending/racing/unavailable revisions, qualified/refused coverage,
  contained frame failures, exact bounded scope and malformed response cases.
- 60 existing Generator/provider/evidence/provenance tests pass.
- Full `tsc --noEmit` and `git diff --check` pass.
- Canonical common guard and owned QA held through child reaping and empty
  groups. The independent closeout confirms all original children absent,
  groups empty and our QA removed. No foreign process or guard was changed.
- Initial fixture-only four failures remain in the earlier run: the anomaly
  was mistakenly placed on the latest Daily bar rather than the previous-day
  bar. Corrected the fixture only; no product change was made for that failure.

These synthetic consumer checks do not qualify Gateway ledger persistence,
provider aggregation, Platform saves, actual process restart or hosted state.
The earlier BNAI/13-ticker Potential Path regression and deployed resistance
selection remain intact; no scoring/Full Ladder quality redesign is included.
No provider requests, real saves, SQL, credentials or original VIVS effects ran.

Release Coordinator owns preservation, integration and deployment. Deploy the
Gateway route before its Runtime consumers; integrate Admin Watchlist's distinct
cache/manager correction and Charts' Platform evidence correction in the agreed
order. This slice has no migration. An immutable allowlisted packet accompanies
this record. The combined release is pending those owners' qualification.
