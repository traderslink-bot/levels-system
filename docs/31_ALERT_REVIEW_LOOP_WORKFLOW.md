# Alert Review Loop Workflow

## Purpose

This document explains how to add human review feedback after a long-run session so the project can learn from:

- useful alerts
- noisy alerts
- late alerts
- wrong alerts
- especially strong alerts

The goal is to turn long-run testing into a real signal-quality feedback loop instead of only a logging exercise.

## Why This Exists

The runtime can already tell us:

- what activated
- what posted
- what got suppressed
- what Discord received

That still does not answer the most important question:

- was the alert actually useful to a trader

This review loop lets us attach human judgment to a real session so we can tune the deterministic engine with better evidence.

## Review Verdicts

Use one of these verdicts:

- `useful`
  - the alert was worth seeing and added value
- `strong`
  - the alert was especially good or timely
- `noisy`
  - the alert added clutter without enough value
- `late`
  - the alert direction may have been fine, but it arrived too late to be useful
- `wrong`
  - the alert was materially misleading or poor

## How To Record Feedback

Use:

- `scripts/add-long-run-review-feedback.ps1`

Example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\add-long-run-review-feedback.ps1 `
  -SessionDirectory .\artifacts\long-run\2026-04-22_11-43-33 `
  -Symbol AGPU `
  -Verdict useful `
  -EventType reclaim `
  -Notes "timely reclaim alert with enough room to work"
```

## What The Script Writes

The script appends a JSON line to:

- `human-review-feedback.jsonl`

inside the chosen session folder.

Each entry includes:

- timestamp
- symbol
- verdict
- optional event type
- optional notes

## How Feedback Is Used

When the long-run session is still running, the launcher will fold feedback into the live artifacts on the next runtime update.

That means these artifacts can reflect human review:

- `session-summary.json`
- `thread-summaries.json`
- `session-review.md`

The session review will then show:

- total human feedback count
- verdict counts
- symbols that were reviewed
- latest human review per symbol
- how that human review sits beside the latest evaluated follow-through instead of only the raw posted alert

## Best Practice

Use this loop sparingly and intentionally.

Good moments to record feedback:

- when an alert was clearly helpful
- when a thread became obviously noisy
- when a breakout or dip-buy alert was technically correct but too cramped to trade
- when an alert arrived too late to matter
- when a setup looked good in the logs but poor to a human trader

## What This Improves Over Time

This loop creates the evidence needed to improve:

- alert posting thresholds
- heavy/light support and resistance wording
- `firm` versus `tired` zone wording and whether that posture is acting as a tailwind or headwind for the setup
- breakout quality filters
- dip-buy usefulness
- end-of-session summaries
- future AI commentary layers

## Recommended Companion Artifacts

When reviewing or recording feedback, look at:

- `session-review.md`
- `thread-summaries.json`
- `discord-delivery-audit.jsonl`
- `manual-watchlist-operational.log`

That usually gives enough context to decide whether a thread was useful or not.
