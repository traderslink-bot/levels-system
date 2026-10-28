# Watchlist Admin ticker color

The owner requested orange ticker text on Watchlist Admin on October 28, 2026.
This is a separate follow-up to the resistance correction and row divider.
Coordinator owns Git and release; the base is Runtime commit
`6f2fe2b05532081bf7bc8c2b535addc915bc5955`.

The exact selector is
`li.watchlist-control-row > .entry-main > .entry-title > strong:first-child`.
`manual-watchlist-page.ts` creates this first strong element from `entry.symbol`.
The row-review stylesheet sets only its text color to `#EA580C`.

Four focused row tests passed, preserving Gain/Loss actions, the divider and
the narrow color rule. Offline Chromium checks at 1100 px and 390 px confirmed
orange ticker symbols and unchanged badges, buttons, other text, public ticker
text, borders, spacing and geometry. No network requests occurred. Whitespace
checks passed; no production calls, source publication or deployment occurred.

No Help guide change is required for this admin text-color-only update.
Coordinator will release the three allowlisted source, regression-test and
progress-record files after the already-running Platform follow-up.
