# Actual Watchlist Runtime neutral transport

Root assigned the existing clean Runtime release worktree at d025fb138b0286da339defdeb65b3f8232e284cc. This is the actual Watchlist/Levels backend, separate from the unused portable Platform adapter and the independent Options pilot.

The six-file source slice changes only the REST and price-stream transport boundaries, adds the exact reviewed pure codec and exercises the real adapters. The gate is `TRADERLINK_GATEWAY_CONTRACT=traderslink.market.1`; omitted means legacy. The original validators, incremental SSE parser, timing, ordering, reconnect, cancellation, provider provenance and provider choices remain. No entry/factory forwarding edit was needed. No overnight data was enabled.

Eighteen focused Node tests in three files passed, including legacy and neutral modes, the actual factory/Levels reference, price precision, nanosecond ordering, fragmented UTF8/CRLF, atomic invalid-frame rejection and subscription replacement. A full TypeScript production build passed to an isolated output directory. Both stages ran once with networking denied, source/dependencies read-only and no package cleanup hooks. All owned processes/groups and guards are closed.

Frozen source and exact receipts: `/home/traderlink/preview-runtime/provider-actual-runtime-check-_ihairpf/manifest.json`. Independent review, Root Git preservation, actual Runtime image delivery/flag activation and real signed-in full-flow acceptance remain open. Source tests are not production acceptance.
