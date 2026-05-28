# Level Quality Findings Review

Date: 2026-05-28

## Purpose

This review runs the Level Quality Findings Classifier across the multi-sample Level Quality Audit outputs. The goal is to identify recurring support/resistance quality issues before changing detection, clustering, scoring, ranking, or selection logic.

This is review-only. It does not change support/resistance detection, LevelEngine output, runtime defaults, alerts, monitoring, Discord behavior, trader-context behavior, level selection, bucket membership, nearest levels, extension levels, special levels, strength fields, or enrichedAnalysis scoring.

## Inputs Used

- `docs/examples/level-quality-audit/choppy-level-quality-audit.json`
- `docs/examples/level-quality-audit/clean-technical-level-quality-audit.json`
- `docs/examples/level-quality-audit/higher-priced-level-quality-audit.json`
- `docs/examples/level-quality-audit/low-price-runner-level-quality-audit.json`
- `docs/examples/level-quality-audit/thin-liquidity-level-quality-audit.json`

These cover:

- low-price runner
- clean technical mover
- choppy/messy ticker
- thin-liquidity ticker
- higher-priced stock

## Commands Run

```bash
npx tsx src/scripts/run-level-quality-findings.ts --audit-dir docs/examples/level-quality-audit --format text --out docs/examples/level-quality-audit/latest-level-quality-findings.txt
```

```bash
npx tsx src/scripts/run-level-quality-findings.ts --audit-dir docs/examples/level-quality-audit --format json --out docs/examples/level-quality-audit/latest-level-quality-findings.json
```

## Outputs

- `docs/examples/level-quality-audit/latest-level-quality-findings.txt`
- `docs/examples/level-quality-audit/latest-level-quality-findings.json`

## Classifier Summary

- Sample count: 5
- Finding count: 10
- Recurring finding count: 8

Recommended next gates from the classifier:

- `extension_coverage_review`
- `cluster_cleanup_review`
- `thin_liquidity_handling_review`
- `stale_freshness_review`
- `confluence_enrichment_review`

## Recurring Findings

### Extension Coverage

- `missing_resistance_extension`
  - Recurs in 2 samples: `CHOP`, `THIN`
  - Evidence:
    - `CHOP`: resistance extension count is 0
    - `THIN`: resistance extension count is 0

- `limited_downside_extension_coverage`
  - Recurs in 2 samples: `CLNT`, `HIPO`
  - Evidence:
    - `CLNT`: downside extension coverage is 18.0328%
    - `HIPO`: downside extension coverage is 15.2815%

- `missing_support_extension`
  - Appears in 1 sample: `CHOP`
  - Evidence:
    - `CHOP`: support extension count is 0

Interpretation: extension coverage is the clearest engine-facing recurring issue. It appears across multiple market situations and affects both missing resistance extension coverage and limited downside extension reach.

### Cluster And Clutter

- `clustered_levels_detected`
  - Recurs in 2 samples: `CHOP`, `HIPO`
  - Evidence:
    - `CHOP`: clustered area count is 2
    - `HIPO`: clustered area count is 1

- `possible_level_clutter`
  - Recurs in 2 samples: `CHOP`, `HIPO`
  - Evidence:
    - `CHOP`: possible clutter level count is 4
    - `HIPO`: possible clutter level count is 2

Interpretation: clustering/noise cleanup is also evidence-backed, but it appears more sample-specific than the extension coverage issues. It is important, especially for choppy and higher-priced samples, but probably comes after extension coverage review.

### Sparse Coverage And Staleness

- `sparse_level_coverage`
  - Recurs in 2 samples: `CHOP`, `THIN`
  - Evidence:
    - `CHOP`: total 6, nearby 3/2
    - `THIN`: total 6, nearby 1/2

- `stale_levels_present`
  - Recurs in 2 samples: `CHOP`, `THIN`
  - Evidence:
    - `CHOP`: stale level count is 2
    - `THIN`: stale level count is 1

Interpretation: sparse coverage and stale levels are relevant, but the evidence is concentrated in the choppy and thin-liquidity samples. These likely need a later targeted review rather than the first engine change.

### Context And Enrichment

- `weak_context_levels_present`
  - Recurs in all 5 samples: `CHOP`, `CLNT`, `HIPO`, `LPRN`, `THIN`
  - Each sample reported 5 weak-context levels.

- `unenriched_levels_present`
  - Recurs in all 5 samples: `CHOP`, `CLNT`, `HIPO`, `LPRN`, `THIN`
  - Evidence ranges from 6 to 9 unenriched levels per sample.

Interpretation: this is the broadest finding, but it is partly caused by these being LevelEngineOutput-only audit samples without paired facts-rich LevelIntelligenceReport inputs. This supports a confluence/enrichment review path, but it does not justify changing level detection or scoring by itself.

### Healthy Coverage

- `healthy_extension_coverage`
  - Appears in 1 sample: `LPRN`
  - Evidence:
    - low-price runner extension coverage had no audit warnings.

Interpretation: extension behavior can be healthy in some contexts, so a future extension review should tune specific missing/limited cases rather than replacing the extension ladder broadly.

## Most Important Issue

The first evidence-backed tuning target should be extension coverage review.

Reasons:

- Missing resistance extension coverage recurs in 2 of 5 samples.
- Limited downside extension coverage recurs in 2 of 5 samples.
- Missing support extension appears in the choppy sample.
- The low-price runner sample shows healthy extension coverage, which means the issue is not universal and should be reviewed narrowly.
- Extension coverage is closer to actual support/resistance usability than the context/enrichment findings, which are affected by output-only audit inputs.

Cluster cleanup is the second strongest target. It has recurring evidence in the choppy and higher-priced samples, but it should follow extension coverage unless a narrower cluster-specific fixture shows a higher-impact failure.

## Is Evidence Enough To Change Engine Logic Now?

Not yet for broad engine changes.

The evidence is enough to justify a focused extension coverage review gate, but not enough to change detection, scoring, clustering, ranking, or selection broadly. The next gate should inspect the extension ladder cases directly and define a narrow remediation only if it preserves existing correct behavior, especially the healthy low-price runner sample.

## Recommended Next Implementation Gate

Next gate: `extension_coverage_review`.

Recommended scope:

- Compare the samples with missing or limited extension coverage against the healthy low-price runner sample.
- Identify whether the issue is caused by candidate availability, filtering, spacing, bucket transport, reference-price range limits, or stale/weak level suppression.
- Add focused diagnostics or review fixtures first.
- Do not change extension ladder behavior until the failure mode is isolated.
- Preserve current support/resistance selection, bucket membership, nearest levels, special levels, strength fields, and enrichedAnalysis scoring unless a later explicit gate authorizes a narrow change.

## Safety

- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- Runtime behavior unchanged.
- Scoring and selection unchanged.
- Alert, monitoring, Discord, and trader-context behavior unchanged.
- Review-only artifacts and one review script were added.
