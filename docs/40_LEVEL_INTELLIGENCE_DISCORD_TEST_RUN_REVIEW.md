# Level Intelligence Discord Test Run Review

Date: 2026-05-28

## Input JSON Path

No saved `LevelEngineOutput` fixture was present on latest `main`, so this gate created a small deterministic fixture:

- `docs/examples/level-intelligence/sample-level-engine-output.json`

The fixture includes all existing LevelEngineOutput transport buckets:

- major support
- major resistance
- intermediate support
- intermediate resistance
- intraday support
- intraday resistance
- extension support
- extension resistance

## Commands Run

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --out docs/examples/level-intelligence/latest-discord-preview.txt
if ($env:LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL) { 'present' } else { 'missing' }
rg -n -i "\b(buy|sell|enter|exit|good trade|bad trade|mistake|should|coaching|coach|p/l|giveback|grading)\b" docs/examples/level-intelligence/latest-discord-preview.txt docs/examples/level-intelligence/sample-level-engine-output.json
npx tsc --noEmit
npm test
```

## Output Path

Dry-run output was saved to:

- `docs/examples/level-intelligence/latest-discord-preview.txt`

## Test Send Status

Test send was not attempted because `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` was not available in the environment.

The runner stayed in dry-run mode and did not post to Discord.

## Quality Notes

The generated preview is readable and reviewable. It produced four Discord-sized dry-run messages with `Truncated: no`.

The output includes:

- symbol and summary
- major support and major resistance
- intermediate support and intermediate resistance
- intraday support and intraday resistance
- extension support and extension resistance
- diagnostics
- safety notes

The support/resistance sections are clear enough for a test-channel review. Extension levels are present and explicitly tagged as extension levels. Diagnostics and safety notes correctly state that session facts, volume facts, enriched analysis, and nearby volume shelves are missing from this fixture-only run, and that no live alert routing, monitoring, or LevelEngine runtime path was invoked.

No action, coaching, grading, journal, P/L, or giveback wording was found in the generated preview.

## Issues Found

- The preview still lacks richer session, volume, shelf, and market-context facts because this test used only a `LevelEngineOutput` fixture.
- The generated timestamp is shown as an epoch number. A future presentation pass could add a human-readable timestamp without changing runtime behavior.
- The fixture is deterministic but not from live market data. A later review should run the same dry-run path against a real captured LevelEngineOutput artifact before any production Discord wiring.

## Next Recommended Gate

Add optional facts-input support to the preview runner so test previews can include already-built `SessionMarketFacts`, `VolumeMarketFacts`, `VolumeShelf[]`, and/or `MarketContextFactsBundle`.

This should remain a preview/test-only path. It should not change support/resistance detection, LevelEngine default output, runtimeMode defaults, monitoring behavior, alert behavior, or production Discord behavior.
