# Level Quality Audit With Intelligence Review

Date: 2026-05-28

## Scope

This review generated a facts-rich `LevelIntelligenceReport` for the existing sample `LevelEngineOutput`, then reran the Level Quality Audit with both inputs.

This was an artifact-only review. It did not change support/resistance detection, scoring, clustering, ranking, selection, runtime behavior, alerts, monitoring, Discord behavior, or trader-context behavior.

## Input Files

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

## Commands

The facts-rich `LevelIntelligenceReport` was generated with the existing pure `buildLevelIntelligenceReport(...)` module:

```powershell
@'
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildLevelIntelligenceReport } from "./src/lib/levels/level-intelligence-report.js";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const output = readJson("docs/examples/level-intelligence/sample-level-engine-output.json");
const sessionFacts = readJson("docs/examples/level-intelligence/sample-session-facts.json");
const volumeFacts = readJson("docs/examples/level-intelligence/sample-volume-facts.json");
const volumeShelves = readJson("docs/examples/level-intelligence/sample-volume-shelves.json");
const marketContext = readJson("docs/examples/level-intelligence/sample-market-context.json");
const report = buildLevelIntelligenceReport({ output, sessionFacts, volumeFacts, volumeShelves, marketContext });
const outPath = "docs/examples/level-intelligence/latest-level-intelligence-report-with-facts.json";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
'@ | npx tsx -
```

Then the quality audit was rerun with both the level output and intelligence report:

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --level-intelligence-report docs/examples/level-intelligence/latest-level-intelligence-report-with-facts.json --format text --out docs/examples/level-intelligence/latest-level-quality-audit-with-intelligence.txt
```

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --level-intelligence-report docs/examples/level-intelligence/latest-level-intelligence-report-with-facts.json --format json --out docs/examples/level-intelligence/latest-level-quality-audit-with-intelligence.json
```

## Output Files

- `docs/examples/level-intelligence/latest-level-intelligence-report-with-facts.json`
- `docs/examples/level-intelligence/latest-level-quality-audit-with-intelligence.txt`
- `docs/examples/level-intelligence/latest-level-quality-audit-with-intelligence.json`

## Comparison Against Previous Audit

Previous audit from `docs/43_LEVEL_QUALITY_AUDIT_REVIEW.md`:

- Used only `LevelEngineOutput`.
- Enriched / unenriched: `0 / 8`.
- Session / volume / shelf / market-context confluence: `0 / 0 / 0 / 0`.
- Diagnostics included `level_intelligence_report_missing`, `levels_without_context_present`, and `unenriched_levels_present`.
- Extension coverage warnings were present.

Current intelligence-backed audit:

- Used `LevelEngineOutput` plus facts-rich `LevelIntelligenceReport`.
- Enriched / unenriched remains `0 / 8`.
- Session / volume / shelf / market-context confluence improved to `5 / 8 / 4 / 8`.
- Weak-context levels decreased from present to `0`.
- Diagnostics no longer include `level_intelligence_report_missing` or `levels_without_context_present`.
- Diagnostics still include `unenriched_levels_present`.
- Extension coverage warnings remain present.

## Strongest Level Observations

The strongest levels stayed the same because the audit did not change scoring or level selection:

- `3.75` major resistance, audit score `0.88`, now with session, volume, shelf, and market-context confluence.
- `3.20` major support, audit score `0.86`, now with session, volume, and market-context confluence.
- `3.60` intermediate resistance, audit score `0.74`, now with session, volume, shelf, and market-context confluence.

The facts-rich report improves the explanation surface around those levels, but it does not change their runtime scores or bucket membership.

## Weakest And Context Observations

The weakest levels stayed the same:

- `3.40` intraday support, audit score `0.62`.
- `3.50` intraday resistance, audit score `0.66`.
- `2.95` support extension, audit score `0.69`.

The intelligence report materially improves context coverage:

- `3.40` intraday support now carries session, volume, shelf, and market-context confluence.
- `3.50` intraday resistance carries volume and market-context confluence, but no nearby session or shelf confluence.
- `2.95` support extension and `4.10` resistance extension carry volume and market-context confluence, but no nearby session or shelf confluence.

This makes the remaining issue clearer: the weaker levels are not context-free anymore, but several still lack nearby shelf/session support.

## Extension Ladder Observations

Extension coverage did not change:

- Support extensions: `1`
- Resistance extensions: `1`
- Downside coverage: `13.7427%`
- Upside coverage: `19.883%`

Warnings remain:

- `limited_downside_extension_coverage`
- `limited_upside_extension_coverage`

The intelligence layer helps explain the extension levels, but it does not close the extension coverage gap. Extension coverage still deserves a separate replay-based review before any tuning.

## Nearby Coverage Observations

Nearby coverage remains usable around reference price `3.42`:

- Nearest support: `3.40` intraday support, `0.5848%` away.
- Nearest resistance: `3.50` intraday resistance, `2.3392%` away.
- Nearby support count: `3`.
- Nearby resistance count: `2`.

The nearby support now has richer confluence from session, volume, shelf, and market context. The nearby resistance has less confluence because it lacks nearby session and shelf facts in this sample.

## Level-Quality Issues Now Clearer

The facts-rich audit suggests the basic sample map is structurally usable, but three issues remain visible:

1. `enrichedAnalysis` metadata is still absent on all sample levels.
2. Extension coverage remains limited on both sides of the reference price.
3. Some levels, especially the nearby resistance and extension levels, lack nearby session or shelf confluence despite having volume and market-context facts.

No clustered or duplicate zones were detected. No stale levels were detected.

## Next Recommended Gate

Do not change detection, clustering, scoring, ranking, or selection yet based on this single sample.

Recommended next gate: explanation-only and sample coverage tuning.

Specifically:

- Add or reuse a stable facts-aware way to generate `LevelIntelligenceReport` artifacts without an inline command.
- Run the quality audit on more than one sample, including at least one low-price runner and one choppy/low-quality setup.
- Compare whether extension coverage warnings persist across realistic fixtures.
- Only after replay/sample coverage confirms a repeated issue, create a focused extension coverage tuning gate or clustering/noise tuning gate.

For this sample, the intelligence/confluence layer improved the audit enough that no immediate support/resistance detection change is justified.
