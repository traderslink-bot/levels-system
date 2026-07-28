# Missed Meaningful Move Audit

This file documents the operator-only audit added after the daily trader review work. Its purpose is to make the calmer Discord posting policy safer: if the app suppresses more repeated chatter, this report checks cached candles for meaningful moves that may have deserved a trader-facing update.

## Why It Exists

The app now has several tools for finding posts that are too noisy. That creates a real product risk: if we only measure overposting, we can accidentally tune the system too quiet.

`npm run audit:missed-moves -- <session-folder-or-discord-delivery-audit.jsonl>` is the opposite-side audit. It scans cached IBKR 5-minute candles and saved Discord delivery rows, then reports candle-backed move candidates that were:

- covered by a nearby alert
- weakly covered by some nearby post
- missed by saved Discord output

A candidate is not automatically a runtime bug. It is evidence that a human audit should review before tightening post policy further.

## What It Checks

The v1 audit looks for:

- upside 5-minute closes that push above a recent rolling high
- downside 5-minute closes that press below a recent rolling low
- large 5-minute candle ranges that may indicate a meaningful expansion
- nearby Discord posts within the coverage window
- whether nearby posts told the same basic story, only provided weak context, or did not exist

It intentionally ignores ordinary small-cap wiggle. One- or two-cent movement is not enough by itself; the candle has to be large relative to price or break recent structure by enough to deserve review.

## Outputs

For a session folder, the command writes:

- `missed-meaningful-move-audit.json`
- `missed-meaningful-move-audit.md`

The Markdown report includes:

- totals by covered / weak / missed candidate
- major missed candidate count
- symbols missing cached candle evidence
- symbols whose cached candles do not overlap the audited Discord window
- the largest reviewed 5-minute moves even when no candidate was flagged
- candle proof for each uncovered candidate
- nearest saved Discord post excerpts

## How To Use It

Run it after noisy-session review:

```powershell
npm run audit:missed-moves -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Then review `missed-meaningful-move-audit.md` alongside:

- `daily-trader-review.md`
- `trader-usefulness-replay-score.md`
- `trader-post-quality-report.md`
- `live-post-replay-simulation.md`
- `snapshot-audit-report.md`

If a symbol is still too noisy but has no missed meaningful moves, it is usually safer to tighten repeated-story policy. If a symbol has missed or weakly covered meaningful moves, tune more carefully and check whether suppression, level detection, or stale runtime state caused the miss.

## Current Limits

- It depends on `.validation-cache/candles/<provider>/<symbol>/5m` evidence.
- It does not fetch fresh candles.
- It does not prove a trade idea was good or bad.
- It does not replace chart review.
- It treats candidates as review evidence, not automatic defects.
- It uses saved Discord delivery rows, so posts from a different runtime version must still be separated during audit.

## Monday Checklist

`npm run replay:monday -- --skip-slow` now runs this audit for the latest saved long-run session when one exists.
