# Watchlist timestamp crash recovery and correction

The staging-named Watchlist runtime serves live Watchlist data. The owner
requested service restoration first and correction second. The Coordinator
performed one existing-deployment restart and verified authenticated internal
health HTTP 200, status ready, preserving the existing volume. Restoration is
not deployment of the correction below. No production Platform or scanner
release, topology migration, provider test, regeneration or notification send
is part of this repair.

## Source and scope

Assigned checkout: `/home/traderlink/projects/watchlist-timestamp-repair`.
Branch: `codex/watchlist-timestamp-repair-20261103`.
Parent: `c2892b45e4e3f2003ef1118a9ab93a558b83eed2`.
The Coordinator verified all four inspected runtime files against the running
container's source hashes before assigning this checkout. No other workspace
or unfinished scanner changes are included. The worker has not mutated Git.

Changed-file allowlist:

- `src/lib/technical-context/technical-context.ts`
- `src/lib/monitoring/eodhd-live-price-provider.ts`
- `src/tests/watchlist-timestamp-isolation.test.ts`
- `docs/watchlist-timestamp-recovery-20261103.md`

## Correction

The observed stack was `utcDate` / `Date.toISOString` during a technical-context
rebuild invoked by an EODHD price callback. Logs did not retain the offending
value, so synthetic regressions cover the recorded failure class rather than
claiming an exact captured-input replay.

The context builder filters invalid, noninteger or unrepresentable candle
timestamps before sorting/date conversion. Valid history remains usable and
an internal diagnostic records omitted timestamps. An entirely invalid series
produces unavailable context rather than a fabricated timestamp or indicator.

The EODHD boundary rejects malformed frames and unusable timestamps instead of
replacing them with receipt time. Existing valid numeric/numeric-string epoch
millisecond timestamps retain their values; there is no guessed unit conversion.
Each consumer dispatch contains synchronous exceptions and rejected promises,
including coalesced timer dispatches, so one failure does not terminate the
runtime or prevent another symbol/later valid update. Safe generic error logs
are rate-limited to one per minute; raw payload/error text is not logged.
Watchlist data, publication, AI, settings and notification rules are unchanged.
No user-facing feature or Help guide change is required.

## Verification

Bounded unit `watchlist-timestamp-qa-20261103` passed 31 tests: six new synthetic
timestamp/isolation cases, eleven existing EODHD provider/factory tests and
fourteen existing WatchlistMonitor tests. Focused strict TypeScript retained all
dependency diagnostics: 208 files, zero diagnostics. `git diff --check` passed.
The unit completed in 4.579 seconds with a 1GiB cap, CPU1, swap0 and 90-second
limit; its original cgroup was absent, MainPID zero, terminal inactive/dead,
and matching own common lock released. No dependencies were installed/copied.
The existing isolated TypeScript/tsx toolchain was used; external test-only
dependency resolutions came from that same dependency tree.

The runtime remains on its previous code until the Coordinator completes an
explicitly authorized release. Real bad-feed replay, post-release health and
owner Admin browser verification remain pending. Preserve original runtime
data and do not restart repeatedly as a substitute for this correction.
