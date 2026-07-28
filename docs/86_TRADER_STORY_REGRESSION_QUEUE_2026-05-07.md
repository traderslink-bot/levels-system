# Trader Story Regression Queue 2026-05-07

Purpose: keep a compact regression set for closed-market Discord story and support/resistance ladder audits.

This queue was created after rerunning the combined story-quality audit across the 20 most recent long-run sessions.

Artifact:

- `artifacts/story-quality-backtest-2026-05-07-recent20/aggregate-findings.md`
- Per-session reports live under `artifacts/story-quality-backtest-2026-05-07-recent20/<session>/`
- Focused follow-up: `docs/87_FOCUSED_TRADER_STORY_REGRESSION_AUDIT_2026-05-07.md`

Command:

```powershell
npm run audit:story-quality -- artifacts\long-run\<session> --warehouse data\candles --out-dir artifacts\story-quality-backtest-2026-05-07-recent20\<session>
```

## Result Summary

- Sessions audited: 20
- Recent clean/current-code sessions:
  - `2026-05-07_15-32-55`: clean, 9 symbols, 77 posts, 0 story risks, 0 ladder findings.
  - `2026-05-07_14-47-29`: clean, 2 symbols, 8 posts, 0 story risks, 0 ladder findings.
- Older sessions still contain useful regression pressure:
  - repeated story-budget/noise cases.
  - DXYZ/SEGG-style hidden ladder gap cases.
  - near-price wrong-side levels that should flip into reclaim/hold context.

Important audit fix from this pass:

- Delayed `stock_context` company/startup posts are not trader-story late failures.
- `daily-trader-review` now excludes `stock_context` from trader-story post budgets and examples.

## Primary Regression Symbols

Use these first after support/resistance or posting-policy changes.

| Symbol | Why It Is In The Queue | Sessions / Evidence |
| --- | --- | --- |
| `PMAX` | Repeated pressure across story budget, near-price wrong-side level, and hidden resistance gap. | `2026-05-06_07-08-26`, `2026-05-06_10-14-15`, `2026-05-06_18-07-37`, `2026-05-07_07-01-08` |
| `SKK` | Low-volume/chop threads can overpost; also had a near-price wrong-side resistance omission. | `2026-05-06_07-08-26`, `2026-05-06_10-14-15`, `2026-05-06_12-35-19` |
| `SMX` | Repeated hidden resistance zone around `2.08-2.14` inside posted gaps. | `2026-05-06_10-14-15`, `2026-05-06_12-35-19`, `2026-05-07_07-01-08` |
| `SEGG` | Known live example. Earlier session overposted in chop and missed/omitted practical overhead areas; latest clean session should remain clean. | `2026-05-06_12-35-19`, `2026-05-07_07-01-08`, compare with clean `2026-05-07_15-32-55` |
| `AKAN` | One-minute burst plus hidden forward resistance zone; also map-exhaustion history in replay docs. | `2026-05-04_15-31-38`, `2026-05-07_07-01-08` |
| `EZGO` | Thin-map / missing next-level context and stale/wrong-side extension history. Do not loosen global thresholds from EZGO alone. | `2026-05-05_15-43-22`, `2026-05-06_12-35-19` |
| `MASK` | Budget/why-post evidence watch case; also a known high-move saved-candle replay symbol. | `2026-05-05_07-16-43`, `2026-05-06_10-14-15` |
| `SDOT` | Support ladder hidden-gap and near-price wrong-side support examples. | `2026-05-05_07-16-43`, `2026-05-05_15-43-22` |

## Secondary Watch Symbols

Use these when changing ladder role-flip logic or hidden-gap thresholds:

- `ERNA`: one burst watch case plus near-price support omission; same-day ordering concerns can be timeout-contaminated.
- `AVTX`: low-volume budget watch plus near-price support omission.
- `HOTH`: repeated near-price major support omission.
- `CHSN`, `GLE`, `PBM`, `RMSG`, `EDHL`, `GCTK`, `SLP`, `FLEX`, `FEMY`, `ICCM`, `WCT`, `PLRZ`, `YYAI`: single-session candidates from the recent 20-session batch.

## How To Use This Queue

When changing posting policy, support/resistance ladder filtering, level role flips, or snapshot map rendering:

1. Run the focused unit tests for the changed area.
2. Run the latest clean session:

```powershell
npm run audit:story-quality -- artifacts\long-run\2026-05-07_15-32-55 --warehouse data\candles
```

3. Rerun the primary regression sessions that match the changed behavior:

```powershell
npm run audit:story-quality -- artifacts\long-run\2026-05-07_07-01-08 --warehouse data\candles --out-dir artifacts\story-quality-regression-rerun\2026-05-07_07-01-08
npm run audit:story-quality -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles --out-dir artifacts\story-quality-regression-rerun\2026-05-06_12-35-19
npm run audit:story-quality -- artifacts\long-run\2026-05-06_10-14-15 --warehouse data\candles --out-dir artifacts\story-quality-regression-rerun\2026-05-06_10-14-15
npm run audit:story-quality -- artifacts\long-run\2026-05-05_15-43-22 --warehouse data\candles --out-dir artifacts\story-quality-regression-rerun\2026-05-05_15-43-22
```

4. Read the thread as a trader story for any remaining `watch` or `needs_review` symbol. Do not rely only on aggregate counts.

## Decision Rules

- A clean latest session is evidence the current live behavior is not obviously broken.
- Older session findings are regression pressure, not proof that current live code is wrong.
- Do not tune global level thresholds from one symbol.
- Repeated hidden-gap findings across multiple symbols can justify a ladder detection change.
- Repeated over-budget low-volume/chop findings can justify posting-policy suppression only after missed-move/why-no-post proof stays clean.
- `stock_context` startup/company posts should stay out of trader-story late-delivery scoring.
