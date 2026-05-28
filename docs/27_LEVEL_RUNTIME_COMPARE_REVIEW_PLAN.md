# Level Runtime Compare Review Plan

## Purpose

Compare mode is now wired into the runtime, but raw compare logs are only useful if we can review them in aggregate.

This phase adds a lightweight review workflow that turns repeated compare-mode events into:

- disagreement counts
- recurring symbol patterns
- broken-level recurrence signals
- approximation-related recurrence signals
- a practical manual review queue

## Why this is needed now

The runtime is ready for controlled experimentation with:

- `LEVEL_RUNTIME_MODE=compare`
- one active path
- one observational alternate path
- compact JSON difference logs

The next question is not architecture.

The next question is whether repeated runtime evidence shows:

- the new surfaced adapter is changing trader-facing output in sensible ways
- broken-level edge cases are still the main recurring weakness
- adapter approximations are rare and acceptable
- or more calibration is still needed

## Expected input

The review tool expects compare-mode JSON payloads from runtime logging.

It supports:

- single JSON objects
- JSON arrays
- newline-delimited JSON logs
- files or whole directories of log files

It is tolerant of mixed logs:

- non-compare lines are ignored
- malformed compare entries are tracked and reported

## What the review summarizes

At minimum it reports:

- total compare events
- valid events
- malformed or skipped compare events
- top-support change frequency
- top-resistance change frequency
- both-change frequency
- ladder-count change frequency
- recurring disagreement categories
- recurring symbol-level patterns
- broken-level recurrence
- approximation-related recurrence

## Manual review queue logic

The queue prioritizes symbols where one or more of these show up repeatedly:

- both support and resistance change often
- broken-level handling differences recur
- adapter approximation mentions recur
- surfaced ladder count changes recur
- disagreement frequency is high enough that chart inspection is warranted

Each queue item also gets an assessment:

- `likely_improvement`
- `likely_regression`
- `ambiguous`
- `needs_human_inspection`

## How to use it

Run compare mode during controlled runtime sessions, save the logs, then run:

```bash
npx tsx src/scripts/run-level-runtime-compare-review.ts <log-file-or-directory>
```

Optional flags:

- `--max-review <n>`
- `--out-json <path>`

## Why this helps migration decisions

This review layer helps answer whether the next step should be:

- more compare-mode experimentation
- another narrow calibration pass
- or eventual broader optional-flag experimentation

It does that by making the repeated runtime disagreements visible instead of treating every compare event as an isolated one-off.
