# Synthetic Extension Wording Review

## Purpose

This review verifies that synthetic continuation-map extensions are now visible and clearly labeled in the Level Intelligence profile, formatted report, and compact Discord preview presentation.

This gate changes wording and presentation only. It does not change support/resistance detection, extension generation, surfaced buckets, nearest levels, special levels, scoring, alerts, monitoring, Discord posting, or trader-context behavior.

## Inputs Used

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

The saved sample `LevelEngineOutput` predates synthetic extension metadata. For this review, a temporary review-only output was regenerated at:

- `%TEMP%/level-intelligence-synthetic-output.json`

That temporary output reuses the saved sample surfaced buckets and existing real extension candidates, then applies current main synthetic extension fallback behavior. It is not committed as a new fixture.

## Commands Run

Generated the temporary synthetic `LevelEngineOutput` and refreshed the Level Intelligence report:

```bash
npx tsx - docs/examples/level-intelligence/sample-level-engine-output.json docs/examples/level-intelligence/sample-session-facts.json docs/examples/level-intelligence/sample-volume-facts.json docs/examples/level-intelligence/sample-volume-shelves.json docs/examples/level-intelligence/sample-market-context.json $env:TEMP/level-intelligence-synthetic-output.json docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json
```

Regenerated compact Discord preview text:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

Regenerated compact Discord preview JSON:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --format json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.json
```

Regenerated level quality audit text:

```bash
npx tsx src/scripts/run-level-quality-audit.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --level-intelligence-report docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json --format text --out docs/examples/level-intelligence/latest-level-quality-audit-synthetic.txt
```

Regenerated level quality audit JSON:

```bash
npx tsx src/scripts/run-level-quality-audit.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --level-intelligence-report docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json --format json --out docs/examples/level-intelligence/latest-level-quality-audit-synthetic.json
```

Validation:

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-synthetic-extension-generation.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-profile.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-report-formatter.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-discord-preview.test.ts
npm test
```

## Generated Outputs

- `docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.txt`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.json`
- `docs/examples/level-intelligence/latest-level-quality-audit-synthetic.txt`
- `docs/examples/level-intelligence/latest-level-quality-audit-synthetic.json`

## Wording Changes Verified

Synthetic continuation-map extension levels now carry profile metadata:

- `extension.source = synthetic_continuation_map`
- `extension.label = Synthetic continuation map`
- `extension.isSyntheticContinuationMap = true`
- evidence limitations remain explicit, including no historical touch/rejection history and no historical confluence

Formatted report output now includes:

- `Extension source: Synthetic continuation map; forward-planning extension; not historical support/resistance; limited evidence/no historical touches.`
- `Extension generation: round number ladder`
- `Extension evidence limits: real extension coverage below threshold; not historical support/resistance; no touch or rejection history; no historical confluence`

Historical candidate extensions now show:

- `Extension source: Historical candidate extension.`

They do not receive synthetic continuation-map wording.

## Discord Preview Result

The compact Discord preview is now 3 messages with no truncation.

Synthetic levels are visible in compact mode:

- support synthetic continuation-map extension at `2.35`
- resistance synthetic continuation-map extension at `4.45`

Each synthetic row is distinguishable from the real historical candidate extension row. The synthetic label is visible directly in the extension sections, not only implied by counts or IDs.

## Quality Notes

- Readability remains acceptable for test-channel review.
- Message count increased from 2 to 3 because compact mode now includes both real and synthetic extension rows.
- No truncation was introduced.
- Synthetic extensions remain neutral, facts-only, and explicitly marked as forward-planning continuation-map levels.
- VWAP and shelves remain facts-only.
- No Discord posting behavior changed.
- No extension generation behavior changed.

## Wording Scan

The generated synthetic preview/report artifacts were scanned for forbidden trading/coaching/grading wording:

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

The synthetic continuation-map wording is now clear enough for local review and test-channel preview inspection.

Recommended next gate: `integrate_synthetic_extension_labels_into_test_alert_flow`.

That gate can review whether the same labels remain clear in the explicit test-send path without changing live Discord posting defaults.
