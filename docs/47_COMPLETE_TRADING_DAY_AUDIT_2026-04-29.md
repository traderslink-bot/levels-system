# Complete Trading Day Audit - 2026-04-29

## Scope

This is the full post-session audit for the April 29 trading day.

Reviewed:

- combined Discord delivery audit: `artifacts/2026-04-29-combined-discord-delivery-audit.jsonl`
- generated report pack:
  - `artifacts/thread-post-policy-report.md`
  - `artifacts/snapshot-audit-report.md`
  - `artifacts/runner-story-report.md`
  - `artifacts/live-post-profile-comparison.md`
  - `artifacts/live-post-replay-simulation.md`
  - `artifacts/long-run-tuning-suggestions.md`
- all April 29 session summaries under `artifacts/long-run/2026-04-29_*`
- final replay level-quality reports for every active ticker
- saved Discord post bodies for trader-facing wording, source-label leakage, direct-advice language, burst patterns, and repeated stories

Symbols reviewed:

`ABTS`, `ATER`, `BIYA`, `DRCT`, `KIDZ`, `OSRH`, `SAGT`, `SEGG`, `SKYQ`, `SLGB`, `VSME`, `XTLB`

## Top-Line Findings

- Combined audit rows: `394`
- Posted Discord rows: `393`
- Failed Discord rows: `1`
- Biggest remaining production risk: post bursts on runner symbols, especially when price crosses multiple nearby levels or when follow-through posts repeat the same story.
- Level-quality status after the latest level-surfacing fixes: healthy for every audited ticker except `KIDZ` support, where the cached candles only support a thin forward ladder.
- Trader-language status: many saved April 29 posts still contain old wording because they were sent before the latest wording cleanup. Current source/tests should be verified on the next live run.
- Delivery status: one transient Discord `503` failure on a `SEGG breakdown` post.

## Post-Policy Replay

The profile replay shows the current quieter policy would have reduced the saved April 29 output without hiding support/resistance levels.

| Profile | Original | Simulated | Suppressed | Reduction | Max 5m | Max 10m |
|---|---:|---:|---:|---:|---:|---:|
| quiet | 387 | 318 | 69 | 17.8% | 5 | 7 |
| balanced | 387 | 338 | 49 | 12.7% | 5 | 7 |
| active | 387 | 351 | 36 | 9.3% | 7 | 8 |

Interpretation:

- `balanced` is still the right default to test live.
- `quiet` is available if live runner days still feel too noisy.
- `active` can restore more posting if the system becomes too quiet later.

## Per-Ticker Audit

Price paths below are reconstructed from prices that were parseable in saved Discord audit rows. They are useful for thread review, but they are not a full exchange tape or a substitute for tick-by-tick market data.

