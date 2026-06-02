# Level Quality Review Rerun After Density Metric Wiring

## Purpose

This gate reruns the packaged 10-symbol real-cache LevelEngine quality review after `densityMetric` was wired additively into `LevelQualityAuditReport`.

The goal is to confirm that density metrics appear in review output, validate against the density metric contract, remain factual-only, and do not disturb the locked baseline fields.

This gate does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Reviewed Symbols

The rerun used the locked 10-symbol set:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`
- `AIM`
- `HCWB`
- `YMAT`
- `AAOI`
- `PHOE`

Supplied 15m symbols remained:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

## Baseline Source

Baseline artifact:

```text
docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json
```

Local cache root:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

Provider:

```text
ibkr
```

## Packaged Command

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json --out-json docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json --out-text docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.txt --generated-at 2026-06-02T00:07:51.752Z
```

The command read local cache wrapper files only. It did not collect data, call providers, write cache files, or emit raw candles/full snapshots.

## Density Metric Presence Summary

`densityMetric` appeared for all 10 reviewed symbols.

Summary:

- total symbols: `10`
- density metric present: `10/10`
- density metrics contract-valid: `10/10`
- density metrics factual-only: `10/10`
- prohibited-language hits: `0`

During validation, the packaged review output was hardened to retain the full `LevelQualityDensityMetric` contract shape, plus the additive `present` flag. This lets future review artifacts pass `validateLevelQualityDensityMetric` directly.

## Density Classification Summary

Classifications:

- `dense_clustered`: `5`
- `balanced`: `4`
- `sparse`: `1`
- `dense_separated`: `0`

Per-symbol classifications:

- `DEVS`: `dense_clustered`
- `ENVX`: `dense_clustered`
- `DXYZ`: `balanced`
- `QUBT`: `balanced`
- `GME`: `dense_clustered`
- `AIM`: `dense_clustered`
- `HCWB`: `sparse`
- `YMAT`: `dense_clustered`
- `AAOI`: `balanced`
- `PHOE`: `balanced`

Side-bias summary:

- `mixed`: `6`
- `support_heavy`: `3`
- `resistance_heavy`: `1`

## Dense-Separated And Dense-Clustered Summary

No `dense_separated` cases appeared in this locked 10-symbol rerun.

`dense_clustered` appeared on:

- `DEVS`
- `ENVX`
- `GME`
- `AIM`
- `YMAT`

This is consistent with the previous cluster/density evidence: the density metric now makes the clustered density status explicit without changing generated levels.

## Existing Baseline Parity Summary

Existing baseline comparison fields remained stable:

- nearest support parity: `10/10`
- nearest resistance parity: `10/10`
- bucket count parity: `10/10`
- extension count parity: `10/10`
- synthetic count parity: `10/10`
- synthetic marking parity: `10/10`
- diagnostics parity: `10/10`
- diagnostic semantics parity: `10/10`
- enrichment breakdown parity: `10/10`
- extension warning parity: `10/10`
- cluster/density diagnostic parity: `10/10`
- mismatch count: `0`

The additive density metric did not change the locked baseline fields.

## 15m Context-Only Summary

15m facts remained context-only:

- supplied 15m symbols: `DEVS`, `ENVX`, `DXYZ`, `QUBT`, `GME`
- 15m context-only count: `10/10`
- 15m remained outside LevelEngine metadata and support/resistance generation

## Prohibited-Language Guard

The rerun reported:

```text
Prohibited-language hits: 0
```

Density metric classifications and diagnostics remain factual audit context. They do not add grading, coaching, P/L, giveback, behavior scoring, recommendations, trade advice, or buy/sell/hold language.

## Limitations

- This rerun validates the existing locked 10-symbol local real-cache set only.
- No new cache files were collected or written.
- `dense_separated` did not appear in this symbol set, though it remains covered by deterministic density metric fixtures.
- Density-specific diagnostics remain inside `densityMetric.diagnostics`; they are not promoted into report-level `diagnosticSemantics` in this gate.

## Possible Bugs

No LevelEngine production bug was found.

One review-output compatibility issue was found and fixed in this gate: the compact review output initially omitted fields required by `validateLevelQualityDensityMetric`. The packaged review output now preserves the full metric contract shape.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_audit_density_metric_semantics_review
```

Reason: now that `densityMetric` is present and valid in real-cache review output, review whether any density-related semantics should remain inside `densityMetric` only or be promoted additively to report-level `diagnosticSemantics` in a later gate.
