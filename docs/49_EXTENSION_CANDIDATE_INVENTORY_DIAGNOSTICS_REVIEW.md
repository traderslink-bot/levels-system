# Extension Candidate Inventory Diagnostics Review

Date: 2026-05-28

## Purpose

This review reruns extension diagnostics across the multi-sample LevelEngineOutput fixtures after adding candidate-inventory instrumentation. The goal is to explain missing or limited extension coverage before changing extension generation, level selection, scoring, clustering, or runtime behavior.

This is review-only. It does not change support/resistance detection, LevelEngine default output, runtime defaults, extension generation behavior, level selection, bucket membership, nearest levels, extension levels, special levels, strength fields, enrichedAnalysis scoring, alerts, monitoring, Discord behavior, or trader-context behavior.

## Inputs Used

- `docs/examples/level-quality-audit/choppy-level-output.json`
- `docs/examples/level-quality-audit/clean-technical-level-output.json`
- `docs/examples/level-quality-audit/higher-priced-level-output.json`
- `docs/examples/level-quality-audit/low-price-runner-level-output.json`
- `docs/examples/level-quality-audit/thin-liquidity-level-output.json`

These cover:

- choppy/messy ticker
- clean technical mover
- higher-priced stock
- low-price runner
- thin-liquidity ticker

## Commands Run

```bash
npx tsx src/scripts/run-level-extension-diagnostics.ts --fixture-dir docs/examples/level-quality-audit --format text --out docs/examples/level-quality-audit/latest-extension-diagnostics-enhanced.txt
```

```bash
npx tsx src/scripts/run-level-extension-diagnostics.ts --fixture-dir docs/examples/level-quality-audit --format json --out docs/examples/level-quality-audit/latest-extension-diagnostics-enhanced.json
```

## Outputs

- `docs/examples/level-quality-audit/latest-extension-diagnostics-enhanced.txt`
- `docs/examples/level-quality-audit/latest-extension-diagnostics-enhanced.json`

## Summary

- Sample count: 5
- Missing support extension samples: 1
- Missing resistance extension samples: 2
- Limited upside coverage samples: 0
- Limited downside coverage samples: 2
- Insufficient candidate inventory samples: 2
- Undetermined rejection reasons: 0

## Per-Sample Candidate Inventory

| Sample | Support pre-selection | Support selected | Resistance pre-selection | Resistance selected | Key warnings |
| --- | ---: | ---: | ---: | ---: | --- |
| `CHOP` | 0 | 0 | 0 | 0 | `missing_support_extension`, `missing_resistance_extension`, `insufficient_candidate_inventory` |
| `CLNT` | 1 | 1 | 1 | 1 | `limited_downside_extension_coverage` |
| `HIPO` | 1 | 1 | 1 | 1 | `limited_downside_extension_coverage` |
| `LPRN` | 1 | 1 | 1 visible pre-selection, 2 selected in final output | 2 | none |
| `THIN` | 1 | 1 | 0 | 0 | `missing_resistance_extension`, `insufficient_candidate_inventory` |

## Selected Extension Counts

- `CHOP`: 0 support, 0 resistance.
- `CLNT`: 1 support, 1 resistance.
- `HIPO`: 1 support, 1 resistance.
- `LPRN`: 1 support, 2 resistance.
- `THIN`: 1 support, 0 resistance.

## Recurring Rejection Reasons

The recurring candidate reasons are:

- `already_surfaced`
- `inside_surfaced_map`
- `too_close_to_surfaced_level`
- `selected_extension`

`CHOP` also has one visible resistance candidate below the reference price, so it gets `wrong_side_of_reference_price`.

No sample reported:

- `outside_practical_range`
- `too_close_to_another_extension`
- `dominated_by_forward_candidate`
- `not_selected_by_ladder_selection`
- `undetermined`

## Missing Support/Resistance Explanations

### CHOP

`CHOP` has no support extensions and no resistance extensions.

The enhanced diagnostics show:

- support input inventory: `5.09`, `5.05`, `4.85`
- support pre-selection candidates: none
- support eligible candidates: none
- resistance input inventory: `5.12`, `5.18`, `5.45`
- resistance pre-selection candidates: none
- resistance eligible candidates: none

Every visible candidate is already surfaced, inside the surfaced map, and too close to surfaced levels. This means the final LevelEngineOutput contains no extension-eligible inventory beyond surfaced levels.

### THIN

`THIN` has a support extension but no resistance extension.

The enhanced diagnostics show:

- support pre-selection candidates: `1.3`
- support selected: `1.3`
- resistance input inventory: `1.76`, `1.82`, `2.1`
- resistance pre-selection candidates: none
- resistance eligible candidates: none
- resistance selected: none

The visible resistance inventory is entirely surfaced resistance. There is no visible resistance candidate beyond surfaced resistance for extension selection.

## Limited Upside/Downside Explanations

### CLNT

`CLNT` has one selected support extension at `20`, with 18.0328% downside coverage. The selected support extension is also the only visible pre-selection support candidate.

