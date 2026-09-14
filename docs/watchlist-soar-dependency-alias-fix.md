# SOAR analysis dependency compatibility repair

Status: source correction verified; not deployed. Deep-setup generation remains a separate open defect.

Owner scope: preserve generated Where the trade could go next prices and the
existing edit/review/approval workflow. No automatic publication or paid replay.

## Exact file allowlist

- `src/lib/ai/traderslink-ai-read-breakout-selection.ts`
- `src/lib/ai/traderslink-ai-read-checkpoint-dependencies.ts`
- `src/lib/ai/traderslink-ai-read-service.ts`
- `src/tests/traderslink-ai-read-breakout-selection.test.ts`
- `src/tests/traderslink-ai-read-checkpoint-dependencies.test.ts`
- `src/tests/traderslink-ai-read-service.test.ts`
- `docs/watchlist-soar-dependency-alias-fix.md`
- `docs/watchlist-ai-provider-corrections-progress-2026-08-26.md`

Coordinator confirmed canonical tracked-clean parent `0eb58c0195369e41be86fb7a285933c39f4e5fdd`.
Live source artifact is `5a2ba66961775a6c8a3fb6ffd93209ddcf0a1514`, not an
ancestor: release requires exact-file reconciliation, never wholesale HEAD.
No local 3010 listener; hosted runtime identity confirmed by Coordinator.

## Evidence and intended correction

SOAR's saved response supplied 0.259, 0.265 and 0.272, but referenced
`primary-breakout` instead of `primary`. Downside 0.202 and 0.1908 referenced
`momentum-failure` instead of `momentumFailure`. Validation discarded both
chains. A focused pre-fix reproduction confirms all three upside omissions.

Accept only explicit unambiguous aliases of the current root, reject collisions
and other branches, and preserve all price/evidence/order checks. Keep original
response objects unchanged. Regression covers SOAR-shaped chains, invalid
evidence, forward/missing/foreign dependencies and alias-name collisions.

The 30-second add acknowledgement timeout is separate and unchanged. No owner
draft repair, approval, Discord post, API regeneration, or hosted write is part
of this worker slice.

## Checkpoint

- [x] 19 focused dependency/selection tests pass, including both saved-response chains.
- [x] Integrated service test passes with canonical, plain alias and symbol-prefixed
  alias roots, actual supplied candle evidence, and rejection of foreign symbols
  and unsupported prices. One worker, 384 MB heap; no real provider requests.
- [ ] Narrow commit and Coordinator handoff.
- [x] Read-only saved-response replay procedure documented below.

## BMGL evidence

BMGL's original upside 9.48/10.60 referenced `bmgl-breakout-primary`; downside
5.13/4.58 referenced `bmgl-momentum-failure`. The helpers receive the current
symbol from the generation snapshot, never infer it from a target ID. Only exact
current-symbol/current-root aliases are accepted. Original records are unchanged.

Separately, BMGL deep 5.13–5.57 had invalidation 5.42 inside the zone, also its
whole momentum failure. The alias fix does not repair this contradictory setup
and must not be reported as completing deep dip-buy generation.

## Safe replay and release handoff

Read the owner-authenticated analysis-review export for each exact saved generation.
Extract only the matching captured request and HTTP response. Do not use current
prices/candles to validate an earlier read. Verify generation, symbol, request ID
and stored hashes before replay. No response reasoning blobs belong in reports.

Use `src/scripts/validate-ai-context-replay.ts` only when an exact matching
`validationContext` has been preserved. It injects the saved response using
`fetchImpl`, uses a dummy API key, rejects a second request and constructs no
runtime manager/publisher. If the export lacks that original full context, do
not guess it from current candles or claim full historical revalidation. Replay
the dependency helpers with the saved targets/root as the bounded check instead.
The SOAR/BMGL tests here cover the latter boundary; integrated service checks use
the existing complete candle fixture, not invented historical SOAR/BMGL candles.

Deploying source does not mutate existing drafts. Any historic draft repair needs
its own revision-preserving procedure and revalidation, must preserve the original
response and owner edits, and must leave approval null. This worker performed no
such mutation. Coordinator owns exact-live-artifact reconciliation, release and
hosted acceptance; this document does not assert deployment or repaired drafts.
