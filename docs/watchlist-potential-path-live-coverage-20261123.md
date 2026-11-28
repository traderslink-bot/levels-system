# Potential Path live coverage correction

Owner approved fixing the live-update candidate inconsistency, checking BNAI
and the original 13 audited tickers, and Coordinator deployment when ready.
The assigned isolated lane starts at serving Runtime
`ca04dcf7b6d9b254d54720887a500e63bc828d2d`.

The initial presentation can read the historical Full Ladder. Live ticker
updates currently rebuild the card using only previously displayed, canonical
and extension zones. Wider known structure can therefore disappear as price
changes. The card itself renders all selected rows; it does not truncate them.

The bounded correction adds the existing factual Full Ladder candidates to
both website support/resistance reference sets. Existing clustering, side and
role-flip confirmation, eight rows per side, normal 30% coverage and the outer
checkpoint rules remain in force. Separate fast-monitor references, scoring,
historical prices and Full Ladder formatting remain unchanged.

## Plan and progress

- Discovery: deployed source inconsistency confirmed with the Coordinator.
- Exact owner-observed BNAI snapshot: unavailable. Its pasted prices supply a
  clearly labelled controlled regression, not a reconstructed live capture.
- Regression first: actual manager quote-to-website publication path, expanding
  price context, deeper support, clustering, synthetic exclusions, empty sides,
  old-output fallback and unchanged separate monitor inventory.
- Compare before/after against all 13 captured real-input engine outputs and
  their fixed historical reference prices, then controlled moving-price cases.
  Reuse the compressed baseline without writing another raw candle dataset.
- Run the applicable publisher/manager/level-store regressions and TypeScript
  checks sequentially under the shared resource guards.
- Review Help: existing Watchlist guide already documents current-price
  selection, roughly 30% coverage, farther meaningful checkpoints and gaps.
  This restores that behavior; no Help copy or UI change is needed.
- Verified: six new workflow tests and 254 existing publisher, manager, store
  and resistance regressions pass; full TypeScript `--noEmit` passes.
- All 13 original Generator maps and Full Ladder bodies reproduce exactly.
  Across 79 real-input/controlled-quote cases, every side stays within eight
  rows; no duplicate printed prices, overlapping bands, weak rows or levels
  without historical candle contact were found. Original inputs remain exact.
- At BNAI's controlled $7.13 price, its retained real historical output now
  yields resistance at 7.14, 7.46, 7.81, 8.23, 8.474 and 9.448, compared with
  only 7.14 on the previous live-update path. The separate owner-list fixture
  also retains 8.47 and 9.45 without exposing the distant 86.28 area.
- Existing quote-reference merging remains in force. Nine of 79 live cases
  select different existing rows from a direct, unmerged pool diagnostic;
  all seven BNAI scenarios agree. This is not an exact-output parity claim
  between differently prepared Watchlist and Generator contexts.
- Initial failed regression/harness attempts remain recorded. The support-only
  fixture was isolated after existing clustering correctly combined 6.20 with
  6.32; product spacing was not weakened to satisfy that expectation.
- The [immutable qualification](watchlist-potential-path-live-coverage-20261123.json)
  pins the exact source/test patch, all 13 results, safeguards and resource
  closeout. Owned children were reaped, groups emptied and both guards released.
- Ready for Coordinator source review and deployment. Pending: integration,
  actual deployment/health evidence and safely scoped current BNAI inspection.

The original broader Generator Full Ladder consolidation proposal is separate
and remains unimplemented. No production/account save or notification is part
of this local comparison.

Current corrected-trade display and release dependencies are documented in [Current Watchlist Potential Path trade corrections](watchlist-current-potential-path-corrections.md).
