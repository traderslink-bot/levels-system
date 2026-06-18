# May 11-12 Activation Audit 2026-05-12

Purpose: audit the tickers activated on May 11 and May 12, then catch previous unaudited live-session dates after the last focused regression pass.

Audit standard: Discord should give traders the next practical support/resistance map before price exhausts the last visible level. Silence is only acceptable when saved candles and runtime evidence support it.

## Commands Run

```powershell
npm run audit:story-quality -- artifacts\long-run\<session> --warehouse data\candles
npm run audit:missed-moves -- artifacts\long-run\<session> --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\<session> --warehouse data\candles
npm run audit:session-behavior -- artifacts\long-run\<session> --warehouse data\candles
```

Sessions audited:

- `2026-05-08_06-58-18`
- `2026-05-08_14-54-55`
- `2026-05-08_16-34-38`
- `2026-05-10_18-29-57`
- `2026-05-10_18-35-02`
- `2026-05-11_09-19-29`
- `2026-05-11_11-14-36`
- `2026-05-12_08-58-04`
- `2026-05-12_09-59-54`

## Activated Symbols

### 2026-05-11

- `2026-05-11_09-19-29`: `DGXX`, `DXYZ`, `FLNC`, `GLE`, `GSIT`, `HPAI`, `JZXN`, `LZXN`, `MEHA`, `MRAM`, `MX`, `POET`, `PPSI`, `TRAW`, `WOK`, `WYFI`
- `2026-05-11_11-14-36`: `DGXX`, `DXYZ`, `GLE`, `HPAI`, `MEHA`, `MX`, `TRAW`

### 2026-05-12

- `2026-05-12_08-58-04`: `AIIO`, `BZFD`, `CNCK`, `CREG`, `DXF`, `HTCO`, `KOPN`, `QUBT`, `RPGL`, `TDIC`, `TE`
- `2026-05-12_09-59-54`: `AEHL`, `AIIO`, `ALP`, `BZFD`, `ERNA`, `QUBT`, `USBC`

## Session Summary

| Session | Verdict | Symbols | Posts | Story risks | Ladder findings | Major ladder | Missed moves | Major missed | Runtime silence |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `2026-05-08_06-58-18` | `needs_review` | 20 | 274 | 12 | 0 | 0 | 51 | 15 | 10 |
| `2026-05-08_14-54-55` | `watch` | 8 | 40 | 2 | 0 | 0 | 0 | 0 | 0 |
| `2026-05-08_16-34-38` | `needs_review` | 3 | 16 | 1 | 1 | 1 | 15 | 5 | 2 |
| `2026-05-10_18-29-57` | `clean` | 4 | 4 | 0 | 0 | 0 | 19 | 4 | 2 |
| `2026-05-10_18-35-02` | `clean` | 4 | 4 | 0 | 0 | 0 | 21 | 5 | 3 |
| `2026-05-11_09-19-29` | `needs_review` | 15 | 107 | 2 | 3 | 2 | 71 | 27 | 5 |
| `2026-05-11_11-14-36` | `clean` | 7 | 16 | 0 | 0 | 0 | 0 | 0 | 0 |
| `2026-05-12_08-58-04` | `needs_review` | 11 | 74 | 4 | 2 | 1 | 121 | 48 | 11 |
| `2026-05-12_09-59-54` | `watch` | 7 | 32 | 0 | 1 | 0 | 0 | 0 | 0 |

## May 11 Findings

### `2026-05-11_09-19-29`

Verdict: `needs_review`.

Action queue:

- `GSIT`: watch. Trader-facing posts had no why-posted evidence.
- `JZXN`: watch. One late delivery post.
- `MEHA`: major. Moderate support `0.1372` was omitted as wrong-side while only `0.4%` from price.
- `MEHA`: major. Moderate resistance `0.1422` was omitted as wrong-side while only `1.2%` from price.
- `POET`: watch. Resistance ladder may hide a practical `16.07-16.51` zone inside the posted `15.50 -> 17.37` gap.

Missed-move review:

- 129 meaningful move candidates.
- 71 missed candidates.
- 27 major missed candidates.
- Main review symbols: `JZXN`, `MEHA`, `MRAM`, `HPAI`, `WOK`.

Decision:

- `MEHA` is a role-flip / near-wrong-side level problem. Near levels should usually flip into reclaim resistance or hold support context instead of disappearing.
- `POET` is a forward ladder quality problem. The ladder made the path from `15.50` to `17.37` look cleaner than candle history suggests.
- The missed-move count is high, but why-no-post proof marks 5 symbols as runtime/feed silence and 1 as missing candles, so do not tune post policy from this session alone.

### `2026-05-11_11-14-36`

Verdict: `clean`.

- 7 symbols.
- 16 posts.
- 0 story risks.
- 0 ladder findings.
- 0 missed candidates.

Decision:

