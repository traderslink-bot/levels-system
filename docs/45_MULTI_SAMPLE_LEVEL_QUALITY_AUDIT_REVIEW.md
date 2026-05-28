# Multi-Sample Level Quality Audit Review

Date: 2026-05-28

## Scope

This review adds deterministic multi-sample `LevelEngineOutput` fixtures and runs the Level Quality Audit against each fixture.

This is review coverage only. It does not change support/resistance detection, clustering, scoring, ranking, selection, runtime behavior, alerts, monitoring, Discord behavior, or trader-context behavior.

## Fixture Set

All fixtures live under `docs/examples/level-quality-audit/`.

| Fixture | Symbol | Purpose |
| --- | --- | --- |
| `low-price-runner-level-output.json` | `LPRN` | Low-price runner with wider forward extension coverage |
| `clean-technical-level-output.json` | `CLNT` | Balanced technical structure with clean nearby levels |
| `choppy-level-output.json` | `CHOP` | Messy, overlapping levels with stale/weak context |
| `thin-liquidity-level-output.json` | `THIN` | Sparse level map with limited extension coverage |
| `higher-priced-level-output.json` | `HIPO` | Higher-priced stock with wider dollar zones |

## Commands Run

For each fixture, the audit runner was executed in text and JSON mode:

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-quality-audit/<sample>-level-output.json --format text --out docs/examples/level-quality-audit/<sample>-level-quality-audit.txt
```

```powershell
npx tsx src/scripts/run-level-quality-audit.ts --level-output docs/examples/level-quality-audit/<sample>-level-output.json --format json --out docs/examples/level-quality-audit/<sample>-level-quality-audit.json
```

Validation:

```powershell
npx tsc --noEmit
npm test
```

## Output Files

For each sample:

- `<sample>-level-output.json`
- `<sample>-level-quality-audit.txt`
- `<sample>-level-quality-audit.json`

## Summary Table

| Sample | Total | Support / Resistance | Extensions | Fresh / Stale | Clusters | Nearby S/R | Extension warnings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| low-price-runner | 9 | 4 / 5 | 3 | 6 / 0 | 0 | 2 / 2 | none |
| clean-technical | 8 | 4 / 4 | 2 | 6 / 0 | 0 | 2 / 2 | limited downside |
| choppy | 6 | 3 / 3 | 0 | 2 / 2 | 2 | 3 / 2 | no support and no resistance extensions |
| thin-liquidity | 6 | 3 / 3 | 1 | 3 / 1 | 0 | 1 / 2 | no resistance extension |
| higher-priced | 8 | 4 / 4 | 2 | 4 / 0 | 1 | 3 / 2 | limited downside |

## Output-Only Limitation

These fixtures intentionally use `LevelEngineOutput` only. No paired `LevelIntelligenceReport` was supplied in this gate.

As a result:

- Enriched / unenriched is `0 / all levels` for every sample.
- Session, volume, shelf, and market-context confluence counts are `0`.
- Every sample includes `level_intelligence_report_missing`, `levels_without_context_present`, and `unenriched_levels_present`.

This is useful as a baseline for level-map quality, but it is not enough to judge explanation quality or facts-rich confluence.

## Fixture Findings

### Low-Price Runner

The low-price runner fixture has the strongest forward planning coverage:

- Support extensions: `1`
- Resistance extensions: `2`
- Downside coverage: `33.3333%`
- Upside coverage: `61.9048%`
- No extension warnings

This fixture shows the kind of wider ladder coverage that matters for low-price runner review. Nearby level coverage is also reasonable around the reference price, with `2` nearby supports and `2` nearby resistances.

### Clean Technical Mover

The clean technical fixture is balanced:

- `8` total levels
- `4 / 4` support and resistance
- No clusters
- `2 / 2` nearby support/resistance coverage

The only coverage warning is limited downside extension coverage. This may be acceptable for some clean technical structures, but it gives us a repeatable baseline for checking whether downside planning is too thin.

### Choppy / Messy Ticker

The choppy fixture exposes the clearest quality issues:

- No extension levels on either side.
- `2` clustered areas.
- `2` stale levels.
- Weak/moderate levels are close together around the reference price.

Clustered areas detected:

- Support cluster: `5.05` and `5.09`
- Resistance cluster: `5.12` and `5.18`

This is the strongest fixture for future clustering/noise review.

### Thin-Liquidity Ticker

The thin-liquidity fixture exposes sparse coverage:

- `6` total levels.
- Only `1` extension level.
- No resistance extension.
- `1` stale level.
- Nearby support count is only `1`.

This points more toward coverage and confidence review than clustering review.

### Higher-Priced Stock

The higher-priced fixture has balanced counts and usable nearby coverage, but it flags:

- `1` clustered support area between `184` and `186`.
- Limited downside extension coverage.

The support cluster may be acceptable if the two levels represent different timeframe roles, but it should be inspected in a future facts-rich or replay-backed review before changing clustering behavior.

## Recurring Quality Issues

Recurring issues across this output-only fixture set:

1. Extension coverage is the most common warning.
   - Low-price runner coverage is healthy.
   - Clean technical and higher-priced samples show limited downside extension coverage.
   - Choppy has no extension coverage.
   - Thin-liquidity has no resistance extension.

2. Clustering/noise is situational, not universal.
   - Choppy intentionally shows two clustered areas.
   - Higher-priced shows one support cluster.
   - Low-price runner, clean technical, and thin-liquidity do not show clusters.

3. Stale/freshness concerns are fixture-specific.
   - Choppy has two stale levels.
   - Thin-liquidity has one stale level.
   - The other samples have no stale levels.

4. The audit needs paired intelligence reports for richer conclusions.
   - All samples are unenriched in this baseline.
   - No session, volume, shelf, or market-context confluence can be compared yet.

## Tuning Assessment

### Extension Coverage

Extension coverage deserves the next closest review. The low-price runner fixture demonstrates the desired broad ladder shape, while choppy and thin-liquidity fixtures show missing extension coverage.

Do not tune extension behavior from these synthetic fixtures alone. First run the same audit on facts-rich and replay-derived outputs.

### Clustering / Noise

Clustering review is justified for choppy structures, but not as a global change yet. The choppy sample correctly exposes clustered areas; the higher-priced support cluster needs context before deciding whether it is noise or useful layered structure.

### Stale / Freshness

No freshness change is justified yet. The stale signals appear where expected in choppy and thin-liquidity fixtures.

### Scoring / Ranking

No scoring or ranking change is justified from this gate. The strongest/weakest ordering is broadly consistent with supplied strength values.

## Next Recommended Gate

Add facts-rich multi-sample intelligence coverage before tuning detection or scoring.

Suggested next gate:

- Generate paired `LevelIntelligenceReport` artifacts for these five fixtures.
- Re-run Level Quality Audit with both `LevelEngineOutput` and `LevelIntelligenceReport`.
- Compare whether weak-context levels decrease and whether shelf/session/volume confluence helps explain clustered areas.
- Only after that, decide between an extension coverage tuning gate or clustering/noise tuning gate.

Current recommendation: no support/resistance detection change yet.
