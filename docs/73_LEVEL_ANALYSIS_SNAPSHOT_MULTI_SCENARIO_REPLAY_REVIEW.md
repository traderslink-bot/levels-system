# LevelAnalysisSnapshot Multi-Scenario Replay Review

## Scope

This review validates the stabilized `LevelAnalysisSnapshot` contract against five deterministic candle-data scenarios. The goal is to inspect factual chart-analysis output for TraderLink Intelligence / journal consumption.

No live data was fetched. No network calls were made. No Discord, alert, monitoring, trader-context, trade grading, coaching, P/L, giveback, behavior scoring, or journal behavior was added.

## Fixture Pack

Fixture root:

- `docs/examples/level-analysis-snapshot/fixtures/`

Scenarios:

- `low-price-runner`
- `clean-technical`
- `choppy-range`
- `thin-liquidity`
- `higher-priced`

Each scenario includes:

- `metadata.json`
- `5m-candles.json`
- `4h-candles.json`
- `daily-candles.json`

## Commands Run To Generate Outputs

Low-price runner:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol LPRN --as-of 2026-05-01T10:30:00-04:00 --reference-price 2.08 --candles-5m docs/examples/level-analysis-snapshot/fixtures/low-price-runner/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/fixtures/low-price-runner/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/fixtures/low-price-runner/daily-candles.json --previous-close 0.92 --out docs/examples/level-analysis-snapshot/outputs/low-price-runner-snapshot.json
```

Clean technical mover:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol CLNT --as-of 2026-05-01T10:30:00-04:00 --reference-price 48.2 --candles-5m docs/examples/level-analysis-snapshot/fixtures/clean-technical/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/fixtures/clean-technical/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/fixtures/clean-technical/daily-candles.json --previous-close 45.5 --out docs/examples/level-analysis-snapshot/outputs/clean-technical-snapshot.json
```

Choppy range ticker:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol CHOP --as-of 2026-05-01T10:30:00-04:00 --reference-price 15.15 --candles-5m docs/examples/level-analysis-snapshot/fixtures/choppy-range/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/fixtures/choppy-range/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/fixtures/choppy-range/daily-candles.json --previous-close 15 --out docs/examples/level-analysis-snapshot/outputs/choppy-range-snapshot.json
```

Thin-liquidity ticker:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol THIN --as-of 2026-05-01T10:30:00-04:00 --reference-price 3.45 --candles-5m docs/examples/level-analysis-snapshot/fixtures/thin-liquidity/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/fixtures/thin-liquidity/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/fixtures/thin-liquidity/daily-candles.json --previous-close 3.25 --out docs/examples/level-analysis-snapshot/outputs/thin-liquidity-snapshot.json
```

Higher-priced stock:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol HIPO --as-of 2026-05-01T10:30:00-04:00 --reference-price 214.5 --candles-5m docs/examples/level-analysis-snapshot/fixtures/higher-priced/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/fixtures/higher-priced/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/fixtures/higher-priced/daily-candles.json --previous-close 208.2 --out docs/examples/level-analysis-snapshot/outputs/higher-priced-snapshot.json
```

## Output Paths

- `docs/examples/level-analysis-snapshot/outputs/low-price-runner-snapshot.json`
- `docs/examples/level-analysis-snapshot/outputs/clean-technical-snapshot.json`
- `docs/examples/level-analysis-snapshot/outputs/choppy-range-snapshot.json`
- `docs/examples/level-analysis-snapshot/outputs/thin-liquidity-snapshot.json`
- `docs/examples/level-analysis-snapshot/outputs/higher-priced-snapshot.json`

## Cross-Scenario Summary

| Scenario | Symbol | Reference | Nearest Support | Nearest Resistance | Surfaced Levels | Extensions | Synthetic Extensions | Shelves | Market Context |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Low-price runner | LPRN | 2.08 | 1.6828 | null | 3 | 0 | 0 | 2 | day_trade_runner |
| Clean technical mover | CLNT | 48.2 | 47.7158 | 49.0576 | 2 | 3 | 2 | 3 | choppy_low_quality |
| Choppy range ticker | CHOP | 15.15 | 14.5687 | 15.6305 | 2 | 3 | 3 | 3 | choppy_low_quality |
| Thin-liquidity ticker | THIN | 3.45 | 3.1322 | 3.8137 | 4 | 3 | 2 | 4 | choppy_low_quality |
| Higher-priced stock | HIPO | 214.5 | 212.155 | 220.6796 | 3 | 3 | 3 | 4 | choppy_low_quality |

All snapshots include:

- `schemaVersion: level-analysis-snapshot/v1`
- `producer: levels-system`
- `inputSummary`
- `levelEngineOutput`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`
- `safety.noLookaheadApplied: true`
- `safety.levelOutputUnchanged: true`

## Scenario Reviews

### Low-Price Runner

- Symbol: `LPRN`
- Scenario type: low-price runner
- `asOfTimestamp`: `1777645800000`
- Reference price: `2.08`
- Nearest support: `1.6828`
- Nearest resistance: `null`
- Level availability: `3` intraday support levels; no major, intermediate, or resistance levels surfaced.
- Extension availability: no extension levels.
- Synthetic continuation-map availability: none in this fixture.
- Session facts: present.
- Volume facts: present with strong activity context from the deterministic high-volume sequence.
- Volume shelves: `2`
- Market context: `day_trade_runner`
- Intelligence report: present.
- Quality audit: present, `3` total audited levels.
- Safety: no-lookahead and level-output-unchanged flags are true.
- Weak/missing fields: no nearest resistance, no major/intermediate levels, no extension ladder.
- Journal usefulness: useful for runner support/facts/context review, but weak for forward resistance/extension coverage.

