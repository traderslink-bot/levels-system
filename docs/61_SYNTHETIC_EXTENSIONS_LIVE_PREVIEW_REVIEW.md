# Synthetic Extensions Live Preview Review

Date: 2026-05-29

## Purpose

This review checks how accepted synthetic continuation-map extensions appear in Level Intelligence output, compact Discord preview output, and the level quality audit.

This is a review/test-channel gate only. It does not change support/resistance detection, surfaced buckets, nearest surfaced levels, special levels, real-level scoring, alerts, monitoring, Discord behavior, trader-context behavior, or runtime defaults.

## Input Files

Base sample and facts:

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

The saved sample `LevelEngineOutput` predates synthetic extension metadata. For this review, a temporary review-only `LevelEngineOutput` was generated at:

- `%TEMP%/level-intelligence-synthetic-output.json`

That temporary output reuses the saved sample's surfaced buckets and existing extension candidates, then applies the current main synthetic extension fallback. It is not committed as a new sample fixture.

## Commands Run

Generated the temporary synthetic `LevelEngineOutput` and Level Intelligence report:

```bash
npx tsx $env:TEMP/generate-synthetic-live-preview-inputs.ts docs/examples/level-intelligence/sample-level-engine-output.json docs/examples/level-intelligence/sample-session-facts.json docs/examples/level-intelligence/sample-volume-facts.json docs/examples/level-intelligence/sample-volume-shelves.json docs/examples/level-intelligence/sample-market-context.json $env:TEMP/level-intelligence-synthetic-output.json docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json
```

Generated compact Discord preview:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --format json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.json
```

Generated level quality audit:

```bash
npx tsx src/scripts/run-level-quality-audit.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --level-intelligence-report docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json --format text --out docs/examples/level-intelligence/latest-level-quality-audit-synthetic.txt
```

```bash
npx tsx src/scripts/run-level-quality-audit.ts --level-output $env:TEMP/level-intelligence-synthetic-output.json --level-intelligence-report docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json --format json --out docs/examples/level-intelligence/latest-level-quality-audit-synthetic.json
```

Verification:

```bash
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-synthetic-extension-generation.test.ts
npm test
```

## Generated Outputs

- `docs/examples/level-intelligence/latest-level-intelligence-report-synthetic.json`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.txt`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.json`
- `docs/examples/level-intelligence/latest-level-quality-audit-synthetic.txt`
- `docs/examples/level-intelligence/latest-level-quality-audit-synthetic.json`

## Synthetic Extension Coverage In Sample

The temporary synthetic output had four extension levels:

| Side | Historical candidate | Synthetic continuation-map |
| --- | ---: | ---: |
| Support | `2.95` | `2.35` |
| Resistance | `4.10` | `4.45` |

The audit confirms:

- Support extensions: 2
- Resistance extensions: 2
- Downside coverage: 31.2865%
- Upside coverage: 30.117%
- Extension warnings: none

The synthetic levels have zero touches, zero confluence, weak strength labels, and no enriched analysis. That keeps them distinct from stronger historical candidate extension levels in the audit.

## Level Intelligence Report Findings

Synthetic extension profiles are present in `latest-level-intelligence-report-synthetic.json` by id:

- `SAMP-synthetic-support-extension-1-2p3500`
- `SAMP-synthetic-resistance-extension-1-4p4500`

However, the current Level Intelligence profile shape does not expose `extensionMetadata.extensionSource`. The generated report shows the synthetic ids and zero-evidence fields, but it does not clearly say `synthetic_continuation_map`, `continuation-map`, or `forward-planning`.

This means the underlying `LevelEngineOutput` metadata is correct, but the Level Intelligence presentation layer does not yet carry the synthetic label forward clearly enough.

## Discord Preview Findings

The compact Discord preview generated:

- Message count: 2
- Truncated: no
- Output remained readable and compact.
- Facts stayed facts-only.
- No Discord posting occurred.

The preview summary shows extension counts as `extension S/R 2/2`, so the synthetic extension levels affect the counts.

But compact mode currently shows only the first extension level per side:

- Extension support shown: `2.95`
- Extension resistance shown: `4.10`

The synthetic extension rows at `2.35` and `4.45` are not visible in the compact Discord text. Because they are not visible, they are also not labeled as continuation-map / forward-planning in the preview.

## Label Clarity

Current state:

- Underlying temporary `LevelEngineOutput`: synthetic metadata present and clearly marked.
- Level quality audit: synthetic levels are visible as weak, zero-touch, zero-confluence extension levels, but not labeled by source.
- Level Intelligence report: synthetic ids are visible, but continuation-map metadata is not exposed.
- Compact Discord preview: synthetic rows are not visible, and no synthetic label is shown.

Synthetic extensions are distinguishable in source ids and audit scores, but not clearly enough in the human preview.

## Readability And Wording

The compact preview is readable:

- 2 messages
- no truncation
- clear major/intermediate/intraday sections
- facts-only safety line present
- no confusing Discord formatting issue found

The confusing part is omission rather than wording: compact preview counts four extension levels but displays only the historical candidate extension rows.

No buy/sell/enter/exit/coaching/grading wording was found in the generated Discord preview artifacts.

## Test-Channel Readiness

The current compact preview is acceptable for general level-intelligence test-channel review.

It is not yet acceptable for validating synthetic continuation-map labels in a test Discord channel, because synthetic rows are not visible in compact preview output and the presentation layer does not surface the synthetic label.

## Recommendation

Recommended next gate: `tune_synthetic_extension_wording`.

That gate can keep runtime behavior unchanged while carrying `extensionMetadata.extensionSource` into Level Intelligence profiles, report formatting, compact Discord preview sections, and level quality audit text. After that, `integrate_synthetic_extension_labels_into_test_alert_flow` can review the marked labels in the explicit test-send path.

No synthetic spacing changes are recommended from this preview review.

## Safety

- Support/resistance detection unchanged.
- LevelEngine default output changed only through already-accepted synthetic extension behavior.
- `runtimeMode` defaults unchanged.
- Surfaced bucket membership unchanged.
- Nearest surfaced levels unchanged.
- Special levels unchanged.
- strengthScore and strengthLabel for real levels unchanged.
- enrichedAnalysis scoring unchanged.
- Alert behavior unchanged.
- Monitoring behavior unchanged.
- Discord behavior unchanged.
- Trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
