# Closed-Market Next Improvements Execution Plan

This file is the working plan for the next practical improvements that can be built while the market is closed. It is written for Codex in this repo, and it should also help the Codex working in `trader-intelligence-v2` understand which parts are operator tooling, which parts are trader-facing, and which parts belong in the shared candle/structure engine.

The goal is not to add more Discord chatter. The goal is to make the app more trustworthy, faster to reason about, and easier to audit before the next live session.

## Product Rules

- Long-biased traders only.
- No direct buy/sell/entry/exit instructions in trader-facing Discord.
- No short-trade framing.
- Operator/testing/debug language stays out of Discord.
- Reducing noise must not hide real support/resistance levels.
- Do not invent levels to make a ladder look cleaner.
- Prefer operator/audit/UI visibility first, then trader-facing language only after proof.

## Step 1 - Candle Freshness Gap

Problem:

The app can keep posting while the cached candle evidence used for audits only covers part of the session. When that happens, a later audit can look wrong or incomplete because the candle cache is stale even though Discord posts continued.

Implementation:

- Keep candle freshness/readiness in the session behavior audit.
- Report each symbol/timeframe as `fresh`, `usable`, `stale`, or `missing`.
- Report readiness as `ready`, `partial`, or `blocked`.
- Include latest candle timestamp, lag to the last saved Discord post, and cache coverage in the markdown report.
- Treat stale candle evidence as operator-only uncertainty, not a trader-facing issue.
- Make the audit avoid strong conclusions when readiness is not `ready`.

Acceptance:

- The report clearly says when a symbol cannot be judged from candle evidence.
- `possibly_too_quiet` is not claimed with stale/partial candles unless the report marks it as mixed/unproven.
- Monday replay/checklist output includes the session behavior report.

## Step 2 - Activation Speed With Cached Levels

Problem:

Full restarts still rebuild the active list from candle data, so restoring many tickers can take several minutes. A warm-start path could help, but it must not post stale or misleading Discord messages.

Implementation posture:

- Keep the current live rebuild behavior as the safe source of truth.
- Add operator readiness language and docs for a future cached-level warm start.
- The warm start should only be allowed when:
  - symbol matches,
  - session date matches or the persisted level set is explicitly marked historical,
  - price source is fresh enough,
  - candle provider reports healthy,
  - restored levels are marked `cached_restoring`, not fully active.
- The first Discord post after restart must still wait for fresh price context and safe level evidence.

Acceptance:

- No stale cached snapshot is posted as if it were fresh.
- The UI/audit can explain why a symbol is still rebuilding.
- The handoff docs make clear that provider-owned candle acquisition is the durable solution.

## Step 3 - Post Budget Dashboard In UI

Problem:

The UI should make it obvious when a thread is noisy, possibly too quiet, or not judgeable because evidence is stale.

Implementation:

- Keep detailed scoring in operator artifacts.
- Surface enough runtime/review status in the UI so the operator sees whether post-budget audits exist and whether the latest run had noisy/quiet/data-unproven findings.
- Do not put post-budget labels into Discord trader posts.
- Keep the current review artifact list as the source for detailed reports.

Acceptance:

- The operator can find `session-behavior-audit.md`, `missed-meaningful-move-audit.md`, and related reports from the review artifacts flow.
- Discord remains trader-view only.

## Step 4 - Cleaner First-Post Trade Idea

Problem:

The first support/resistance post should read like a useful trade map, not a raw ladder dump.

Implementation:

- Keep the full ladder, because completeness matters.
- Keep closest levels line-by-line.
- Include the practical read above the ladder:
  - where price is sitting,
  - strength of nearest support/resistance,
  - what area matters most,
  - whether room is tight, balanced, or open.
- Avoid penny-by-penny risk warnings in small caps.
- Avoid advice phrasing.

Acceptance:

- First-post audit scores reward strength labels, clear current read, closest levels, and full ladder preservation.
- Tests enforce line-by-line level formatting and trader-only wording.

