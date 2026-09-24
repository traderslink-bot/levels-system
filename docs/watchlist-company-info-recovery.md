# Company Info recovery — September 24, 2026

Owner requested Company Info for General/notes-only tickers. Cause: the legacy
activation path supplied Company Info through stock-context routing; private
review activation and approved listing snapshots did not include that card.

Fix: after website publication acknowledgement (listing-only or analysis), start
an independent company-data lookup using the existing stock-context provider and
formatter. Publish only cards.companyInfo to the website. No AI, Discord route,
email/push event, notes draft, frozen approval, price, status, group or Added time
is changed. Approval never waits for the profile lookup and provider failure does
not prevent listing or erase a previously published card.

On startup, one serial nonblocking pass covers active review-mode entries already
published before this fix. Private entries are skipped before fetching. Recheck
active status, cycle, activation epoch and publication permission after lookup so
removal/reactivation or review changes cannot leak a stale card. Per-symbol
in-flight deduplication avoids concurrent duplicate lookups. Existing stock-data
unavailable formatting remains; no invented company facts.

Focused verification uses actual extracted manager method, source policy, and
actual formatter/publisher mapping with synthetic fixtures: approved listing,
pending private review, removal/cycle race, provider failure, in-flight dedupe,
card-only output, no notification route, and preserved activation hooks.
No live API/provider request or local server/build during preparation.
Coordinator owns release/build and GET-only confirmation on CPOP/VRME. Existing
analysis/session and no-notification acceptance boundaries remain unchanged.

No migration or settings change. Additive company-card data remains readable by
the existing runtime. Help still accurately describes Company Info; no new UI or
Help behavior introduced. Follow-up to Platform's notes feature progress record.
