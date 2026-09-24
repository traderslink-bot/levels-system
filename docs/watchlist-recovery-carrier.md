# Watchlist recovery carrier

Technical recovery only, requested by Visible release coordinator. Based on
68a7e0b2ecb3db289dc9d7425d885c240508231a; not a replacement feature UI.

Preserves General category, exact notes draft and automatic-analysis opt-out
through both store normalization and disk load/save. Adds the same opt-out guard
as approved full feature b9aa63f584ad58c338139a0fd57210c0453a862f. Manual requests
remain subject to existing settings. Original review, publication and delivery
implementations are unchanged. Existing approved retries/outbox replay remain.
No startup action grants approval. This is not a notification mute switch.

The old admin UI remains unchanged and cannot manage General/notes. During an
emergency rollback keep owner edits paused; do not clear entries or re-add them.
Existing ordinary categories remain in their original UI. Upgrade back to the
full feature before resuming General/notes management.

State: manual-watchlist-state.json under TRADERSLINK_MANUAL_WATCHLIST_DATA_DIR,
or LOCALAPPDATA/TradersLink/levels-system-v2 on Windows, otherwise
homedir/.traderslink/levels-system-v2. Reviews: ai-read-owner-reviews under the
same durable directory. Website outbox: LIVE_WATCHLIST_PUBLISH_OUTBOX_PATH,
otherwise process cwd/artifacts/live-watchlist-publish-outbox.json. Resolve the
actual hosted paths; do not assume all three share one directory.

Never restart unmodified 68a7e0b2 against new General data: its parser rejects
the entire state and startup continues without loading it. Preserve current
state, review directory and outbox; do not restore stale backups over owner work.

Focused verification: src/scripts/verify-watchlist-recovery-carrier.cjs, using
--repo <runtime repository> --ref <carrier SHA>. Requires TypeScript dependency.
Checks old/new disk round trips, exact review preservation, notification-off
claim prevention, every non-manual generation trigger returning before provider
access, unchanged UI/review/delivery source, and full-feature safety retention.
No provider requests, real state, notifications or hosted actions. Hosted build,
health and rollback-image verification belong to the Coordinator.
