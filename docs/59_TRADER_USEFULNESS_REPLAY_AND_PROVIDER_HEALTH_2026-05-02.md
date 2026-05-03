# Trader Usefulness Replay And Provider Health

This note tracks the seven-part closed-market improvement package added on May 2, 2026. The goal is to make post-quality audits more evidence-driven and make the manual UI clearer while the market is running, without adding new Discord noise.

## What Was Added

1. Real replay usefulness scoring: `npm run audit:usefulness -- <session-folder-or-discord-delivery-audit.jsonl>` writes `trader-usefulness-replay-score.json` and `.md`.
2. Post usefulness labels: saved posts are labeled `useful_change`, `early_but_relevant`, `repeat_noise`, `late`, or `missing_context`.
3. Ticker personality detection: each symbol gets an operator-only label such as `clean_runner`, `low_volume_chop`, `wide_spread_messy`, `steady_trend`, `halt_prone_microfloat`, or `mixed_unknown`.
4. Ladder confidence: each symbol gets `strong`, `usable`, `thin`, `degraded`, or `unknown` based on saved ladder evidence and missing-level language.
5. Material-change review: the replay report marks posts as `material_change`, `same_story`, or `unclear`, and the live post policy now suppresses another class of same-practical-area repeats unless acceptance, level importance, structure, or price expansion justifies a new post.
6. UI review panel improvements: the manual page now has a `Provider Health` section separate from `Runtime Status`.
7. Provider health dashboard: runtime health now exposes price-feed age, Discord delivery status, historical seeding status, pending seed count, stuck seed count, and concise operator notes.

## Why This Matters

The existing `quality:posts`, `audit:thread-health`, and `audit:lifecycle` reports answer different questions:

- `quality:posts` checks wording safety and trader-language boundaries.
- `audit:thread-health` checks thread health, high post counts, delivery failures, and obvious repeated stories.
- `audit:lifecycle` summarizes the day-level trade story.
- `audit:usefulness` asks whether the saved posts actually helped a trader follow the ticker, or whether they repeated the same story, arrived late, lacked next-level context, or came from a thin/degraded ladder.

This gives future audits less room to be vague. A thread that "felt noisy" should now show concrete counts for repeat noise, missing context, same-story posts, and ticker personality.

## Operator Use

After a live run:

```powershell
npm run audit:usefulness -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Then review:

- `trader-usefulness-replay-score.md`
- `thread-health-score.md`
- `trader-post-quality-report.md`
- `trade-lifecycle-summary.md`
- `visual-audit-replay.html`

Use `trader-usefulness-replay-score.md` first when the complaint is "too many posts" or "the ticker did not really change."

## Acceptance Rules

- A useful post should show a real material change, accepted level behavior, important level context, a meaningful activity/structure change, or a new day-level story.
- A same-area post should stay out of Discord when it repeats the same practical zone without acceptance, major level importance, material stable/practical structure change, or enough price expansion.
- Missing next-level context should be treated as an audit finding, not buried in the thread.
- Provider health should explain stale price feed, recent Discord failure, and slow historical seeding without requiring the user to read terminal logs.

## Not Added

- No standalone Discord posts.
- No trader-facing labels like `ticker personality` or `replay score`.
- No fake support/resistance levels to make ladders look cleaner.
- No buy/sell advice or direct execution instructions.

## Follow-Up Ideas

- Add a live per-symbol "last useful post reason" panel once the runtime stores the latest audit metadata per active symbol.
- Fold `audit:usefulness` into `npm run replay:monday`.
- Add a chart-linked evidence appendix when cached candles are available for the same session.
