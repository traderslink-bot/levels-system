# Watchlist research scope — September 14

Source correction complete; release and hosted acceptance pending.

- Owner requested no more AI listing-monitor or dilution-risk research.
- Removed those research instructions from both Current-analysis prompts.
  Outgoing structured schemas omit both fields, so AI need not fill them.
  Simple already excludes these topics and external research.
- Catalyst input and permitted news research remain unchanged. Existing
  optional web-search configuration is preserved, not enabled by this change.
  Source defaults search off; the hosted setting was not inspected or changed.
  No historical search usage or charges can be inferred from prompt wording.
- Missing legacy research fields normalize to unknown for payload compatibility;
  old saved records and owner edits are not rewritten or deleted.
- Request audits now hash the actual selected prompt/schema, including the
  owner-review variant, rather than always hashing the older standard constants.
- Two focused Node checks passed, one per prompt/schema variant. No paid API
  calls, server, broad suite, build, deployment or hosted setting changes.
- Help check in Platform: Watchlist Help does not advertise either monitor.
  Earlier card-removal source remains pending Platform release.
