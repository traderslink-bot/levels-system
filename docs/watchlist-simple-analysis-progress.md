# Simple analysis progress

Controlling scope: [Simple analysis alternative](watchlist-simple-analysis-plan.md).

## September 14 evening checkpoint — source/testing complete; integration not accepted

Owner requested continued work toward a usable option for the next market day.
The current approved implementation boundary remains a separate prototype;
selectable live-format integration was raised explicitly for confirmation while
testing continues. Existing analysis, live settings, saved edits, publication,
Discord and the staging-named runtime placement have not been changed.

### Implemented and checked

- Full four-timeframe replay inputs for SOAR, BMGL, FTFT, NCT and ELMT, preserving
  the original midday quote, daily and same-day candles. Supplementary EODHD 4h
  data ends before the original analysis time; it is not a later-price replay.
- New VEEA and SLGB postmarket packets captured at 17:18 Eastern. VEEA uses
  Moomoo; SLGB used Yahoo after the shared Moomoo bridge was unavailable. Missing
  postmarket volume remains unavailable rather than fabricated trading activity.
- Separate nearer/deeper opportunity assessment before selecting invalidation;
  distinguish a future retest from already demonstrated buyer defense.
- Candle references must support the quoted prices, not merely name an existing
  candle. Private audit resolves both ISO and millisecond timestamp references.
- Display-only nearer-first pullback ordering; neither price area is removed.
- Four-section static preview renderer. It retains selected ranges, escapes
  model text, hides internal selection/evidence fields, and has no provider,
  publication, script or live-card dependencies.
- Fourteen focused Node checks passed. No Vitest, local server or full build.
- Source output ceiling aligned with the 16,000-token ceiling actually used by
  the paid tests. This is headroom, not a requirement to spend all those tokens.

### Revised Luna comparison

All seven requests completed on the same revised prompt. Every cited candle
reference resolves in its exact input packet; this does not prove every prose
claim or selected zone is optimal. Five reads retain two pullbacks; BMGL and SLGB
retain one. All have upside and thesis invalidation. Observed residual issues:
Luna sometimes groups broad resistance bands, skips useful intermediate areas,
or defines the thesis around the broadest base rather than the latest impulse.
Do not mark this as an unattended production-quality pass.

The generated seven-symbol static preview is private under ignored
`data/analysis-replay/`. Browser policy blocked opening its local file URL.
Do not bypass that policy or claim rendered browser acceptance. The escaped
HTML/rendering-contract tests passed; visual acceptance remains unverified.

### Terra comparison — complete

All seven completed. A structural equality assertion confirmed the entire
request was identical except the model for every Luna/Terra pair. All cited
candle references resolve, including numeric epoch references. Original reads
and source packets remain intact. This is evidence of source-reference integrity,
not proof that every interpretation is correct.

Terra produced 29,622 output tokens across seven reads versus Luna's 56,420.
It improved SLGB's intermediate upside ($0.445-$0.455, $0.478-$0.490 before the
higher areas) and was generally more concise. It was not uniformly superior:
FTFT skipped the useful mid-$5 area, BMGL selected a materially deeper thesis
failure than Luna, and NCT omitted the prospective lower setup Luna retained.
Luna remains the default prototype model; no live model was changed. Do not
introduce automatic second-model retries or claim a universal quality win.

The final seven Luna reads all contain pullbacks, upside and invalidation;
five include two pullbacks, BMGL and SLGB one. Six include evidenced upside
beyond 30%; ELMT ends at the highest supplied price ($25.03) rather than adding
the unsupported $27.50/$30 rows. Residual interpretation/grouping differences
are retained for owner review, not silently rewritten or removed.

The default source ceiling now matches the tested 16,000 tokens and has a
regression assertion. Final focused run: 14 passed, 0 failed. Diff whitespace
check passed. Git-ignore verification confirms private `data/analysis-replay/`
records are excluded; they were previously untracked but not actually ignored,
so this checkpoint adds the explicit narrow exclusion. No records were deleted.

### Cost and release boundaries

The private ledger enforces the owner's $10 daily ceiling and includes a hosted
reserve. Luna accounting still uses the older, deliberately conservative rates;
these ledger figures must not be described as exact billed charges. Raw provider
usage is retained for reconciliation. No automatic retry or duplicate request.

Final fresh hosted cost check: 22 requests, $1.7326565 estimated, one unpriced
earlier request. Private conservative test accounting is $6.024826; with the
$2 hosted reserve the guarded total is $8.024826, below $10. These are conservative
ledger estimates, not an invoice. All private requests are settled, with no
running or unaccounted dispatched request. No further paid calls this checkpoint.

No deployment has occurred. A next-day usable option still needs an explicitly
selected integration scope, captured per-read format, review/edit/approval and
Discord-preview verification, an allowlisted release through the Coordinator,
and hosted acceptance. Current-format functionality must remain available.
Help changes are not needed for this unexposed test prototype; integration must
update the Watchlist Help guide with the new format and unchanged approval flow.
