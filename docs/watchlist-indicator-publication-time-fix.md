# Approved Watchlist indicator identity correction

## Scope and verified cause

Owner requested fixing the empty ticker Indicators card, then authorized release through the coordinator on September 15, 2026. VEEA runtime activation was 1789477145748 (08:59:05 ET); its public post used the later first approved card time (09:00:50 ET). The member indicator endpoint returned a null snapshot. Platform's authenticated refresh intentionally rejects a timestamp unequal to firstPostedAt.

## Implemented

- Resolve the indicator request timestamp from the first website-acknowledged frozen approval publication, matching Platform's explicit firstPostedAt or earliest initial card timestamp.
- Later edits/reads retain that original timestamp. Pending/cancelled/missing reviews do not request public indicator refreshes. Ordinary activations and preserved legacy publications retain their activation timestamp.
- Existing Platform equality guard, calculation formulas, provider routing, scheduling, AI, owner approval and Discord delivery remain unchanged.
- No migration, data rewrite, new API request, or UI change. Existing approved reviews supply recovery evidence without reapproval or reposting.

## Verification and release boundary

- Six focused Node tests passed with one worker and a 384 MB heap.
- No local server or broad build. Hosted build and acceptance remain required: deploy runtime correction; wait for the existing two-minute poll; confirm VEEA snapshot and rendered values/timestamps; confirm no Discord posts.
- Runtime allowlist: this document; src/lib/market-data/watchlist-indicator-publication-time.ts; src/lib/monitoring/manual-watchlist-runtime-manager.ts; src/tests/watchlist-indicator-publication-time.test.ts.
- Help reviewed: this repairs existing refresh behavior, with no member-facing contract change; no Help copy changes required.
- Coordinator must reconcile this narrow commit onto the then-current runtime release parent; do not publish other dirty runtime work. Platform source and schema do not need deployment.
- Handoff attempt was blocked by the app permission reviewer. No production change is claimed.
