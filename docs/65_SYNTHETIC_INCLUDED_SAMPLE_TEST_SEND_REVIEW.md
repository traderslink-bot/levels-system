# Synthetic Included Sample Test Send Review

## Purpose

This review verifies the Discord preview/test-send path using a committed `LevelEngineOutput` sample that already includes synthetic continuation-map extension rows from current main behavior.

This is a review/artifact gate only. It does not change support/resistance detection, LevelEngine output behavior beyond already-accepted synthetic extension fallback behavior, runtime mode defaults, surfaced buckets, nearest levels, special levels, alerts, monitoring, Discord posting defaults, or trader-context behavior.

## Inputs Used

- `docs/examples/level-intelligence/sample-level-engine-output-synthetic.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

The synthetic-included sample was generated from the existing saved sample:

- `docs/examples/level-intelligence/sample-level-engine-output.json`

The generation step kept the saved sample surfaced buckets and existing historical extension candidates unchanged, then reapplied current main extension fallback behavior with `buildLevelExtensions`. The saved synthetic sample now includes both historical candidate extension rows and synthetic continuation-map extension rows.

## Commands Run

Generated the synthetic-included `LevelEngineOutput` sample:

```bash
npx tsx -
```

The inline review helper read `docs/examples/level-intelligence/sample-level-engine-output.json`, called current main `buildLevelExtensions`, and wrote:

```text
docs/examples/level-intelligence/sample-level-engine-output-synthetic.json
```

Regenerated the Discord preview text from the synthetic-included sample:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output-synthetic.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

Regenerated the Discord preview JSON from the synthetic-included sample:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output-synthetic.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --format json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.json
```

Checked whether test-send configuration was present:

```powershell
if ($env:LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL) { 'present' } else { 'missing' }
```

The explicit test-send command was skipped because `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` was not present:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output-synthetic.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --send-test
```

Validation:

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-discord-preview.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-synthetic-extension-generation.test.ts
npm test
```

## Synthetic Rows In Input JSON

Synthetic extension rows are present in `sample-level-engine-output-synthetic.json`:

- support synthetic continuation-map extension: `SAMP-synthetic-support-extension-1-2p3500`
- resistance synthetic continuation-map extension: `SAMP-synthetic-resistance-extension-1-4p4500`

Historical extension rows remain present and distinguishable:

- support historical candidate extension: `SAMP-extension-support-295`
- resistance historical candidate extension: `SAMP-extension-resistance-410`

## Preview Result

- Output text: `docs/examples/level-intelligence/latest-discord-preview-synthetic.txt`
- Output JSON: `docs/examples/level-intelligence/latest-discord-preview-synthetic.json`
- Message count: 3
- Truncated: no
- Synthetic continuation-map labels visible: yes
- Historical candidate labels visible: yes
- Test send attempted: no
- Test send result: skipped because config was missing

The preview shows synthetic rows with:

- `Synthetic continuation map`
- `forward-planning extension`
- `not historical support/resistance`
- `limited evidence/no historical touches`
- `round number ladder`
- evidence limits that explicitly state no touch/rejection history and no historical confluence

Historical candidate extension rows remain labeled as `Historical candidate extension` and retain their historical reaction facts.

## Test Channel Readiness

The output is now valid for test-channel use because the preview runner reads a committed synthetic-included `LevelEngineOutput` fixture rather than a temporary synthetic output. The preview remains readable at 3 messages with no truncation.

No live Discord posting was added. No production alert routing, monitoring, LevelEngine runtime path, or trader-context path was changed.

## Decision

The synthetic-included sample fixes the prior fixture gap. The current blocker for an actual test-channel delivery is configuration: `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` was not present.

Recommended next gate: `configure_test_webhook_and_send`.
