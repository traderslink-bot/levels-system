# Private Watchlist activation acknowledgement

Status: focused local verification passed; production handoff pending.

The owner requested correction of activation timeouts and admin request errors.
POST activate awaited queueActivation, whose review-required branch awaited
all market-data preparation and OpenAI generation before returning its 202.
The browser's 30-second acknowledgement deadline expired while the held entry
continued preparing, producing a misleading failure message.

## Correction

- Save the required-review cycle and held ticker first, as before.
- queueActivation returns that durable entry without waiting for providers.
- Preparation continues in the existing persistent runtime, with the original
  cycle/epoch checks, failure recording, and approval gate unchanged.
- activateSymbol retains its awaited completion contract.
- Duplicate additions reuse the same active held cycle; they do not buy another
  initial analysis or create a Discord thread.
- No timeout increase, automatic retry, owner approval, or publication was added.

## Verification

Six focused private-activation tests pass: both entry methods in premarket,
regular, and postmarket. The queue tests hold the seed promise unresolved,
verify immediate acknowledgement with zero AI/publication/Discord calls,
submit a duplicate and verify the same cycle, then release preparation and
verify the original review draft and existing publication controls.

The separate 8,000-token production truncation is not fixed by this change.
Nor does this establish that every HTTP 502 had the same cause: hosted endpoint
acceptance remains required after release.

Allowlist: runtime manager, its focused test file, and this document. No migration.
Help: no control or workflow change; this restores expected asynchronous add
behavior. The visible review/approval instructions remain unchanged.
