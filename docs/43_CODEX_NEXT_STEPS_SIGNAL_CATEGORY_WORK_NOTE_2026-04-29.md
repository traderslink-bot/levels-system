# Codex Next Steps: Signal Category Work Note

Date: 2026-04-29
Branch: `codex/runtime-compare-tooling`

## Purpose

This note records the five next implementation steps Codex recommended after reviewing:

- `docs/41_MODULAR_SIGNAL_CATEGORIES_PLAN_2026-04-29.md`
- `docs/42_SIGNAL_CATEGORY_TIMEFRAME_AND_NOISE_CONTROL_PLAN_2026-04-29.md`

The work should be done in this order so the app can add richer signal context without increasing Discord noise.

## Next Steps To Implement

1. Build the category config/profile framework first.
   - Add typed signal category keys.
   - Add profile presets such as `levels_only`, `levels_plus_structure`, `trader_balanced`, and `operator_full`.
   - Add a surface matrix for live Discord, operator artifacts, and internal scoring.

2. Map current behavior into categories without changing live behavior much.
   - Assign existing support/resistance, breakout/reclaim quality, reaction quality, follow-through, trader commentary, and operator review behavior to explicit categories.
   - Keep the current trader-facing behavior stable while category ownership is introduced.

3. Add pivots and market structure next, but very carefully.
   - Build explicit pivot and market-structure contracts.
   - Keep both independently toggleable.
   - Only allow live posts on meaningful state changes.

4. Keep volume/activity, candle meaning, and pattern context internal at first.
   - These categories should improve scoring and operator review before they become live Discord text.
   - They should not create standalone live post streams until proven useful.

5. Add tests that prove repeated same-story states stay quiet.
   - Each live-eligible category needs quiet-persistence tests.
   - Tests should verify that a state posts when it forms, stays quiet while unchanged, and posts again only when it materially improves or fails.

## ABTS Level Gap Follow-Up

During the same review, ABTS showed a suspicious resistance jump from `1.83` to `2.31` in a live snapshot example.

The local IBKR level-quality audit could not initially be rerun because TWS/IBKR was not reachable on `127.0.0.1:7497`.

An independent Yahoo daily/hourly sanity check found repeated highs between `1.83` and `2.31`, especially around:

- `1.94-2.00`
- `2.09-2.16`
- `2.25-2.27`

Follow-up: when IBKR is available again, rerun:

```powershell
npm run validation:levels:quality -- ABTS artifacts\abts-level-quality-audit.json
```

After IBKR was restarted, the audit was rerun with manual-style lookbacks:

```powershell
$env:LEVEL_VALIDATION_LOOKBACK_DAILY='520'
$env:LEVEL_VALIDATION_LOOKBACK_4H='180'
$env:LEVEL_VALIDATION_LOOKBACK_5M='100'
npm run validation:levels:quality -- ABTS artifacts\abts-level-quality-audit-manual-lookbacks.json
```

Result:

- IBKR surfaced resistance at `1.74`, `1.78`, `1.83`, `2.3146`, and `2.4526`.
- IBKR daily candles still contained intermediate highs between `1.83` and `2.3146`, especially around `1.93-2.00` and `2.09-2.14`.
- IBKR 4h candles also contained intermediate highs around `1.94-1.99`, `2.13`, and `2.20-2.22`.
- The current level-quality audit still reported `healthy_forward_ladder`, so the audit is not strict enough to flag this kind of trader-visible intermediate-resistance gap.

Fix implemented:

- Higher-timeframe barrier-candle promotion was loosened so meaningful interior daily/4h highs and lows inside a larger move can become level candidates.
- The level-quality audit now flags `wide_internal_gap` when adjacent forward levels are too far apart even if the ladder has enough total levels.
- The ABTS manual-lookback audit now surfaces forward resistance at `1.66`, `1.74`, `1.78`, `1.83`, and `2.14`, removing the prior visible jump from `1.83` directly to `2.3146`.

Remaining risk: the system should still avoid inventing tiny levels just to fill space. Future reviews should treat wide-gap audit findings as chart-review prompts, not automatic proof that every price inside the gap deserves a Discord-visible level.
