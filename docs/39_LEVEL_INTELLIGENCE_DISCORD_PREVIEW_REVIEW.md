# Level Intelligence Discord Preview Review

Date: 2026-05-28

## Input Source

No saved `LevelEngineOutput` JSON fixture was present on latest `main`. I created a small deterministic review fixture:

- `docs/examples/level-intelligence/sample-level-engine-output.json`

The fixture represents one symbol, `SAMP`, with all existing LevelEngineOutput transport buckets populated:

- major support
- major resistance
- intermediate support
- intermediate resistance
- intraday support
- intraday resistance
- extension support
- extension resistance

It is a fixture-style output for reviewing the Level Intelligence Discord preview pipeline only. It does not change runtime behavior, level detection, monitoring, alerting, or Discord live behavior.

## Commands Run

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --out docs/examples/level-intelligence/sample-discord-preview.txt
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --format json --out docs/examples/level-intelligence/sample-discord-preview.json
rg -n -i "\b(buy|sell|enter|exit|good trade|bad trade|mistake|should|coaching|p/l|giveback|grading)\b" docs/examples/level-intelligence/sample-discord-preview.txt docs/examples/level-intelligence/sample-discord-preview.json docs/examples/level-intelligence/sample-level-engine-output.json
npx tsc --noEmit
npm test
```

## Preview Output Saved

- Text preview: `docs/examples/level-intelligence/sample-discord-preview.txt`
- JSON preview: `docs/examples/level-intelligence/sample-discord-preview.json`

The dry-run preview produced five Discord-sized preview messages and reported `Truncated: no`.

## Quality Assessment

The output is usable for review. It clearly separates summary, major support, major resistance, intermediate levels, intraday levels, extension levels, diagnostics, and safety notes. The preview preserves the support/resistance map and includes level facts such as zone width, source timeframe, source type, freshness, reaction scores, distance from reference price, round-number facts, enriched state, confidence, and extension tags.

The generated messages are readable and sectioned well enough for a test-channel review pass. Extension support and extension resistance are present and clearly labeled as extension levels. Safety notes correctly state that the level output is unchanged, the report is facts-only, VWAP is facts-only, volume shelves are facts-only, and there is no runtime behavior change.

No trade-instruction, coaching, grading, journal, P/L, or giveback wording was found in the generated preview outputs.

## Issues Found

- The preview currently shows `session_facts_missing`, `volume_facts_missing`, and `no_nearby_volume_shelf` because the runner accepts only a `LevelEngineOutput` JSON file in this first review path.
- `generatedAt` is shown as an epoch timestamp. That is deterministic, but a future presentation pass could add a human-readable timestamp beside it.
- The fixture produced five messages for eight levels. This is acceptable for review, but larger live symbols may need a compact preview mode or stricter section limits before any test-channel posting workflow.
- Session/volume/shelf confluence is not visible yet unless those facts are supplied by a future optional input path.

## Next Implementation Gate

Recommended next gate: add an optional facts-input path to the dry-run/shadow preview runner so review output can include already-built `SessionMarketFacts`, `VolumeMarketFacts`, `VolumeShelf[]`, and/or `MarketContextFactsBundle` without changing runtime behavior or live Discord behavior.

That gate should remain preview-only and should keep existing live alerts untouched. It should not change level selection, buckets, nearest levels, extension levels, special levels, strength labels, enrichedAnalysis scoring, monitoring behavior, trader-context behavior, or LevelEngine default output.
