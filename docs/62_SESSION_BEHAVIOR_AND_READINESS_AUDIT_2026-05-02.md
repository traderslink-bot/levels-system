# Session Behavior And Readiness Audit

This file documents the operator-only audit that ties together the next batch of closed-market review ideas:

- candle-cache freshness by symbol and timeframe
- provider/candle readiness before trusting a symbol audit
- first support/resistance post trade-map scoring
- thread balance: too noisy, possibly too quiet, balanced, mixed, or data-unproven
- candle-synced timeline samples
- current-session behavior profile, not permanent ticker "personality"
- runtime/version markers in saved Discord audit rows
- operator-only recap preview for each reviewed symbol

## Command

```powershell
npm run audit:session-behavior -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

For a combined day-level audit file:

```powershell
npm run audit:session-behavior -- artifacts\2026-05-01-combined-discord-delivery-audit.jsonl
```

Outputs:

- `session-behavior-audit.json`
- `session-behavior-audit.md`

## Why It Matters

The app now has many ways to reduce Discord noise. This report checks the full operator picture before making another posting-rule change:

- Was candle evidence fresh enough to judge the session?
- Did the first post give a useful trader map?
- Was the thread too noisy, or did the missed-move audit suggest it may have been too quiet?
- Was the ticker in range chop, clean runner behavior, volatile runner behavior, failed runner behavior, or mixed evidence?
- Did the posts come from the current runtime or an older app instance?
- Is candle evidence fresh enough to trust a quiet/noisy conclusion?

## Session Behavior Profile

This is deliberately **not** a permanent ticker personality. Small caps can behave differently every day.

The report uses current-session candle/post evidence to label the session as:

- `range_chop`
- `clean_runner`
- `volatile_runner`
- `thin_low_activity`
- `failed_runner`
- `accumulating_under_resistance`
- `mixed_unknown`

These labels are for audit and post-budget review. They should not override support/resistance levels or invent a trade idea.

## Runtime Marker

New Discord audit rows include:

- `runtimeVersion`
- `runtimeStartedAt`
- `runtimePid`

This helps future audits separate:

- old saved posts
- posts from a prior app restart
- posts produced by the current runtime code

Older saved rows will show missing runtime markers. That is expected historical evidence, not a live failure.

## Acceptance Standard

Before tightening live post policy again, review this report with:

- `missed-meaningful-move-audit.md`
- `daily-trader-review.md`
- `trader-usefulness-replay-score.md`
- `trader-post-quality-report.md`

A good change should reduce noisy/repeated threads without increasing `possibly_too_quiet`, `mixed_review`, or `data_unproven` findings.

## Quiet-Verdict Calibration

The audit now gates quiet-thread conclusions by candle readiness:

- `possibly_too_quiet` requires fresh/ready candle evidence.
- stale, partial, or blocked candle evidence with missed-move candidates becomes `mixed_review`.
- stale, partial, or blocked candle evidence without missed-move evidence remains `data_unproven`.

This prevents the operator from tuning the live post policy from stale cache evidence.

## Operator Recap Preview

Each reviewed symbol now includes a short operator-only recap preview. It summarizes:

- behavior profile
- post count versus expected budget
- candle readiness
- first-post quality
- missed-move and repeated-story signals
- reviewed candle range and max 5m move when available

This preview is not Discord trader text. It is meant to let the operator review a thread quickly after a session without reading every saved post.