| Symbol | Posts | Failed | Price path in saved posts | Main post kinds | Burst max | Missing-event candidates | Noisy samples | Level quality | Action |
|---|---:|---:|---|---|---|---:|---:|---|---|
| ABTS | 15 | 0 | 1.50 -> 1.48, range 1.46-1.57 | context, snapshots, clear updates, follow-through, alert, recaps | 5 in 5m / 6 in 10m | 2 | 0 | healthy support and resistance; nearest support 1.52, nearest resistance 1.66 | Verify new wording after restart; old saved posts predate latest cleanup. |
| ATER | 46 | 0 | 1.08 -> 1.07, range 1.01-1.09 | alerts, snapshots, clear updates, follow-through, AI, recaps | 6 in 5m / 6 in 10m | 11 | 3 | healthy support and resistance; nearest support 0.9901, nearest resistance 1.0199 | Verify the new burst policy live on another runner day. |
| BIYA | 34 | 0 | 1.46 -> 1.85, range 1.46-1.96 | alerts, follow-through, snapshots, clear updates, AI, recap | 8 in 5m / 10 in 10m | 9 | 3 | healthy support and resistance; nearest support 1.86, nearest resistance 2.08 | Verify burst policy and follow-through wording live. |
| DRCT | 1 | 0 | 2.76 -> 2.76 | snapshot | 1 in 5m / 1 in 10m | 0 | 0 | healthy support and resistance; nearest support 2.7368, nearest resistance 2.84 | No action beyond verifying current wording after restart. |
| KIDZ | 50 | 0 | 0.9564 -> 0.89, range 0.89-0.9889 | snapshots, alerts, follow-through, clear updates, recap, extension | 6 in 5m / 8 in 10m | 15 | 7 | support warning: thin forward ladder; resistance healthy | Do not force levels. Recheck with future provider data; tighten repeated follow-through if still noisy live. |
| OSRH | 7 | 0 | 0.6116 -> 0.64 | context, snapshot, alerts, clear update, follow-through | 7 in 5m / 7 in 10m | 0 | 0 | healthy support and resistance; nearest support 0.645, nearest resistance 0.65 | Small sample but bursty activation sequence; verify live. |
| SAGT | 60 | 0 | 2.50 -> 2.00, range 2.00-2.90 | context, snapshots, alerts, clear updates, follow-through, AI, recaps | 6 in 5m / 7 in 10m | 14 | 6 | healthy support and resistance; nearest support 2.00, nearest resistance 2.05 | Verify cooldown and same-story AI gating live. |
| SEGG | 55 | 1 | 1.43 -> 1.16, range 1.15-1.52 | snapshots, alerts, clear updates, follow-through, AI, recaps | 8 in 5m / 8 in 10m | 11 | 4 | healthy support and resistance; nearest support 1.15, nearest resistance 1.18 | Add or verify retry behavior for trader-critical Discord send failures. |
| SKYQ | 53 | 0 | 6.28 -> 6.30, range 6.11-7.09 | snapshots, clear updates, alerts, follow-through, AI, recap | 5 in 5m / 7 in 10m | 11 | 4 | healthy support and resistance; nearest support 6.18, nearest resistance 6.4776 | Review cluster-cross and missed-event handling on fast level tests. |
| SLGB | 8 | 0 | 0.75 -> 0.7372, range 0.64-0.75 | context, snapshot, clear updates, alert, follow-through | 3 in 5m / 5 in 10m | 3 | 0 | healthy support and resistance; nearest support 0.7227, nearest resistance 0.75 | Verify current stock-context opener; saved old output included a bad zero shares line. |
| VSME | 10 | 0 | 1.19 -> 1.20, range 1.15-1.20 | context, snapshots, alerts, clear update, AI, recap | 3 in 5m / 4 in 10m | 1 | 0 | healthy support and resistance; nearest support 1.3227, nearest resistance 1.39 | Verify latest clean opener and "levels" heading after restart. |
| XTLB | 54 | 0 | 3.27 -> 3.38, range 3.27-4.16 | context, snapshots, clear updates, alerts, follow-through, AI, recaps | 9 in 5m / 10 in 10m | 19 | 2 | healthy support and resistance; nearest support 3.28, nearest resistance 3.34 | Review missed-event candidates and cluster-cross behavior; this is the best ticker to use for next replay tuning. |

## Runtime And Activation Audit

| Session | Active | Posts | Failed posts | Lifecycle failures | Symbols | Notes |
|---|---:|---:|---:|---|---|---|
| 2026-04-29_07-49-03 | 7 | 64 | 0 | restore 2, seed 3 | SKYQ, MNDR, SAGT, KIDZ, SEGG, BIYA, DRCT, XTLB, ATER | Runtime failure recorded. |
| 2026-04-29_09-19-38 | 0 | 0 | 0 | none | none | Clean empty session. |
| 2026-04-29_10-02-23 | 7 | 72 | 1 | IBKR 8 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Discord failure; runtime failure; no `endedAt`. |
| 2026-04-29_11-14-59 | 7 | 68 | 0 | IBKR 4 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure recorded. |
| 2026-04-29_12-03-34 | 7 | 18 | 0 | IBKR 2 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure recorded. |
| 2026-04-29_12-20-45 | 7 | 27 | 0 | IBKR 2 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure recorded. |
| 2026-04-29_12-55-03 | 7 | 13 | 0 | IBKR 4 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure recorded. |
| 2026-04-29_13-01-10 | 7 | 18 | 0 | IBKR 2 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure recorded. |
| 2026-04-29_15-16-45 | 7 | 95 | 0 | IBKR 2 | SKYQ, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure; no `endedAt`. |
| 2026-04-29_17-18-46 | 4 | 15 | 0 | seed 1 | SKYQ, ABTS, XTLB, KIDZ, SEGG, BIYA, SAGT, ATER | Runtime failure recorded. |
| 2026-04-29_17-26-49 | 0 | 13 | 0 | none | XTLB, OSRH, SKYQ, SEGG, ABTS | Clean close. |
| 2026-04-29_17-38-25 | 2 | 9 | 0 | none | VSME, ABTS | Clean close. |
| 2026-04-29_17-55-44 | 3 | 8 | 0 | none | SLGB, VSME, ABTS | No `endedAt`. |

