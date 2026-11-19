# Distant target context — CHSN review, November 19, 2026

## Recorded evidence

Existing authorized owner-session GETs read CHSN current review/history and exports for its two saved generations. No refresh, setting change, approval, publication, notification, provider fetch or generation was performed. Only CHSN evidence was collected; credentials and actor identity fields were omitted from temporary evidence. Evidence remains private under `/tmp/watchlist-chsn-review-20261119/`.

| Saved stage | Eastern time Nov19 | Reference | Selected upside areas |
| --- | --- | --- | --- |
| First generated simplified read | 9:20:06 AM | $0.1931 | $0.2323, $0.3079, $0.462 |
| Manually refreshed simplified read | 9:32:04 AM | $0.1451 | $0.16, $0.20, $0.462 |
| Owner edit | 9:36:11 AM | $0.1451 | Same three upside areas; pullbacks were edited |
| Approval of edited read | 9:36:39 AM | $0.1451 | Same three upside areas |

Recorded request/response/audit confirms GPT-6 Luna high. The second raw model response itself selected the three areas; the $0.462 row was not added by the outer-level supplement or changed into that value by the owner. Its explanation was: “The prior trading range around $0.46 is a substantial overhead area if momentum carries beyond the current session structure.” That does not clearly distinguish a remote chart reference from a normal next objective. $0.20 to $0.462 is a131% increase; that arithmetic is separate from gain relative to the analysis reference.

The saved second packet includes the daily/four-hour and intraday history. It contains four-hour trading around $0.46–$0.4862 and earlier five-minute rebound highs of $0.2323 and $0.3079 during the preceding regular session. Thus it is false to describe this particular jump as having no readable intermediate evidence. The original generation already recognized those two nearer reactions. No new market-data reconstruction was substituted for the saved generation inputs. The review establishes what was supplied and selected, not that every historical reaction must be a useful future target.

## Narrow correction

Simplified prompt now distinguishes a genuine historical level from a realistic immediate objective. When an area requires a materially larger extension beyond the active range/previous area, its existing row explanation must identify it as a distant historical reference or stretch area and explain the larger advance/sustained strong volume required. Keep relevant farther coverage and useful intermediate levels, not a new cap or a longer price ladder. Before claiming no intermediate area, inspect supplied intraday/four-hour/daily evidence; make that claim only when supported, and do not imply a clear path. Ordinary nearby levels do not receive blanket warnings.

The prior instruction rejecting any area whose explanation called it impractical was narrowed to reject unrelated price-regime outliers; a relevant distant reference can remain with honest context. No ticker-specific price, percentage trigger, fixed-distance rule, schema field, validator/publication restriction or target-selection postprocessor was introduced. Detailed analysis, pullbacks, breakout rules, data packet, models, effort, token limits, search tools, owner edits and approval controls are unchanged.

Example desired presentation, manually written rather than a new model result: “Distant historical reference. Reaching this area requires a much larger advance with sustained strong volume.” For a genuinely unreadable interval the model may explain that it is the next clearly readable historical area; CHSN's recorded packet does not justify that claim.

## Verification and release boundary

Exact prompt preimage is byte-identical to deployed Runtime af117 source: SHA256 `911135df8c55e2a703af491c820087d0e3a47d55f9a240d68daa205db52106e4`. Actual simple production request builder uses the changed prompt module. Existing focused simple-analysis and simple-integration tests: **17/17 PASS**, about1second, one384MiB worker; fake transports/no providers. An offline synthetic request/renderer check confirms the instruction reaches the outgoing developer message, explanations render unchanged, inputs/schema retain their shape and no CHSN prices/ticker are hard-coded. `git diff --check` passes. No build, paid AI replay or fresh model response was run; output compliance is not claimed as guaranteed by tests.

OpenAI Docs prompting guidance was consulted for explicit instructions and evaluation limits: https://developers.openai.com/api/docs/guides/prompt-engineering . The chart findings above come from the recorded CHSN evidence, not external commentary. Platform Help receives only a corresponding explanatory sentence, separately committed. No migration or Runtime settings change is required. Coordinator owns final canonical integration and release; no deployment requested by this review/change instruction.
