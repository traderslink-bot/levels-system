# Past Replay Events Audit - 2026-05-06

Purpose: audit saved historical/replay evidence after the Discord trader-story noise work. This pass checks whether current replay tooling still supports the product goal: Discord should follow the play without narrating every wiggle.

Read this with:

- `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md`
- `docs/81_AUDIT_AND_REPLAY_COVERAGE_INDEX.md`

## Commands Run

```powershell
npm run saved-data:test -- --input artifacts\long-run --all --output artifacts\past-replay-audit-2026-05-06\saved-data-regression-all
npx tsx src/scripts/run-specific-ticker-date-replay.ts --hours 5 --out-dir artifacts\past-replay-audit-2026-05-06\specific-ticker-date-replay-forward-5h
npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts\support-resistance-story-test-queue\support-resistance-story-test-cases.json --offset 0 --limit 80 --hours 5 --out artifacts\past-replay-audit-2026-05-06\support-resistance-story-replay-80
npm run audit:why-no-post -- --all-sessions --input artifacts\long-run --max-sessions 15 --warehouse data\candles --out-dir artifacts\past-replay-audit-2026-05-06\why-no-post-all-sessions-15
```

## Artifacts

- `artifacts/past-replay-audit-2026-05-06/saved-data-regression-all/saved-data-regression-report.md`
- `artifacts/past-replay-audit-2026-05-06/saved-data-regression-all/saved-data-regression-report.json`
- `artifacts/past-replay-audit-2026-05-06/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.md`
- `artifacts/past-replay-audit-2026-05-06/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.json`
- `artifacts/past-replay-audit-2026-05-06/support-resistance-story-replay-80/support-resistance-story-replay.md`
- `artifacts/past-replay-audit-2026-05-06/support-resistance-story-replay-80/support-resistance-story-replay.json`
- `artifacts/past-replay-audit-2026-05-06/why-no-post-all-sessions-15/why-no-post-replay-proof.md`
- `artifacts/past-replay-audit-2026-05-06/why-no-post-all-sessions-15/why-no-post-replay-proof.json`

## Results

### Saved Discord Regression

Coverage label: `partial`.

The all-session saved-data regression checked 97 saved Discord audit files:

- rows: 7,371
- posted rows: 6,740
- current metadata rows: 688
- fail findings: 27
- warn findings: 69
- info findings: 118

Important interpretation:

- The command exited nonzero because saved historical rows still contain fails/warnings.
- Most warnings are historical trader-language findings from older saved output.
- Current-format fail findings were concentrated in saved `range_compression` follow-through posts whose metadata said `signalCategoryLiveEnabled: false`.
- The current code path now suppresses follow-through payloads when `payload.metadata.signalCategoryLiveEnabled === false`; treat those saved rows as pre-fix evidence unless a fresh runtime still posts them after restart.

Sessions with current-format range-compression failures included:

- `2026-05-06_10-14-15`
- `2026-05-06_07-08-26`
- `2026-05-05_15-43-22`
- `2026-05-04_11-32-04`
- `2026-05-04_09-27-26`

Latest session replay estimate from this pass:

- `2026-05-06_10-14-15`: 102 saved alert-style posts -> 82 simulated posts, 19.6% reduction.

### Specific Ticker/Date 5h Replay

Coverage label: `partial`.

Default historical 5h replay cases were regenerated under the new audit folder.

Findings:

- `AKAN` 2026-04-22 11:00 ET: closest and full starting resistance maps were exhausted; no-lookahead refresh would add higher resistance.
- `SKLZ` 2026-04-23 12:15 ET: closest and full starting resistance maps were exhausted; no-lookahead refresh would add higher resistance.
- `YCBD`, `AIXI`, `CAST`, `YAAS`, `SEGG`, and `ATER`: no map exhaustion inside the 5h replay window.

Interpretation:

- This confirms the known historical map-exhaustion cases remain the same two symbols.
- The replay output still shows the refresh mechanism as the right fix path when a true runner outruns the starting map.

### 80-Case Support/Resistance Story Replay

Coverage label: `partial` to `thorough` for story-map coverage, `partial` for Discord delivery behavior.

The 80-case warehouse replay completed:

- total cases: 80
- ok cases: 80
- missing candle cases: 0
- story-map coverage concerns: 1

Primary finding:

- `ATPC` 2026-05-04 05:45 ET moved +30.4% over the 5h replay, emitted 13 monitor events and 12 story candidates, but produced 0 trader-facing story posts.
- Its candidate resistance map reached +34.7%, so this was not a map-coverage problem.
- The candidates were mostly low-score support/resistance touches, early breakouts, and failed breakout/test events filtered by policy.