Interpretation:

- IBKR instability is still visible in several sessions and should be treated as provider/session noise while IBKR is temporary.
- The audit did not find a current visible active-list mismatch in the saved summaries, but the playbook now explicitly requires checking this on future runs.
- Sessions with missing `endedAt` should continue to be watched because they can hide shutdown/cleanup problems.

## Discord Delivery Failure

Only one failed Discord send was found:

- Symbol: `SEGG`
- Post: `SEGG breakdown`
- Operation: `post_alert`
- Error: Discord API `503`, upstream reset before response headers

Interpretation:

- This looks like a transient Discord transport failure, not a message-format bug.
- Because the failed post was trader-critical, the system should either already retry these sends or gain a focused retry path for critical alerts.

## Level Quality Review

Final cached candle replay reports showed healthy forward support and resistance ladders for:

`ABTS`, `ATER`, `BIYA`, `DRCT`, `OSRH`, `SAGT`, `SEGG`, `SKYQ`, `SLGB`, `VSME`, `XTLB`

Remaining warning:

- `KIDZ` support: `thin_forward_ladder`
- This should not be patched by forcing artificial support. Recheck it when the new data provider is available.

Important level-audit conclusion:

- The earlier ABTS/SKYQ/XTLB-style gaps are exactly the right things to audit, but the latest gapfill reports now show healthy forward ladders across the audited symbols.
- The next risk is less about missing static levels and more about how fast level crosses are narrated when several nearby levels are involved.

Specific ABTS check:

- The saved ABTS snapshots did not jump straight from `1.83` to `2.31` as the next immediate levels while price was near `1.50` to `1.57`.
- The saved ladder showed intermediate resistance at `1.65`, `1.74`, `1.78`, and `1.83` before `2.31`.
- That means ABTS does not currently look like a missed-intermediate-resistance bug in the final saved output.

## Trader-Facing Language Review

Saved April 29 posts still contain old wording such as:

- `LEVEL SNAPSHOT`
- `Status:`
- `Signal:`
- `Decision area`
- `alert direction`
- `after the alert`
- `setup update`
- `Next levels`
- `moving toward`
- source labels such as `Yahoo` / `Finnhub`

Interpretation:

- These posts were saved before the later wording cleanup work.
- Current source and tests should be considered the authority now, but the next live run must confirm the actual Discord runtime is using the latest code.

No direct-advice pattern was found as a current code requirement from this audit. Continue enforcing:

- no `Longs should...`
- no `Traders should...`
- no `best entry`
- no `can buy`
- no `should trim`
- no `should exit`

## Stock-Context Opener Review

Saved old openers showed:

- `Yahoo context`
- `Current price (Yahoo): n/a`
- regular/premarket/postmarket rows with unavailable values
- `Shares outstanding: 0.00K`

Current formatter work should already omit unavailable values and remove source labels from trader-facing posts. This still needs a next-live-run confirmation because saved April 29 output includes posts from before those cleanup changes.

## Follow-Through And Trader Story Review

The biggest story-quality problems were:

- follow-through posts that still sounded system-shaped in old saved output
- repeated "working/stalling/failed" style posts that did not always add enough fresh trader context
- same-story repeats on `KIDZ`, `SAGT`, and runner tickers
- fast moves where a crossed cluster could produce too many separate posts or miss the cleaner story

What should be tested next:

- one cluster-cross message instead of several single-level clear/lost posts when levels are close together
- stronger material-change checks before follow-through posts
- trader-readable follow-through phrasing centered on what is holding, reclaiming, clearing, or failing

## Action Items

1. Verify the next live run uses current trader-only wording in actual Discord posts.
2. Verify `balanced` profile output on live runners before switching to `quiet`.
3. Add or confirm retry behavior for failed trader-critical Discord posts, using the `SEGG` failure as the regression case.
4. Review cluster-cross handling for `XTLB`, `SKYQ`, `SAGT`, and `KIDZ`.
5. Keep `KIDZ` as a data-quality watch item instead of forcing unsupported levels.
6. Use `XTLB` as the main replay ticker for testing future cluster-cross and follow-through changes.
7. After provider switch, rerun this exact audit playbook and compare the same symbols when possible.

## Audit Conclusion

No new urgent code defect was found in the final cached level-quality reports.

The most useful next engineering work is not another level-ranker change right now. It is:

- live verification that the latest trader-language cleanup is actually running
- critical Discord-send retry hardening
- cluster-cross narration
- follow-through accuracy and material-change gating
- provider-comparison replay once IBKR is replaced
