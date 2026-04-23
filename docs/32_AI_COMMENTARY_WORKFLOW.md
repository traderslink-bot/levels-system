# AI Commentary Workflow

## Purpose

This document explains the first safe AI layer in the project.

The goal is to use AI to:

- explain deterministic signal facts in plainer English
- improve recap readability during long sessions
- summarize a finished long-run session

The goal is not to let AI replace:

- market-data retrieval
- level generation
- event detection
- execution decisions

## Current Scope

The current AI layer is intentionally narrow.

It can:

- enhance in-session symbol recap text when the manual runtime is running
- explain structured signal facts in a stricter plain-English layer when called downstream of deterministic summaries
- generate a post-run `session-ai-review.md` from deterministic session artifacts
- generate post-run `thread-ai-recaps.md` per active symbol from deterministic thread summaries
- generate an AI noisy-family review inside the session AI report

It does not:

- decide whether an alert should fire
- decide whether a trade should be taken
- override deterministic severity, confidence, or suppression rules

## Runtime AI Recaps

To enable AI recap enhancement during a manual runtime session, set:

```powershell
$env:LEVEL_AI_COMMENTARY='1'
$env:OPENAI_API_KEY='...'
```

Optional model override:

```powershell
$env:LEVEL_AI_MODEL='gpt-5-mini'
```

Then start the runtime normally:

```powershell
npm run watchlist:manual
```

When enabled successfully:

- the runtime keeps deterministic recap logic as the source of truth
- AI may enhance recap wording for eligible symbol recaps
- if AI fails, the runtime falls back to deterministic recap text

## Post-Run AI Session Summary

After a long-run session finishes, you can generate an AI summary from the session artifacts:

```powershell
npm run longrun:ai:summary -- .\artifacts\long-run\<timestamp>
```

This reads the deterministic artifacts such as:

- `session-summary.json`
- `thread-summaries.json`
- `thread-clutter-report.json` when present

And writes:

- `session-ai-review.md`
- `thread-ai-recaps.md`

## Safety Rules

The AI layer should stay downstream of the deterministic engine.

That means:

- deterministic monitoring events remain the source of truth
- deterministic alert scoring remains the source of truth
- deterministic runtime and delivery artifacts remain reviewable even when AI is enabled
- AI output should summarize, clarify, and explain, not invent new unsupported facts
- AI should stay primarily in operator-review and recap territory, not as a default source of extra live thread narration

## Wording Direction

The current AI prompts are written to stay close to trader-useful language.

In particular:

- prefer plain-English movement and level language
- avoid abstract words like `participation`
- prefer concrete terms like `volume`, `activity`, `support`, `resistance`, `breakout`, `stalling`, and `failure risk`

## When To Use AI Output

AI output is most useful when:

- the thread already has enough deterministic context
- a symbol has been active for a while and needs a concise recap
- a long-run session produced enough activity that a human-readable wrap-up would save time

AI output is less useful when:

- there is very little deterministic evidence yet
- the runtime is failing operationally and raw logs are still needed
- a precise operational failure needs debugging

## Recommended Review Order

When reviewing a long-run session:

1. check `session-summary.json`
2. check `thread-summaries.json`
3. check `session-review.md`
4. optionally generate and review `session-ai-review.md`
5. optionally review `thread-ai-recaps.md`
6. fall back to `manual-watchlist-operational.log` or `manual-watchlist-diagnostics.log` only when the summaries are not enough

## Follow-Up Ideas

The safest next AI expansions are:

- better in-session recap enhancement
- better post-run session summaries
- better per-symbol AI recaps that stay tightly grounded in deterministic thread summaries
- AI-assisted review of noisy symbols and noisy alert families

Ideas that should wait:

- top-alert AI commentary before the deterministic thresholds settle more
- any AI-driven execution logic
- any AI replacement for structured monitoring and scoring
