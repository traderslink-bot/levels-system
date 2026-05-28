# Level Intelligence Discord Test Send Review

Date: 2026-05-28

## Purpose

Review the compact facts-included Level Intelligence Discord preview through the existing dry-run and explicit test-send path.

This review does not change support/resistance detection, `LevelEngine` output, runtime defaults, alert routing, monitoring, Discord production behavior, trader-context behavior, or level scoring.

## Input Files

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

## Dry-Run Command

```powershell
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-with-facts.txt
```

## Test-Send Command

The test-send command was skipped because `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` was not present in the environment.

Command reserved for the configured test destination:

```powershell
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --send-test
```

## Environment Check

- `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL`: not present
- Test send attempted: no
- Discord send result: skipped due to missing test webhook configuration

## Preview Result

- Output path: `docs/examples/level-intelligence/latest-discord-preview-with-facts.txt`
- Preview messages: `2`
- Truncated: `false`
- Readability: usable for test-channel review

The compact output preserves:

- symbol and level-count summary,
- major support and major resistance,
- intermediate support and intermediate resistance,
- intraday support and intraday resistance,
- extension support and extension resistance,
- key session facts,
- key volume context,
- nearby volume shelf facts,
- diagnostics,
- facts-only safety flags.

## Wording Review

Forbidden wording scan was run against `docs/examples/level-intelligence/latest-discord-preview-with-facts.txt`.

No forbidden wording was found for:

- `buy`
- `sell`
- `enter`
- `exit`
- `good trade`
- `bad trade`
- `mistake`
- `should`
- `coaching`
- `p/l`
- `giveback`
- `grading`

## Next Recommended Gate

Run the same explicit `--send-test` command after the test webhook environment variable is configured. If the test-channel rendering remains readable and facts-only, the next implementation gate can plan opt-in live Discord integration without changing production alert behavior by default.
