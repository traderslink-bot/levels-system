# Synthetic Extension Test Channel Send Review

## Purpose

This review checks the explicit test-send path for the synthetic continuation-map Discord preview. It does not change live Discord behavior or production alert routing.

This is a review/artifact gate only. It does not change support/resistance detection, LevelEngine output behavior beyond already-accepted synthetic extension fallback behavior, runtime mode defaults, surfaced buckets, nearest levels, special levels, scoring, alerts, monitoring, Discord posting defaults, or trader-context behavior.

## Inputs Used

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

The saved sample `LevelEngineOutput` still predates synthetic extension metadata. The exact dry-run command requested for this gate was run against that saved output first. Because the preview runner reads existing `LevelEngineOutput` JSON and does not call LevelEngine, that direct saved-sample run showed the historical extension rows only.

For the synthetic preview readiness check, a temporary review-only output was regenerated at:

- `%TEMP%/level-intelligence-synthetic-output.json`

That temporary output keeps the saved sample surfaced buckets and existing historical extension candidates, then reapplies current main synthetic extension fallback behavior.

## Commands Run

Requested dry-run command against the saved sample output:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

Checked whether test-send configuration was present:

```powershell
if ($env:LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL) { 'present' } else { 'missing' }
```

Generated the temporary synthetic `LevelEngineOutput` and refreshed the synthetic Level Intelligence report:

```bash
npx tsx - docs/examples/level-intelligence/sample-level-engine-output.json docs/examples/level-intelligence/sample-session-facts.json docs/examples/level-intelligence/sample-volume-facts.json docs/examples/level-intelligence/sample-volume-shelves.json docs/examples/level-intelligence/sample-market-context.json $env:TEMP/level-intelligence-synthetic-output.json docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json
```

Regenerated the synthetic Discord preview text:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

Regenerated the synthetic Discord preview JSON:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --format json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.json
```

The explicit test-send command was skipped because `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` was not present:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --send-test
```

Validation:

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-discord-preview.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-synthetic-extension-generation.test.ts
npm test
```

## Test Send Status

- `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` present: no
- Test send attempted: no
- Test send result: skipped because config was missing
- Live Discord posting changed: no
- Existing alert routing invoked: no
- Existing monitoring path invoked: no

## Preview Result

- Message count: 3
- Truncated: no
- Synthetic continuation-map labels visible: yes
- Historical candidate labels visible: yes
- Output ready for test-channel flow: yes, when the test-send input is a current `LevelEngineOutput` that already includes synthetic extension rows

Synthetic rows remain visible in compact preview:

- support synthetic continuation-map extension at `2.35`
- resistance synthetic continuation-map extension at `4.45`

Historical extension rows remain distinguishable:

- support historical candidate extension at `2.95`
- resistance historical candidate extension at `4.10`

## Notes

The existing preview runner is intentionally safe: it reads a supplied `LevelEngineOutput` JSON and does not call LevelEngine or generate new levels. That means the saved sample fixture does not display synthetic rows unless a current synthetic-included `LevelEngineOutput` is supplied.

The generated synthetic preview remains readable and ready for a test channel. No formatting tuning is needed before the first explicit test-channel send, assuming the input output includes the synthetic extensions.

## Decision

The test-send was skipped only because `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` was missing.

Recommended next gate: `wire_synthetic_preview_into_test_alert_flow`.

That gate should make sure the explicit test-send/review flow receives a current synthetic-included `LevelEngineOutput`, while keeping live Discord posting defaults unchanged.
