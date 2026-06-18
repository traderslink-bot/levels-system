# Future Self Handoff - 2026-05-06

Purpose: this chat was getting heavy, so this file is the fastest re-entry point
for the next `levels-system` Codex session.

## Current Branch / GitHub State

- Repo: `c:\Users\jerac\Documents\TraderLink\levels-system`
- Branch: `codex/runtime-compare-tooling`
- Remote: `origin git@github.com:traderslink-bot/levels-system.git`
- Latest commit: `a4ca223 Expand candle intelligence audit tooling`
- Branch sync check on 2026-05-06: `0 ahead / 0 behind`
- GitHub action taken: none.

Reason no push/commit was made:

- The worktree is already very dirty with many modified and untracked files
  across docs, runtime code, review scripts, validation modules, and tests.
- Some of those changes are older/user/other-Codex work and should not be
  swept into a blind commit from this handoff step.
- Next session should create a deliberate commit boundary before pushing.

## Hard Constraints To Preserve

- Production/real provider path is IBKR plus `data/candles` warehouse.
- Do not add broad delisted-symbol discovery.
- Keep alias handling narrow and validated; current known case is
  `MAXN -> MAXNQ`.
- Do not build a broad corporate-action engine yet.
- Do not guess reverse split ratios or rewrite old candle prices in place.
- For likely split/adjusted-vs-execution mismatch cases, keep candles
  unavailable for Trader Intelligence unless raw IBKR candle basis is proven
  aligned to broker execution prices.
- Do not add VWAP/EMA back into trader-facing support/resistance coaching.
- Do not change Discord/trader wording unless explicitly asked.
- Do not bulk-fetch more candles unless a handoff explicitly says to.

## Main Coordination Docs

Read these first in the next chat:

- `docs/77_TRADER_INTELLIGENCE_HISTORICAL_BACKFILL_AND_ASOF_PLAN_2026-05-05.md`
- `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md`
- Trader Intelligence policy doc:
  `C:\Users\jerac\Documents\TraderLink\trader-intelligence-v2\src\docs\candle-warehouse-basis-policy-design-2026-05-06.md`

## Trader Intelligence Support Completed

Provider/warehouse metadata was extended so stored/replayed candles can carry:

- provider
- requested symbol
- resolved symbol, conId, exchange, primaryExchange when available
- fetch timestamp
- `whatToShow`
- RTH/extended-hours setting
- provider-declared adjustment mode when available
- warehouse adjustment mode
- alias/PINK metadata
- basis validation status

Basis validation status model now exists:

- `basis_unchecked`
- `basis_aligned`
- `basis_mismatch`
- `basis_adjustment_multiple_likely`
- `basis_insufficient_evidence`

Trade-analysis diagnostics now expose:

- `trade_window_basis_validation_status`

Important consumer state from the last coordination pass:

- `PBM` and `XTLB` were resolved as candle-window coverage/replay issues.
- Remaining execution-only fallback symbols are intentional price-basis /
  likely adjustment-multiple cases:
  - `VEEE`
  - `ISPC`
  - `DGNX`
- Remaining insufficient daily/4h history diagnostics:
  - `AVEX`
  - `ELMT`

## Level Quality Work Completed

The level-quality report script now has report-only clean-break diagnostic
buckets. These do not change level scoring thresholds or trader-facing wording.

Existing report-only buckets:

- `unknown_volume_clean_break_watch`
- `off_hours_light_volume_break_watch`
- `off_hours_event_context_break_watch`
- `single_timeframe_5m_swing_break_watch`
- `local_level_cluster_break_watch`
- `event_regime_change_watch`

Latest event-regime addition:

- User clarified `SKLZ` 2026-04-23 was a halt-up/gap-up style runner toward
  about `$20`.
- Saved IBKR 5m candles confirmed the day was an extreme regime-change event:
  - low around `3.25` near 11:30 ET
  - high `20.00` at 13:20 ET
  - about `515.4%` saved-session low-to-high range
- `SKLZ` 2026-04-23 `3.42` support moved from ordinary
  `possible_overstated_strength` into `event_regime_change_watch`.
- Final 5h/2h/8h expanded reports now have `0` `possible_overstated_strength`
  rows.
- `SKLZ` 2026-05-01 `8.08` resistance remains the only
  `needs_manual_review` row.

Latest level-quality artifacts:

- `artifacts/level-quality-sklz-event-regime-timeline-2026-05-06.md`
- `artifacts/level-quality-event-regime-classification-summary-2026-05-06.md`
- `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06`
- `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06-2h`
- `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06-8h`

Final event-regime report state:

| Horizon | Cases | Scored | Unscored | Clean-break targets |
|---|---:|---:|---:|---:|
| 5h | 300 | 300 | 0 | 72 |
| 2h | 300 | 300 | 0 | 67 |
| 8h | 300 | 300 | 0 | 67 |

## Files Touched In The Latest Event-Regime Pass

- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/level-quality-clean-break-classifier.test.ts`
- `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/79_FUTURE_SELF_HANDOFF_2026-05-06.md`
- `artifacts/level-quality-sklz-event-regime-timeline-2026-05-06.md`
- `artifacts/level-quality-event-regime-classification-summary-2026-05-06.md`

## Verification Already Run

Latest event-regime pass:

- `npx tsx --test src\tests\level-quality-clean-break-classifier.test.ts src\tests\forward-reaction-diagnostics.test.ts`
  passed: `22/22`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- `git diff --check` passed for the event-regime touched files.

Earlier same-chat provider/Trader Intelligence support:

- `npx tsx --test src\tests\durable-candle-warehouse.test.ts src\tests\support-resistance-shared-api.test.ts`
  passed: `42/42`.
- `npx tsx --test src\tests\support-resistance-shared-api.test.ts`
  passed: `27/27`.
- TypeScript and build passed after those changes.

## Suggested Next Moves

1. Start by reading this file plus docs `77` and `78`.
2. Run `git status --short` and decide a clean commit boundary.
3. If committing, separate at least:
   - Trader Intelligence candle metadata/basis work;
   - stale partial `1m` fallback diagnostic polish;
   - level-quality diagnostic bucket/event-regime work;
   - unrelated older local changes.
4. Do not tune broad S/R scoring thresholds from the current report set.
5. For future level-quality work, build a new clean calibration set now that
   event, off-hours, volume-quality, sparse-tape, and source-shape cases are
   separated.
6. For Trader Intelligence, keep `VEEE`/`ISPC`/`DGNX` execution/P&L-only unless
   raw IBKR candle basis is proven aligned to broker executions.