Interpretation:

- This is a good follow-up case for "quiet may be too quiet" review.
- Do not immediately loosen global alert thresholds from one case. First inspect the raw ATPC candles and ask whether the Discord thread truly needed an update as the play developed.
- If the ATPC chart shows a real trader-story progression, add a focused regression that allows one useful continuation/breakout update without reopening noisy same-level chatter.

### Bounded Why-No-Post Proof

Coverage label: `data_limited`.

The bounded all-session why-no-post proof ran against 15 saved sessions with `data/candles`:

- symbols: 10
- quiet supported by candles: 1
- quiet preserved meaningful moves: 1
- quiet may hide a move: 0
- unproven due to runtime/feed silence: 2
- unproven due to missing candles: 6
- actionable missed candidates: 0
- major missed candidates: 7

Interpretation:

- This pass did not prove that the quieter policy hid an actionable move.
- It did prove the evidence is still data-limited for broad all-session conclusions.
- `YCBD` and `AKAN` had runtime/feed-silence candidates, so those are not clean policy misses.
- `AMST`, `AUUD`, `BURU`, `FFAI`, `PAPL`, and `TDIC` need overlapping candle coverage before strong quiet/noisy conclusions.

## Product Read

What looks healthy:

- The 80-case S/R story replay has broad candle coverage and no missing cases.
- Historical map exhaustion remains isolated to known extreme runners where refresh adds higher resistance.
- The latest Discord replay estimate continues to reduce repeated output meaningfully.
- The bounded why-no-post proof found 0 actionable missed candidates and 0 quiet-may-hide symbols.

What needs follow-up:

- `ATPC` should be manually replay-audited as a possible "too quiet during real progression" case.
- Range-compression follow-through should be watched after the next controlled runtime restart to verify the current suppression code is active in live Discord.
- Broad all-session why-no-post proof remains `data_limited` until more overlapping warehouse candles exist for older saved sessions.

Implementation note from continued audit:

- The focused runtime test suite caught that the new ladder-step cooldown was also suppressing clustered fast level clears.
- Fix applied: `ManualWatchlistRuntimeManager.shouldPostLevelClearUpdate` now passes `majorChange` through as a material structure change for the ladder-step policy.
- Result: rapid single-step ladder chatter can still be suppressed, while true multi-level resistance/support clusters are allowed through.

## Next Actions

1. Manually inspect `ATPC` 2026-05-04 05:45 ET from `artifacts/past-replay-audit-2026-05-06/support-resistance-story-replay-80/support-resistance-story-replay.md`.
2. If ATPC deserved a thread update, add a focused test around one useful continuation/breakout post after meaningful price progress.
3. After the next controlled runtime restart, rerun `saved-data:test` on the fresh session and confirm no `range_compression` rows reach Discord with `signalCategoryLiveEnabled: false`.
4. Use candle backfill/readiness tooling for `AMST`, `AUUD`, `BURU`, `FFAI`, `PAPL`, and `TDIC` before claiming broad all-session quiet-policy proof.

## ATPC Manual Inspection Addendum

Status: `watch`, no code change from this case alone.

Manual candle read:

- `ATPC` was flat at `2.30` from 05:45 through the early premarket window, with several zero-volume candles.
- The real movement started later: `2.40` around 09:05, a thin push through `2.50-2.56` around 10:05, then `2.80-3.00` into 10:30-10:45.
- The full 5h window did move +30.4%, but the early replay evidence is thin/liquidity-light rather than a clean high-confidence breakout from the first candle.

Why the case is still useful:

- The story replay saw 12 story candidates and 0 posted story posts.
- The later `2.80` resistance test and `2.95` breakout candidate are the most plausible moments where a trader might expect one update.
- This replay lane only exercises the `AlertIntelligenceEngine` story posts. The live runtime also has `level_clear_update`, continuity, and follow-through paths, so this artifact is not full proof that live Discord would stay silent.

Decision:

- Do not loosen global alert scoring from ATPC alone. The case has thin volume and several small clustered resistance steps, which is exactly where noise controls can be correct.
- Keep ATPC as a focused watch case. If a future full-runtime replay or live session proves the thread stays silent during a clearly accepted continuation, add a narrow regression for one continuation/breakout update after meaningful price progress, not a broad threshold reduction.

Verification after implementation note:

```powershell
node --test --import tsx src\tests\manual-watchlist-runtime-manager.test.ts
node --test --import tsx src\tests\live-thread-post-policy.test.ts src\tests\live-post-replay-simulator.test.ts
```

Both focused suites passed after the clustered-clear materiality fix.