## Step 5 - Better Possibly-Too-Quiet Calibration

Problem:

The app should not overcorrect from "too many posts" into "too few posts." At the same time, an audit with stale candles should not confidently say the thread was too quiet.

Implementation:

- Use missed meaningful move evidence, but gate conclusions by candle readiness.
- If candle readiness is `ready` and there are clear missed major moves, mark `possibly_too_quiet`.
- If candle readiness is partial/blocked and missed-move evidence appears, mark `mixed_review` or `data_unproven`.
- Keep reasons explicit in markdown.

Acceptance:

- The audit can distinguish "possibly too quiet" from "cannot prove it with current cache."
- Tests cover stale/partial candle evidence with missed moves.

## Step 6 - End-Of-Session Recap Preview

Problem:

The operator needs a quick after-action preview of each thread without reading every post.

Implementation:

- Add an operator-only recap preview to the session behavior audit.
- Include:
  - behavior profile,
  - post count versus expected budget,
  - readiness state,
  - first-post quality,
  - missed-move/noise notes,
  - candle range/max 5m move when available.
- Keep this out of live Discord unless later explicitly converted into a trader-safe recap flow.

Acceptance:

- `session-behavior-audit.md` shows a short "Operator recap preview" for reviewed symbols.
- The preview is evidence-based and does not contain buy/sell instructions.

## Step 7 - Real Provider Abstraction Plan

Problem:

IBKR is useful for testing but may not be the final provider. The shared engine and consumer project need provider ownership to stay clean.

Implementation:

- Keep documenting that `levels-system` owns candle fetching, normalization, multi-timeframe preparation, support/resistance, structure, indicators, and diagnostics.
- Keep the candle-array API for tests and consumers that already have candles.
- Keep the symbol/session API and trade-analysis candle context path for `trader-intelligence-v2`.
- Provider-specific details must stay below the public API.

Acceptance:

- `docs/51...` and `docs/52...` describe the public boundary.
- The consumer app does not need to import internal source files or fetch its own candles long term.

## Execution Checklist

- [x] Update session behavior audit calibration.
- [x] Add operator recap preview to JSON and markdown.
- [x] Strengthen tests around candle readiness and possibly-too-quiet findings.
- [x] Extend primary trade-area locking across the broader structure-budget window so boring range/chop does not restart the same Discord story every few minutes.
- [x] Add richer operator `whyNotPosted` evidence to suppressed intelligent-alert and follow-through decisions.
- [x] Replace confident missing-level wording with a fresh-level-check gate before treating a path as open.
- [x] Update docs and handoff pointers.
- [x] Run focused audit tests.
- [x] Run build.
- [x] Run full test suite when practical.

## 2026-05-02 Product Cleanup Addendum

These changes were added after the initial plan because they directly address live issues seen in CYCU/PBM/FATN/AKAN/CUE-style sessions:

### Main Trade-Area Lock

The primary trade-area lock now uses the broader structure-budget window instead
of only the short range-chop window. For boring range behavior, one recent post
inside the same locked practical area is enough to suppress another weak/testing
probe until price actually accepts an escape or the structure materially changes.

This is designed for the "it touched resistance, dipped, touched again, dipped
again" problem. The app should preserve real breakouts, accepted reclaims, and
material structure changes, but not narrate the same small-cap box all day.

### Why-No-Post Operator Evidence

Suppressed intelligent-alert and follow-through decisions now include richer
operator details such as:

- `whyNotPosted`
- level and trigger price
- event type and zone kind
- acceptance label
- range-box label
- behavior-budget label
- trade-story state
- primary trade-area lock state

This is intentionally not Discord-visible trader wording. It is proof for the
operator and audits so we can tell whether the app stayed quiet for the right
reason.

### Fresh-Level Check Wording

When the app cannot find higher resistance or lower support in the active level
state, trader-facing text should not imply certainty or "open air." The wording
now points to a fresh level check before treating the path as open.

This keeps the post useful without claiming that no resistance/support exists.