### Clean Technical Mover

- Symbol: `CLNT`
- Scenario type: clean technical mover
- `asOfTimestamp`: `1777645800000`
- Reference price: `48.2`
- Nearest support: `47.7158`
- Nearest resistance: `49.0576`
- Level availability: intraday support and intraday resistance are present.
- Extension availability: `2` support extensions and `1` resistance extension.
- Synthetic continuation-map availability: `2`
- Session facts: present.
- Volume facts: present.
- Volume shelves: `3`
- Market context: `choppy_low_quality`
- Intelligence report: present.
- Quality audit: present, `5` total audited levels.
- Safety: no-lookahead and level-output-unchanged flags are true.
- Weak/missing fields: no major/intermediate levels; context classifier is conservative compared with the fixture intent.
- Journal usefulness: useful for nearest support/resistance, extension, and factual context consumption.

### Choppy Range Ticker

- Symbol: `CHOP`
- Scenario type: choppy range ticker
- `asOfTimestamp`: `1777645800000`
- Reference price: `15.15`
- Nearest support: `14.5687`
- Nearest resistance: `15.6305`
- Level availability: intraday support and intermediate resistance are present.
- Extension availability: `2` support extensions and `1` resistance extension.
- Synthetic continuation-map availability: `3`
- Session facts: present.
- Volume facts: present.
- Volume shelves: `3`
- Market context: `choppy_low_quality`
- Intelligence report: present.
- Quality audit: present, `5` total audited levels.
- Safety: no-lookahead and level-output-unchanged flags are true.
- Weak/missing fields: no major levels; choppy compression still leaves a compact surface.
- Journal usefulness: useful for range-quality inspection and factual risk/context display without changing clustering behavior.

### Thin-Liquidity Ticker

- Symbol: `THIN`
- Scenario type: thin-liquidity ticker
- `asOfTimestamp`: `1777645800000`
- Reference price: `3.45`
- Nearest support: `3.1322`
- Nearest resistance: `3.8137`
- Level availability: `2` intraday support and `2` intraday resistance levels.
- Extension availability: `2` support extensions and `1` resistance extension.
- Synthetic continuation-map availability: `2`
- Session facts: present.
- Volume facts: present.
- Volume shelves: `4`
- Market context: `choppy_low_quality`
- Intelligence report: present.
- Quality audit: present, `7` total audited levels.
- Safety: no-lookahead and level-output-unchanged flags are true.
- Weak/missing fields: no major/intermediate levels; liquidity context remains a warning-style consumer concern.
- Journal usefulness: useful for testing sparse-volume context, weaker candidate quality, and synthetic extension labeling.

### Higher-Priced Stock

- Symbol: `HIPO`
- Scenario type: higher-priced stock
- `asOfTimestamp`: `1777645800000`
- Reference price: `214.5`
- Nearest support: `212.155`
- Nearest resistance: `220.6796`
- Level availability: `2` intraday support and `1` intraday resistance levels.
- Extension availability: `2` support extensions and `1` resistance extension.
- Synthetic continuation-map availability: `3`
- Session facts: present.
- Volume facts: present.
- Volume shelves: `4`
- Market context: `choppy_low_quality`
- Intelligence report: present.
- Quality audit: present, `6` total audited levels.
- Safety: no-lookahead and level-output-unchanged flags are true.
- Weak/missing fields: no major/intermediate levels; fixture still leans intraday-heavy.
- Journal usefulness: useful for validating the same contract shape at larger absolute prices and wider dollar ranges.

## Replay Validation Findings

- The snapshot schema is stable across all five deterministic scenarios.
- All outputs preserve `LevelEngineOutput` as the canonical level object.
- Nearest support/resistance fields are present on every snapshot and use `null` when absent.
- Synthetic continuation-map extensions are present in four of five scenarios and are clearly marked where generated.
- Session, volume, shelf, market context, intelligence report, and quality audit sections are present across all scenarios.
- No output includes Discord/test-channel contract fields.
- The fixture pack reveals coverage gaps that are useful for downstream review, especially low-price runner resistance/extension absence and limited major/intermediate level coverage across the pack.

## TraderLink Intelligence / Journal Usefulness

The fixture pack is useful for downstream journal consumption validation because it exercises:

- missing nearest resistance
- present nearest support/resistance
- synthetic continuation-map extensions
- low-price context
- thin-liquidity context
- choppy-range context
- higher-priced output scaling
- session facts
- volume facts
- volume shelves
- market context
- quality audit summaries

It is not yet a replacement for real cached ticker replay validation.

## Recommended Next Gate

Recommended next gate: `real_ticker_replay_validation_with_actual_cached_data`.

Rationale: deterministic fixtures now prove the snapshot contract shape across multiple scenarios. The next confidence step is replaying real cached candle windows to see whether the same contract remains useful with actual market structure, real gaps, real volume behavior, and more natural multi-timeframe level inventory.
