# Level Intelligence Test Alert Flow Integration Design

## Purpose

Design how the synthetic Level Intelligence Discord preview can be wired into the existing test alert flow without changing current support/resistance detection, LevelEngine output, runtime defaults, alert behavior, monitoring behavior, Discord production behavior, or trader-context behavior.

This is a documentation/design gate only. No code behavior changed in this gate.

## Current Alert And Discord Flow

The current live/test alert path is centered on the manual watchlist runtime:

1. `ManualWatchlistRuntimeManager` seeds levels through `LevelEngine.generateLevels(...)` and stores the resulting `LevelEngineOutput` in `LevelStore`.
2. `WatchlistMonitor` evaluates live price updates against active support/resistance zones from `LevelStore`.
3. `WatchlistMonitor` emits `MonitoringEvent` objects to `ManualWatchlistRuntimeManager.handleMonitoringEvent`.
4. `AlertIntelligenceEngine.processEvent(event, levels)` scores, filters, formats, and applies posting policy.
5. If an alert is approved, `formatIntelligentAlertAsPayload(...)` converts it into an `AlertPayload`.
6. `DiscordAlertRouter.routeAlert(threadId, payload)` sends the existing alert through the configured gateway.
7. `DiscordRestThreadGateway` posts to Discord REST only when `DISCORD_BOT_TOKEN` and `DISCORD_WATCHLIST_CHANNEL_ID` are configured.
8. `LocalDiscordThreadGateway` is the fallback local persisted gateway when production Discord config is absent.

Level snapshots and next-level extension messages are separate paths:

- `DiscordAlertRouter.routeLevelSnapshot(...)`
- `DiscordAlertRouter.routeLevelExtension(...)`

Those paths currently send compact level lists, not Level Intelligence reports.

## Existing Preview/Test-Send Flow

The Level Intelligence Discord preview path is already isolated:

- `src/scripts/run-level-intelligence-discord-preview.ts`
- `src/lib/alerts/level-intelligence-discord-preview-runner.ts`
- `src/lib/alerts/level-intelligence-discord-preview.ts`

The preview runner:

- reads an existing `LevelEngineOutput` JSON
- optionally reads facts JSON files
- builds a `LevelIntelligenceReport`
- formats Discord-sized preview messages
- defaults to dry-run
- sends only when `--send-test` is explicit and a test webhook URL is supplied
- does not import the live Discord router/gateway
- does not call LevelEngine
- does not generate levels

The current synthetic-included sample is:

```text
docs/examples/level-intelligence/sample-level-engine-output-synthetic.json
```

The latest preview from that sample is 3 messages, not truncated, with synthetic continuation-map labels visible.

## Where LevelEngineOutput Is Available

`LevelEngineOutput` is available in the live/test alert flow from `LevelStore`:

- `ManualWatchlistRuntimeManager.seedLevelsForSymbol(...)` stores output with `levelStore.setLevels(output)`.
- `ManualWatchlistRuntimeManager.handleMonitoringEvent(...)` already reads `const levels = this.options.levelStore.getLevels(event.symbol)`.
- `AlertIntelligenceEngine.processEvent(event, levels)` already receives that same output.

This is the safest source for a test preview because it is the exact level map already used by the alert flow. It includes accepted baseline synthetic continuation-map extensions in `extensionLevels` when the current main LevelEngine output generated them.

## Where A LevelIntelligenceReport Can Be Built

The report can be built after `levels` is read from `LevelStore` and only when an alert has already passed existing filtering/posting policy.

The pure path is:

1. `buildLevelIntelligenceReport({ output: levels })`
2. `formatLevelIntelligenceReport(report)`
3. `formatLevelIntelligenceDiscordPreview(formattedReport)`

Alternatively, a small in-memory helper can reuse the existing preview-runner builder:

```text
buildLevelIntelligenceDiscordPreviewReviewResult(output, options)
```

That helper already builds a preview from a supplied `LevelEngineOutput` and optional facts input. A runtime sidecar should call a pure builder with the in-memory output rather than writing temporary JSON files or calling the CLI runner.

## Facts Availability At That Stage

Facts are partially available today:

- `LevelEngineOutput` is available through `LevelStore`.
- Alert `MonitoringEvent` context is available.
- Current live price is reflected in the event trigger price and in the stored level metadata reference price.

Facts are not currently carried as a reusable object in `ManualWatchlistRuntimeManager`:

