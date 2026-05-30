# Synthetic Extension Discord Ready Review

## Purpose

This review verifies the current `main` Level Intelligence Discord preview after synthetic continuation-map wording improvements. The goal is to decide whether the preview is clear enough for the existing Discord test-channel flow.

This is a review/artifact gate only. It does not change support/resistance detection, LevelEngine output behavior beyond already-accepted synthetic extension fallback behavior, runtime mode defaults, surfaced buckets, nearest levels, special levels, scoring, alerts, monitoring, Discord posting, or trader-context behavior.

## Inputs Used

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

The saved sample `LevelEngineOutput` predates synthetic extension metadata. For this review, a temporary review-only output was regenerated at:

- `%TEMP%/level-intelligence-synthetic-output.json`

That temporary output keeps the saved sample surfaced buckets and existing historical extension candidates, then reapplies current main synthetic extension fallback behavior. It is not committed as a fixture.

## Commands Run

Generated the temporary synthetic `LevelEngineOutput` and refreshed the Level Intelligence report:

```bash
npx tsx - docs/examples/level-intelligence/sample-level-engine-output.json docs/examples/level-intelligence/sample-session-facts.json docs/examples/level-intelligence/sample-volume-facts.json docs/examples/level-intelligence/sample-volume-shelves.json docs/examples/level-intelligence/sample-market-context.json $env:TEMP/level-intelligence-synthetic-output.json docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json
```

Generated compact Discord preview text:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

Generated compact Discord preview JSON:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --format json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.json
```

Validation:

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-discord-preview.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-synthetic-extension-generation.test.ts
npm test
```

## Generated Outputs

- `docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.txt`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.json`

## Preview Result

- Message count: 3
- Truncated: no
- Synthetic continuation-map label visible: yes
- Historical candidate extension label visible: yes
- Discord posting attempted: no

Synthetic rows are shown in the compact extension sections:

- support synthetic continuation-map extension at `2.35`
- resistance synthetic continuation-map extension at `4.45`

Each synthetic row includes:

- `Synthetic continuation map`
- `forward-planning extension`
- `not historical support/resistance`
- `limited evidence/no historical touches`
- `round number ladder`
- evidence limits including no touch/rejection history and no historical confluence

The real historical extension rows remain distinguishable with:

- `Historical candidate extension`
- historical touch/reaction facts

## Wording And Formatting Notes

The preview is clear enough for Discord test-channel use. The synthetic rows are visibly separated from real historical candidate extension rows, and the limitations are explicit without adding action/recommendation language.

The message count increased from the older 2-message compact preview to 3 messages because extension sections now show both real and synthetic rows. This is acceptable for test-channel review because there is no truncation and the third message contains the important extension map context.

Remaining issue: the extension section is denser than the older compact view. That density is intentional for this gate because the synthetic continuation-map labels need to be visible during test-channel review.

## Forbidden Wording Scan

The generated Level Intelligence report and Discord preview artifacts were scanned for:

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

No matches were found.

## Decision

The current synthetic extension Discord preview is ready for test-channel use.

Recommended next gate: `test_channel_send_with_synthetic_preview`.

That gate should use the existing explicit test-send path and configured test Discord destination, without changing live Discord posting defaults.