- No immediate story or ladder fix required from this session.

## May 12 Findings

### `2026-05-12_08-58-04`

Verdict: `needs_review`.

Action queue:

- `CNCK`: major. Post budget over target at `12/8` in low-volume chop.
- `HTCO`: major. Post budget over target at `13/8` in low-volume chop.
- `TDIC`: watch. Two one-minute burst buckets.
- `RPGL`: watch. Post budget near limit at `10/8`.
- `HTCO`: major. Strong support `9.17` was omitted as wrong-side while only `0.9%` from price.
- `AIIO`: watch. Resistance ladder may hide a practical `1.42-1.50` zone inside the posted `1.40 -> 1.66` gap.

Missed-move review:

- 140 meaningful move candidates.
- 121 missed candidates.
- 48 major missed candidates.
- Every symbol was marked `unproven_runtime_silence` in why-no-post proof.
- Main review symbols: `TDIC`, `DXF`, `CREG`, `RPGL`, `CNCK`, `HTCO`, `BZFD`, `AIIO`.

Important examples:

- `TDIC`: +60.2% 5m upside break at `2026-05-12T09:10:00.000Z`, then +15.8% at `09:15`; no nearby saved posts in the review window.
- `HTCO`: +23.1% upside break at `08:00`, +8.4% at `08:20`, +16.9% at `09:50`; no nearby saved posts for the major examples.
- `DXF`: wide 5m ranges up to +49.7%; no nearby saved posts for the major examples.
- `CREG`: -64.9% move at `08:00`, then +47.7% at `10:40`; missing/weak coverage in the saved post timeline.

Decision:

- This session proves operational/runtime coverage was not reliable enough to claim the system followed every move.
- It does not prove that quiet-post policy suppressed the moves, because why-no-post found `0` policy-suppressed candidates and `11` runtime/feed-silence symbols.
- `HTCO` and `AIIO` still give direct ladder-quality evidence: the map omitted a near wrong-side level and hid a practical forward zone.

### `2026-05-12_09-59-54`

Verdict: `watch`.

Action queue:

- `AIIO`: watch. Resistance ladder may hide a practical `1.57-1.63` zone inside the posted `1.49 -> 1.66` gap.

Missed-move review:

- 7 candidates.
- 0 missed.
- 0 major.
- 0 runtime silence.

Decision:

- Story behavior is acceptable in this session.
- `AIIO` repeats as a forward-ladder quality watch case across both May 12 sessions.

## Product Judgment

The operator concern is valid.

The system should not wait until price has already reached or cleared the last posted resistance before giving the next practical resistance area. The current code already has mechanisms meant to do this:

- initial snapshots include extension resistance in the display ladder;
- `maybeRefreshLevelSnapshot` is supposed to fire near the second-last displayed resistance, not only after the last one;
- fast level-clear posts try to name the next resistance above;
- the level extension engine can synthesize continuation levels when historical resistance inventory is exhausted.

The audit shows the remaining gap is not the idea; it is execution quality in two places:

1. Hidden forward ladder zones: `POET` and `AIIO` show practical candle-backed zones inside wide posted resistance gaps.
2. Near wrong-side role flips: `MEHA` and `HTCO` show nearby support/resistance disappearing because it was technically on the other side of price, even though traders would still care about it as reclaim/hold context.

## Decisions

- `fix_story_logic`: `MEHA` and `HTCO` near wrong-side omissions should stay in the regression queue until role-flip display is proven clean in live output.
- `fix_watchlist_candidate`: `AIIO` and `POET` should drive the next narrow ladder-gap fixture work.
- `data_limited`: May 12 early missed-move counts are operationally concerning, but code tuning should not be based on them alone because the proof path says runtime/feed silence.
- `watch_story`: `CNCK`, `HTCO`, `TDIC`, and `RPGL` should be rerun after any low-volume/chop post cadence changes.

## Follow-Up Queue

1. Add focused fixtures for `AIIO` hidden resistance zones:
   - `1.42-1.50` inside `1.40 -> 1.66`.
   - `1.57-1.63` inside `1.49 -> 1.66`.
2. Add a focused fixture for `POET` hidden resistance zone:
   - `16.07-16.51` inside `15.50 -> 17.37`.
3. Keep `MEHA 0.1372/0.1422` and `HTCO 9.17` as near wrong-side role-flip regression cases.
4. Investigate May 12 early runtime/feed silence separately from Discord post policy:
   - why all 11 symbols were `unproven_runtime_silence`;
   - why saved runtime diagnostics did not line up with large 5m moves;
   - whether activation timing, stale warehouse coverage, or live feed gaps caused the missing evidence.
5. Rerun story-quality plus why-no-post proof after the next live run, with special attention to `AIIO`, `HTCO`, `TDIC`, `CNCK`, `RPGL`, and any ticker that clears the last visible resistance.
