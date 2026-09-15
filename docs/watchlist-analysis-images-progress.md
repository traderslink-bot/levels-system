# Approved analysis image attachments

## Owner correction — section grouping

This supersedes the earlier balanced one/two-page rule below. Short content stays on one image. Longer content splits at the first visible Pullback: everything above stays on image 1; Pullback and everything below stay on image 2. Only when that second group exceeds the existing readable-height bound do catalyst/recent news and risk notes move together to image 3. No midpoint balancing, section truncation, font shrinking or empty pages. Hidden shallow pullback makes deep the split boundary; if no pullback is visible, use recovery/downside or news as available. Transport and frozen-image cache now accept up to three PNGs. Sixteen focused pagination/render/cache/transport checks passed. No deployment or real Discord post.

Owner approved the two-image VEEA visual prototype on September 15, 2026 and requested automatic one/two-page section-aware exports. The controlling design is Platform's `docs/migration/watchlist-analysis-image-preview-plan.md`.

Implementation complete locally: deterministic saved-payload rendering for current/simple reads; hidden-section preservation; fixed font, measured wrapping and section-boundary one/two-image pagination; repeated watermark and per-image ticker/time. Normal linked Discord content and mention policy preserved; multipart attachments on first message only. No AI call or real Discord send. Old frozen approvals remain unchanged.

## Verification

- 39 focused checks passed together across renderer/cache/transport, publication previews, review API and durable review store; an additional encoded-source-name concealment regression passed in the final 8-test renderer suite (40 distinct tests overall).
- Generated and visually inspected compact and two-page PNGs. Initial generic font fallback was unsuitable; now bundle unmodified Lato Regular/Bold with OFL license from Google Fonts. Font selection is explicit on Windows and Linux. The Windows sandbox reported nonfatal font-cache directory warnings; rendered glyphs verified.
- Hidden first pullback promotes remaining deep pullback; hidden content omitted; markup escaped; saved payload not mutated; oversized content is not truncated or shrunk.
- Frozen per-approval image cache reuses the same PNG bytes on retry. Text-only rendering failure is stored too. Delivery audit records attachment names, sizes and hashes, not inline image bytes.
- Existing unknown-delivery protection retained. No retry that could duplicate a message was introduced. No live posts, AI requests, deployment, provider request or local app server.

## Boundaries and release

- One image up to 1900 pixels of measured section content, otherwise a balanced two-section-group split. Maximum 4200 content pixels per image and 4 MB per PNG. An exceptionally large owner edit that cannot fit two readable images falls back to the linked post; it does not hide/truncate text in an image or block publication. No analysis edits made by the exporter.
- Runtime dependencies: pinned Sharp 0.34.5 plus lockfile; open-licensed fonts in assets/watchlist-fonts. No migration, new credentials or extra OpenAI cost. Hosted build must verify Sharp native dependency/font assets, then image-only rendering before actual attachment acceptance.
- Offline preview CLI: `node --import tsx src/scripts/export-watchlist-analysis-images.ts <saved-read.json> <new-output-directory>`. Input is the saved read or `{read, dipBuyPlanVisible}`. Does not load Discord and refuses to overwrite existing output files.
- Platform Help updated separately. Website card itself unchanged. Image cache is private per review cycle and approval revision; no public image endpoint added.
- Pending: production reconciliation by Coordinator, hosted build and real Discord attachment display verification. Owner has not yet requested release of this new image slice.

References: https://docs.discord.com/developers/reference (multipart uploads); https://sharp.pixelplumbing.com/api-constructor/ (measured text rendering/fontfile); https://github.com/google/fonts/tree/main/ofl/lato (font source/license).
