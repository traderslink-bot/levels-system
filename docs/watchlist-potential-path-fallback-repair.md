# Potential Path fallback repair

Status: source verified; not deployed.

Owner requests the existing resistance-map fallback actually supply farther
Where the trade could go next prices, rather than rejecting map levels because
they are not duplicate observations in the shorter AI candle packet.

Exact slice allowlist:
- `src/lib/ai/traderslink-ai-read-service.ts`
- `src/tests/traderslink-ai-read-service.test.ts`
- `docs/watchlist-potential-path-fallback-repair.md`
- `docs/watchlist-ai-provider-corrections-progress-2026-08-26.md`

Preserve the current 30–50% breakout-relative selection rule in this bounded
correction; its suitability versus the owner's intended reference-relative
coverage is unresolved. Do not claim this fixes every missing outer level.

The current test explicitly discards a 2.30 strong daily-confluence Potential
Path resistance solely because the AI packet has no identical candle. Correct
that boundary: only the exact appended server-selected level from the frozen
snapshot may use map evidence. AI-generated levels cannot self-assert that
authority. Preserve all existing price order and text checks.

No hosted state, approval, publication, provider calls or runtime changes by
this worker. Deep-dip generation remains separate and incomplete.

Checkpoint: four focused service tests pass (one worker, 384 MB heap): map-only
resistance survives, generated text cannot grant map authority, candle-backed
outer resistance still works, and the integrated candidate/alias suite remains
passing. No real API calls. Added level source is recorded in validation audit.
Final validation receives only the exact server-appended object identity; no
JSON field or owner field grants this evidence exception.
