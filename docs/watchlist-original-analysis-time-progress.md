# Original analysis time in update posts

Owner-approved scope, Oct 20, 2026, amended before release: replace
`Originally analyzed at $…` with `Originally analyzed: 9:25 AM.` Leave the
remainder unchanged. Owner explicitly requests no date and no ET label.

Implementation: `src/lib/ai/watchlist-analysis-update-context.ts` adds optional
`firstAnalysisAt` to the frozen update context. It comes from `generatedAt` in
the first website-acknowledged analysis approval in the current listing cycle,
not the listing-only event, approval time, current quote or latest refresh.
Older contexts can recover that time from their existing review history.
Missing timestamps are never invented. Format is 12-hour time without date,
timezone label or seconds; Eastern daylight/standard time is handled by Intl.
The current-price/percentage suffix and all other message copy remain unchanged.
Existing already-sent or frozen Discord chunks are not rewritten.

Verification: 6 new regression tests in
`src/tests/watchlist-analysis-update-time.test.ts` passed, plus the 3 existing
publication-preview tests. Tests cover original-vs-latest generation time,
listing-only approvals, frozen-context compatibility, invalid/missing time,
Eastern winter/summer conversion and unchanged message remainder/tags/attribution.
`git diff --check` passed. Pure update-context TypeScript semantic check passed.
No real Discord posts, provider requests, settings or live analyses changed.

Release handoff: only this document, the context module and the new test belong
to this change. Other pending owner-row and earlier heading changes must not be
bundled without separate owner authorization. Coordinator owns Git and release.
Hosted deployment verification is pending Coordinator callback.
