# Level Intelligence Alert Preview Dry Run Review

## Purpose

Verify the off-by-default Level Intelligence alert preview dry-run sidecar from the existing alert flow. This review confirms the sidecar can generate useful synthetic-aware preview output after an approved alert while leaving the existing alert payload, Discord router behavior, and runtime defaults unchanged.

This gate is review-only. No production behavior changed in this gate.

## Fixture And Setup

The deterministic fixture is the committed alert-preview dry-run test harness:

```text
src/tests/level-intelligence-alert-preview-dry-run.test.ts
```

The fixture seeds `LevelStore` with an `ALBT` `LevelEngineOutput` containing:

- one intraday resistance zone at `2.45`
- one synthetic continuation-map resistance extension at `3.20`
- `extensionMetadata.extensionSource = "synthetic_continuation_map"`
- notes that state the extension is forward-planning only and not historical support/resistance

The approved monitoring event is a deterministic `ALBT` breakout through the seeded resistance. Preview output is captured through the injected `onPreview` sink. No Discord webhook, Discord API, or production Discord gateway is used.

## Commands Run

```text
@'<inline deterministic ManualWatchlistRuntimeManager harness>'@ | npx tsx -
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-intelligence-alert-preview-dry-run.test.ts
npx tsx --test --test-timeout=90000 src/tests/manual-watchlist-runtime-manager.test.ts
npm test
```

The inline harness mirrors the committed fixture and captures the generated `LevelIntelligenceAlertPreviewDryRunResult` summary for this review.

## Dry-Run Result

- Preview generated after approved alert: yes
- Symbol: `ALBT`
- Preview output location: injected `onPreview` result in tests; console output when `LEVEL_INTELLIGENCE_ALERT_PREVIEW_DRY_RUN=true` is enabled without an `onPreview` sink
- Message count: 1
- Truncation: false
- Synthetic continuation-map label visible: yes
- `not historical support/resistance` wording visible: yes
- Synthetic level id visible: `SYNX-synthetic-resistance-extension-1-3p2000`
- Forbidden recommendation/coaching/grading wording: not found by the focused test scan

Captured preview summary:

```text
ALBT level intelligence alert preview (dry-run)
Messages: 1
Truncated: no
Synthetic continuation map label: visible
Not historical support/resistance label: visible
```

## Disabled Default

Disabled default behavior remains intact:

- `resolveLevelIntelligenceAlertPreviewDryRun()` returns `false`.
- Without dry-run options, an approved alert routes normally and no preview is logged.
- With `enabled: false`, a supplied preview builder is not called.
- `runtimeMode` still defaults to `old`.

## Alert Payload And Router Behavior

The existing alert payload remained unchanged in the deterministic approved-alert fixture:

```text
Title: ALBT breakout
Body: breakout resistance 2.40-2.50 | strong outermost | fresh | refreshed
```

The dry-run sidecar does not call Discord posting APIs and does not send through `DiscordAlertRouter`. Existing alert routing remains the only alert route. The fixture observed the existing alert route once and no level-extension route calls from the sidecar.

Any existing baseline snapshot behavior from symbol activation is separate from the preview sidecar and was not changed by this gate.

## Error Isolation

The focused test forces the preview builder to throw `synthetic preview fixture failure`. The existing alert still routes once, and the preview error is captured through the dry-run `onError` path. This confirms preview-generation failures are isolated from the approved alert flow.

## Output Quality

The dry-run output is useful for a first alert-flow review:

- It identifies the alert id, event id, thread id, and source `LevelEngineOutput.generatedAt`.
- It includes the compact Level Intelligence preview body.
- It clearly separates the surfaced intraday resistance from the synthetic extension.
- It labels the synthetic extension as a synthetic continuation map, a forward-planning extension, and not historical support/resistance.
- It includes safety text confirming the path is preview/test only and does not post to Discord.

The fixture is intentionally small, so the message count is lower than the richer facts-based Discord preview samples. A later send-test sidecar review should use a fuller runtime fixture or current synthetic-included sample when test webhook configuration is available.

## Decision

The dry-run sidecar is ready for the next gate. It generated the expected preview after an approved alert, stayed disabled by default, left the existing alert payload unchanged, did not post to Discord, and isolated preview errors from the alert flow.

Recommended next gate:

```text
send_level_intelligence_sidecar_to_test_channel
```

That gate should remain explicit and test-only, require webhook configuration, and continue to avoid production Discord router changes.
