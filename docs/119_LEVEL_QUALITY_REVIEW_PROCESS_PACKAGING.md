# Level Quality Review Process Packaging

## Purpose

This gate packages the real-cache LevelEngine quality review process into a repeatable read-only command. The command rebuilds compact review summaries from local cache wrapper files listed in a baseline artifact, compares them against that baseline, and writes compact JSON/text outputs.

This does not tune support/resistance detection, change LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Why Review Packaging Matters

The locked baseline requires future behavior work to compare against the same ten-symbol real-cache review. Previously, those reruns were performed through one-off inline harnesses. A packaged command makes future reviews easier to repeat and easier to audit before any behavior tuning gate begins.

## Command

Package script:

```text
npm run review:level-quality
```

Script:

```text
src/scripts/run-level-quality-review.ts
```

Example using the locked post-fixture baseline:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json --out-json artifacts/level-quality-review/latest-level-quality-review.json --out-text artifacts/level-quality-review/latest-level-quality-review.txt --generated-at 2026-06-01T22:45:00.000Z
```

`artifacts/` is ignored by git. Operational rerun outputs should stay there unless a future gate intentionally commits compact summaries.

## Required Inputs

Required CLI options:

- `--cache-root <path>`: local validation-cache candle root.
- `--baseline <path>`: compact baseline artifact with `entries[]`.
- `--out-json <path>`: compact JSON output path.
- `--out-text <path>`: compact text output path.
- `--generated-at <ISO>`: deterministic output timestamp.

Optional CLI option:

- `--provider ibkr`: defaults to `ibkr`. Other providers are only for explicit fixture/test use.

The baseline entries must include:

- `symbol`
- `asOfTimestamp`
- `referencePrice` when available
- `previousClose` when available
- `sourceFiles["5m"]`
- `sourceFiles["4h"]`
- `sourceFiles["daily"]`
- optional `sourceFiles["15m"]`
- compact comparison fields such as nearest levels, bucket counts, extension coverage, synthetic summary, diagnostics, diagnostic semantics, and enrichment breakdown

## Output Paths

The command writes:

- compact JSON review output
- compact text summary output

It does not write:

- raw cache files
- raw candle arrays
- full snapshots
- provider responses
- credentials or provider session details

## Baseline Comparison Behavior

For each baseline entry, the command:

1. resolves source files relative to `--cache-root`;
2. reads only local validation-cache wrapper files;
3. rebuilds `LevelAnalysisSnapshot` through `buildLevelAnalysisSnapshotFromCandles`;
4. extracts compact review fields;
5. compares those fields against the baseline;
6. reports parity counts and per-symbol mismatch keys.

Compared fields include:

- nearest support and resistance;
- bucket counts;
- extension counts;
- synthetic continuation-map count and marking;
- `LevelQualityAudit.diagnostics`;
- `diagnosticSemantics`;
- `enrichmentBreakdown`;
- extension coverage warning sets;
- cluster/density diagnostic status;
- 15m context-only status.

The command does not search for newer cache files. It uses the exact source file paths recorded in the baseline artifact so the review stays repeatable.

## Safety Boundaries

The review process is read-only for cache data:

- no provider calls;
- no cache writes;
- no cache collection;
- no raw candle output;
- no full snapshot output;
- no alert, monitoring, Discord, or journal imports;
- no runtime default changes.

15m remains context-only. The script can read supplied 15m cache files when a baseline entry lists them, but it does not feed 15m into LevelEngine.

## Limitations

The command depends on local cache files matching the baseline artifact. If a baseline-listed file is missing, the command fails instead of searching for a replacement.

The command packages comparison, not judgment. Mismatches are reported as factual keys and counts. They are not scores, grades, coaching, or trading instructions.

## Support For Future Behavior Gates

Future behavior-changing gates can use this command to satisfy the locked baseline requirement:

- run the current baseline;
- apply one proposed behavior knob in a dedicated gate;
- rerun the same command;
- compare compact before/after artifacts;
- report exact expected and actual output diffs.

Behavior-changing gates must still follow `docs/116_LEVEL_QUALITY_DECISION_BASELINE_LOCK.md`.

## Tests Added

Focused tests cover:

- CLI argument parsing;
- temp validation-cache wrapper reads;
- compact JSON/text writes;
- parity when compact fields match;
- mismatch reporting when a compact field changes;
- absence of raw candle arrays in output;
- prohibited-language guard;
- package script exposure;
- source isolation from provider, alert, monitoring, Discord, and journal paths.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_audit_density_metric_design
```

Reason: once the review process is packaged, the safest next improvement is audit-only density metrics for dense-but-separated maps before any generation behavior tuning.