The limitation is not explained by spacing or rejection. It is explained by limited visible deeper support inventory in the final output fixture.

### HIPO

`HIPO` has one selected support extension at `158`, with 15.2815% downside coverage. The selected support extension is also the only visible pre-selection support candidate.

The limitation is not explained by spacing or rejection. It is explained by limited visible deeper support inventory in the final output fixture.

### LPRN

`LPRN` remains the healthy comparison sample:

- support selected coverage: 33.3333%
- resistance selected coverage: 61.9048%
- no extension coverage warnings

This shows the current ladder can produce adequate coverage when visible extension inventory exists.

## What Is Now Known

- Missing `CHOP` extensions are caused by no visible extension-eligible candidates beyond surfaced levels in the LevelEngineOutput fixture.
- Missing `THIN` resistance extension is caused by no visible resistance extension candidate beyond surfaced resistance in the LevelEngineOutput fixture.
- Limited `CLNT` and `HIPO` downside coverage is caused by the only visible support extension candidate being shallower than the audit threshold.
- The enhanced diagnostics did not find evidence that spacing, practical range, selected-extension proximity, dominated forward candidates, or ladder selection rejection caused these sample failures.
- The diagnostics now produce useful per-side reason counts and before/after coverage:
  - `candidateCoveragePct`
  - `selectedCoveragePct`
  - pre-selection candidate prices
  - eligible candidate prices
  - selected extension prices
  - skipped candidate reasons

## What Is Still Unknown

These fixtures are LevelEngineOutput-only snapshots. They still do not contain the full raw ranked candidate pool that existed before surfaced buckets and extensions were selected.

Because of that, the review cannot yet prove whether missing or limited extension inventory came from:

- raw candle candidate generation not creating enough frontier candidates
- clustering/merging removing frontier candidates
- ranking/surfacing consuming all useful candidates
- practical forward planning range limiting available resistance candidates before final output
- expected behavior for weak/choppy/thin symbols

The current output proves what is visible after LevelEngineOutput creation, not every raw candidate that may have existed inside the engine.

## Cause Assessment

### Insufficient Candidate Inventory

Supported by current evidence.

`CHOP` and `THIN` missing extensions have no visible eligible candidates beyond surfaced levels. `CLNT` and `HIPO` limited downside coverage have exactly one visible eligible downside candidate, and that candidate is selected.

### Candidates Already Surfaced

Supported by current evidence.

Most skipped candidates across the fixtures are surfaced levels. This is expected for final LevelEngineOutput-based diagnostics, but it also explains why those visible levels cannot become extension levels.

### Wrong-Side Candidates

Minor finding only.

`CHOP` has one resistance candidate below the reference price. This does not explain the broader issue.

### Outside Practical Range

Not supported by current evidence.

No enhanced diagnostic output reported `outside_practical_range`.

### Too Close To Surfaced Levels

Supported as a byproduct of surfaced levels.

Visible surfaced levels are also too close to themselves or nearby surfaced levels. This is not currently the primary cause because the affected candidates are already surfaced.

### Too Close To Selected Extensions

Not supported by current evidence.

No sample reported `too_close_to_another_extension`.

### Dominated By Forward Candidate

Not supported by current evidence.

No sample reported `dominated_by_forward_candidate`.

### No Synthetic Extension Generation

Known fact, but not yet proven as the first fix.

Synthetic extension generation is not available in the current extension engine. It could help when no real candidate inventory exists, but this review should not jump there before understanding whether the real candidate pool can be expanded or preserved.

### Still Undetermined

No candidate-level `undetermined` reasons were reported, but the upstream source of missing inventory remains unknown because these fixtures do not include raw pre-output candidates.

## Recommendation

Recommended next gate: `candidate_pool_expansion_review`.

Reasoning:

- The strongest evidence is limited or missing visible candidate inventory, not spacing/range rejection.
- The healthy `LPRN` sample shows current extension behavior can work when candidate inventory exists.
- Synthetic extension generation may eventually be useful, but adding synthetic zones before understanding raw candidate availability would be premature.
- Spacing/range tuning is not supported by these enhanced diagnostics because no recurring spacing/range rejection reason appeared.

Recommended scope for `candidate_pool_expansion_review`:

- Inspect how raw level candidates become final support/resistance zones before extension selection.
- Determine whether deeper support and overhead resistance candidates exist before surfacing.
- Identify whether clustering, bucket ownership, rank sorting, or surfaced selection consumes candidate inventory that extensions need.
- Add generated diagnostic fixtures that run from raw engine inputs, not only saved LevelEngineOutput JSON.
- Keep extension output unchanged until a narrow failure mode is proven.

Not recommended yet:

- `synthetic_extension_generation_review`
- `extension_spacing_range_tuning`
- `cluster_cleanup_review`
- `no_engine_change_yet`

## Safety

- Extension generation behavior unchanged.
- Support/resistance detection unchanged.
- LevelEngine default output unchanged.
- Runtime behavior unchanged.
- Scoring and selection unchanged.
- Alert, monitoring, Discord, and trader-context behavior unchanged.
- No trade grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language added.
