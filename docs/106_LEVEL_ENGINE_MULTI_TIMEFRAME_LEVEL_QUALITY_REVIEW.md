# LevelEngine Multi-Timeframe Level Quality Review

## Purpose

This gate reviews actual `LevelEngine` output quality across local IBKR
real-cache snapshots now that the `LevelAnalysisSnapshot` v1, optional 15m
facts, runner, and supplied-15m validation path are stable.

This is a review/reporting gate. It does not tune support/resistance detection,
change LevelEngine scoring/ranking/clustering, feed 15m into LevelEngine,
change runtime defaults, change alert/monitoring/Discord behavior, modify the
journal app, or add journal interpretation.

## Reviewed Symbols

The review used ten local IBKR cache-backed symbols:

| Group | Symbols |
| --- | --- |
| Supplied 15m context present | `DEVS`, `ENVX`, `DXYZ`, `QUBT`, `GME` |
| 5m/4h/daily comparison set without supplied 15m | `AIM`, `HCWB`, `YMAT`, `AAOI`, `PHOE` |

The supplied-15m symbols used the existing first-write 15m cache files. The
comparison symbols used their latest available `5m`, `4h`, and daily cache
files only.

## Validation Method

An offline review harness:

1. read only local cache files from
   `C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles`;
2. built `LevelAnalysisSnapshot` outputs through the from-candles path;
3. supplied 15m candles only for `DEVS`, `ENVX`, `DXYZ`, `QUBT`, and `GME`;
4. confirmed 15m facts remained context only by checking that `15m` did not
   appear in `levelEngineOutput.metadata.providerByTimeframe`;
5. summarized nearest support/resistance, bucket counts, extension counts,
   LevelQualityAudit diagnostics, clustered areas, and synthetic continuation
   map rows;
6. wrote compact summary artifacts only.

No raw candle arrays or full snapshots are committed.

## Per-Symbol Quality Summary

| Symbol | Ref | 15m | Nearest support | Nearest resistance | S/R/Ext | Coverage | Density | Key diagnostics |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `DEVS` | 0.2705 | present | 0.27, 0.1848% | 0.2772, 2.4769% | 11/5/3 | nearest coverage present | clustered areas | clustered areas, limited downside extension coverage, no resistance extension coverage, unenriched levels |
| `ENVX` | 6.73 | present | 6.68, 0.7429% | 6.8, 1.0401% | 10/6/4 | nearest coverage present | clustered areas | clustered areas, limited downside extension coverage, unenriched levels |
| `DXYZ` | 46.47 | present | 45.8, 1.4418% | 46.8, 0.7101% | 11/6/4 | nearest coverage present | clustered areas | clustered areas, unenriched levels |
| `QUBT` | 12.799 | present | 12.42, 2.9612% | 12.9727, 1.3571% | 12/7/4 | nearest coverage present | dense map | unenriched levels |
| `GME` | 24.8 | present | 24.73, 0.2823% | 25, 0.8065% | 8/7/6 | nearest coverage present | clustered areas | clustered areas, unenriched levels |
| `AIM` | 0.373 | absent | 0.35, 6.1662% | 0.375, 0.5362% | 11/6/3 | nearest coverage present | clustered areas | clustered areas, no resistance extension coverage, unenriched levels |
| `HCWB` | 2.945 | absent | 1.91, 35.1443% | 3.78, 28.3531% | 14/3/1 | wide nearby gap | clustered areas | clustered areas, no resistance extension coverage, wide support/resistance gaps, unenriched levels |
| `YMAT` | 1.325 | absent | 1.31, 1.1321% | 1.34, 1.1321% | 15/11/6 | nearest coverage present | clustered areas | clustered areas, limited downside extension coverage, unenriched levels |
| `AAOI` | 178.64 | absent | 174.78, 2.1608% | 189.5, 6.0793% | 13/3/5 | nearest coverage present | dense map | unenriched levels |
| `PHOE` | 34.75 | absent | 29.85, 14.1007% | 40.98, 17.9281% | 18/2/4 | wide nearby gap | dense map | wide support/resistance gaps, unenriched levels |

## Cross-Symbol Observations

The review found:

- all reviewed symbols produced both nearest support and nearest resistance;
- eight of ten symbols had nearest support/resistance coverage inside the
  default nearby audit threshold;
- `HCWB` and `PHOE` had wide nearby support and resistance gaps;
- five symbols had extension coverage warnings;
- seven symbols had clustered level areas;
- all reviewed symbols reported unenriched levels in the current output;
- two synthetic continuation-map rows appeared and both were clearly marked;
- no reviewed output showed 15m in LevelEngine provider metadata.

## Strengths

- Supplied 15m context populated without changing LevelEngine inputs.
- LevelEngine remained scoped to `5m`, `4h`, and daily inputs for reviewed
  snapshots.
- LevelQualityAudit surfaced useful nearby and extension coverage diagnostics.
- Synthetic continuation-map rows remained visibly marked when present.
- LevelIntelligenceReport profiles stayed factual and safety-marked.

## Weaknesses

- Some symbols still show clustered areas that may deserve a density review.
- Some symbols show one-sided or limited extension coverage.
- `HCWB` and `PHOE` show wide nearby support/resistance gaps.
- Current outputs still report unenriched levels, so enrichment mapping coverage
  should be reviewed before tuning behavior.

## Potential Bugs

No obvious production bug was found.

The observed issues look like tuning-plan inputs rather than defects requiring
an immediate code fix.

## Improvement Candidates

Potential follow-up categories:

- review cluster density and near-duplicate levels;
- review extension spacing and coverage depth;
- review forward resistance coverage;
- review nearest-level gap thresholds;
- review level enrichment mapping coverage;
- keep synthetic continuation-map levels marked as forward context;
- consider future 15m explanatory context only after a tuning plan.

These are review findings only. No support/resistance behavior was changed in
this gate.

## 15m Facts Context Assessment

For `DEVS`, `ENVX`, `DXYZ`, `QUBT`, and `GME`:

- supplied 15m facts were present;
- 15m facts remained in `timeframeFacts["15m"]`;
- 15m did not appear in `levelEngineOutput.metadata.providerByTimeframe`;
- 15m facts did not create support/resistance levels;
- 15m facts were useful as context but are not yet used for level generation.

The no-15m comparison symbols built normally from `5m`, `4h`, and daily cache
data.

## Artifacts

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/level-quality-review/latest-level-quality-review.json
docs/examples/level-analysis-snapshot/level-quality-review/latest-level-quality-review.txt
```

The artifacts include source file paths relative to the cache root, summary
counts, nearest-level distances, extension coverage, diagnostics, synthetic
marking summaries, and improvement candidates. They do not include raw candle
arrays or full generated snapshots.

## What Remains Intentionally Unchanged

This gate did not:

- change LevelEngine behavior;
- change support/resistance detection;
- feed 15m into LevelEngine;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_engine_quality_tuning_plan
```

Reason: no urgent production bug was found. A tuning plan should come before
changing support/resistance behavior so the next implementation work is scoped,
testable, and grounded in the observed real-cache quality findings.