- `SessionMarketFacts`
- `VolumeMarketFacts`
- `VolumeShelf[]`
- `MarketContextProfile`
- `MarketContextFactsBundle`

The first integration should therefore treat facts as optional. It can produce a safe output-only Level Intelligence preview first. A later gate can add a test-only fact provider if we want the alert-flow preview to match the richer fixture/facts review output.

## Safest Integration Point

The safest integration point is a test-only sidecar after an alert has already been approved by the existing alert intelligence path:

```text
ManualWatchlistRuntimeManager.handleMonitoringEvent
  -> AlertIntelligenceEngine.processEvent(event, levels)
  -> if result.formatted exists:
       route existing alert exactly as today
       optionally invoke Level Intelligence preview sidecar
```

This keeps existing alert behavior intact:

- existing alert filtering remains the gate
- existing alert body remains unchanged
- existing `DiscordAlertRouter.routeAlert(...)` remains unchanged
- production Discord gateway remains unchanged
- failures in the preview sidecar must not block or retry the existing alert

The sidecar should be separate from `DiscordAlertRouter` at first. It should use the explicit test webhook preview sender rather than production bot/channel routing.

## Configuration Needed

Recommended test-only configuration:

- `LEVEL_INTELLIGENCE_TEST_ALERT_PREVIEW_MODE=off|dry-run|send-test`
- `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL=<test webhook only>`
- optional `LEVEL_INTELLIGENCE_TEST_ALERT_PREVIEW_MAX_MESSAGE_LENGTH`

Defaults:

- mode defaults to `off`
- no send happens without both `send-test` mode and `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL`
- dry-run writes/logs preview output only

The existing `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` remains the test-send destination. It must not be hardcoded or committed.

## Proposed Integration Modes

### A. Dry-Run Only

Add an optional preview sidecar that builds the preview after an approved alert and logs a structured dry-run result.

Behavior:

- off by default
- no network calls
- no Discord send
- does not call LevelEngine
- uses `LevelStore` output only
- logs message count, truncation status, synthetic label visibility, and preview text or artifact path

This should be the first implementation gate.

### B. Sidecar Test-Channel Message

After dry-run review passes, allow the sidecar to send the preview messages to `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL`.

Behavior:

- requires explicit `send-test` config
- sends to test webhook only
- never uses production alert router
- sends after, not instead of, the existing alert
- failure is isolated and logged
- should include dedupe/cooldown to avoid sending a 3-message preview repeatedly for the same symbol/output/alert family

### C. Replace Current Test Alert Format Later

Only after test-channel review proves the sidecar output is safer and more useful, a later design can decide whether a test-only alert format should be replaced.

This mode is not recommended now. The existing alert format should remain untouched until sidecar behavior is proven.

## Risks

- Preview spam: a 3-message preview per approved alert can become noisy.
- Duplicate previews: repeated alerts for the same symbol and same `LevelEngineOutput.generatedAt` could resend the same map.
- Missing facts: alert-flow preview may initially be less rich than fixture previews because session/volume/shelf facts are not currently stored in runtime.
- Failure coupling: webhook failures must not affect existing alert delivery.
- User confusion: synthetic continuation-map extensions must remain clearly labeled as not historical support/resistance.
- Secret handling: webhook URLs must stay in local environment variables only.
- Production drift: test sidecar must not import or modify production Discord routing defaults.

## Tests Required Before Implementation

The first implementation gate should add focused tests proving:

- default mode is off
- dry-run mode does not send
- send-test mode requires explicit webhook config
- existing `routeAlert(...)` payload and call count are unchanged
- sidecar is invoked only after `AlertIntelligenceEngine` approves an alert
- sidecar is not invoked for filtered/suppressed alerts
- sidecar uses the existing `LevelEngineOutput` from `LevelStore`
- sidecar does not call `LevelEngine`
- synthetic continuation-map labels are visible in generated preview output
- historical candidate extension labels remain visible
- webhook failure is caught/logged and does not reject existing alert handling
- no recommendation/coaching/grading language appears
- runtime mode `old` remains default

If a fact provider is added later, separate tests should prove facts remain facts-only and do not affect support/resistance selection or extension generation.

## Recommended Next Implementation Gate

Recommended next gate:

```text
wire_synthetic_preview_into_test_alert_flow_dry_run
```

That gate should add the off-by-default dry-run sidecar only. It should not send to Discord yet, should not replace existing alerts, and should not change alert routing defaults.

After the dry-run sidecar is reviewed, the next gate can enable explicit `send-test` sidecar delivery to the configured test webhook.
