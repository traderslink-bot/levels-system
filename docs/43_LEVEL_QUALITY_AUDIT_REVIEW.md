# Level Quality Audit Review

Date: 2026-05-28

## Scope

This review ran the Level Quality Audit Review Runner against the existing sample `LevelEngineOutput` artifact. It did not change support/resistance detection, scoring, clustering, ranking, selection, runtime behavior, alerts, monitoring, Discord behavior, or trader-context behavior.

No saved `LevelIntelligenceReport` sample was present beside the existing sample output, so this run used only the `LevelEngineOutput` JSON.

## Input

- `docs/examples/level-intelligence/sample-level-engine-output.json`

## Commands

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --format text --out docs/examples/level-intelligence/latest-level-quality-audit.txt
```

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --format json --out docs/examples/level-intelligence/latest-level-quality-audit.json
```

## Outputs

- `docs/examples/level-intelligence/latest-level-quality-audit.txt`
- `docs/examples/level-intelligence/latest-level-quality-audit.json`

## Summary Findings

- Symbol: `SAMP`
- Total levels: `8`
- Support / resistance: `4 / 4`
- Extension levels: `2`
- Fresh / stale: `6 / 0`
- Enriched / unenriched: `0 / 8`
- Nearby support count around reference price `3.42`: `3`
- Nearby resistance count around reference price `3.42`: `2`
- Clustered areas: `0`
- Session / volume / shelf / market-context confluence counts: `0 / 0 / 0 / 0`

The sample has a clean and balanced basic level map, but the audit is limited because no intelligence report or facts-rich profile was supplied. Every level is currently unenriched in this artifact, and the audit has no session, volume, shelf, or market-context confluence to inspect.

## Strongest Level Observations

The strongest supplied levels are:

- `3.75` major resistance, strength `88/major`, `4` touches, `3` confluences.
- `3.20` major support, strength `86/major`, `5` touches, `3` confluences.
- `3.60` intermediate resistance, strength `74/strong`, `3` touches, `2` confluences.
- `4.10` resistance extension, strength `73/strong`, `2` touches, `2` confluences.
- `3.35` intermediate support, strength `71/strong`, `3` touches, `2` confluences.

These values indicate the sample’s legacy transport fields are coherent enough for a first audit pass: stronger levels sort ahead of moderate intraday levels, and the extension resistance remains visible in the quality review.

## Weakest, Stale, And Clutter Observations

The weakest supplied levels are:

- `3.40` intraday support, strength `62/moderate`.
- `3.50` intraday resistance, strength `66/moderate`.
- `2.95` support extension, strength `69/strong`.
- `3.35` intermediate support, strength `71/strong`.
- `4.10` resistance extension, strength `73/strong`.

No stale levels were detected. No clustered areas or possible clutter levels were detected at the current audit threshold.

The weakest-list result is not necessarily a quality failure. It mainly shows that the sample has only eight levels, so extension and intermediate levels appear in the lower half after the two moderate intraday levels.

## Extension Ladder Observations

The extension ladder has:

- Support extensions: `1`
- Resistance extensions: `1`
- Lowest support extension: `2.95`
- Highest resistance extension: `4.10`
- Downside coverage: `13.7427%`
- Upside coverage: `19.883%`

The audit emitted:

- `limited_upside_extension_coverage`
- `limited_downside_extension_coverage`

This sample sits just under the default `20%` coverage warning on the upside and farther under it on the downside. That does not prove the extension ladder is wrong, but it gives us a useful review target for richer samples and replay cases.

## Nearby Level Coverage Observations

Reference price: `3.42`

- Nearest support: `3.40` intraday support.
- Distance to nearest support: `0.5848%`.
- Nearest resistance: `3.50` intraday resistance.
- Distance to nearest resistance: `2.3392%`.
- Nearby support count: `3`.
- Nearby resistance count: `2`.

Nearby coverage is usable in this sample. The audit did not report a wide overhead resistance gap or wide downside support gap.

## Obvious Level-Quality Issues

The clearest quality issue is not the level map itself. It is the missing context around the levels:

- `level_intelligence_report_missing`
- `levels_without_context_present`
- `unenriched_levels_present`

Because no intelligence report was supplied, the audit cannot evaluate session facts, volume facts, volume shelves, market context, enriched state, confidence, or richer explanation confluence.

## Tuning Implications

This run does not justify changing detection, clustering, scoring, ranking, or level selection yet.

The best next gate is explanation/enrichment review coverage:

- Generate or save a deterministic `LevelIntelligenceReport` sample for the same `LevelEngineOutput`.
- Include session, volume, shelf, and market-context facts when building that report.
- Re-run the quality audit with `--level-intelligence-report`.
- Compare the context-aware audit against this baseline before touching detection or scoring logic.

Extension ladder coverage deserves continued review on real and replay outputs, especially low-price runner fixtures, but this one sample alone is not enough to change extension behavior.

## Next Gate

Create a facts-rich LevelIntelligenceReport artifact for the existing sample and re-run:

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --level-intelligence-report <path-to-report.json> --format text --out docs/examples/level-intelligence/latest-level-quality-audit-with-intelligence.txt
```

That next review should determine whether the remaining gaps are only missing explanation context or whether actual support/resistance generation and extension coverage need a separate tuning gate.
