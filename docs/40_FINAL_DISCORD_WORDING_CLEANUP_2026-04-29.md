# Final Discord Wording Cleanup

Date: 2026-04-29
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This is a short final cleanup note for Codex.

The larger trader-language and Discord-boundary work has already improved substantially.
This note only targets the **remaining rough edges** in trader-facing Discord wording.

This is **not** a large feature pass.
It is a final polish pass focused on making Discord posts feel less like tool output and more like calm trader context.

---

## Current State

Recent work already fixed the most important problems:
- AI commentary is much less advisory
- direct execution language is more tightly blocked
- trader-facing labels are cleaner than before
- system-shaped wording has been reduced

That work should be preserved.

The remaining work is smaller and mostly about tone, phrasing, and trader readability.

---

## Main Remaining Issue

Some Discord-visible wording still feels more like product/system output than natural trader-facing language.

The remaining issue is no longer dangerous advice.
The remaining issue is presentation polish.

---

## Remaining Phrases To Review

### 1. Importance / confidence line

Current style is still somewhat system-shaped:
- `Importance: high | Confidence: medium`

### Recommendation

Prefer one of these options:

#### Best option
Remove this line from live Discord posts entirely and keep it only in metadata, logs, audit files, and review artifacts.

Reason:
For newer traders, this line does not help as much as support, resistance, room, and hold/reclaim context.
It is more useful to the operator than to the trader.

#### Acceptable fallback option
If it must stay live, soften it further into calmer trader language such as:
- `Setup quality: high importance, medium confidence`

But the preferred option is still removal from live Discord.

---

### 2. Snapshot headers still feel somewhat dashboard-like

Examples:
- `LEVEL SNAPSHOT: ALBT`
- `CURRENT READ:`
- `KEY LEVELS:`
- `FULL LADDER:`
- `MAP:`

These are understandable, but still feel a little tool-shaped.

### Recommendation

Rewrite into softer trader-facing labels.

Suggested replacements:
- `LEVEL SNAPSHOT: ALBT` -> `ALBT level map`
- `CURRENT READ:` -> `What price is doing now:`
- `KEY LEVELS:` -> `Closest levels to watch:`
- `FULL LADDER:` -> `More support and resistance:`
- `MAP:` -> `Nearest support and resistance:`

Goal:
Make the thread feel like trader context rather than a system printout.

---

### 3. Extension message still feels too machine-formatted

Examples:
- `NEXT LEVELS: ALBT`
- `SIDE: RESISTANCE`
- `LEVELS: 2.90, 3.15`

### Recommendation

Rewrite into a more natural trader-facing form.

Suggested replacements:
- `NEXT LEVELS: ALBT` -> `ALBT next levels to watch`
- `SIDE: RESISTANCE` -> `Overhead resistance levels:`
- `SIDE: SUPPORT` -> `Lower support levels:`
- `LEVELS: 2.90, 3.15` -> `Levels: 2.90, 3.15`

Or even better, make the extension post read as one calm message rather than three strongly labeled system lines.

Example:
- `ALBT next levels to watch`
- `Overhead resistance levels: 2.90, 3.15`

---

### 4. Keep “What changed” and “Current read” but review consistency

Recent changes improved labels like:
- `what changed`
- `current read`
- `price change from trigger`
- `level to watch closely`

These are moving in the right direction.

### Recommendation

Do one final consistency pass across all trader-facing post types so these labels feel like they belong to the same voice.

Check that:
- follow-through posts
- state-update posts
- recap posts
- snapshots
- extensions
- stock-context opener

all sound like the same calm trader-facing assistant, not different subsystems.

---

## Specific Files To Touch

Primary file:
- `src/lib/alerts/alert-router.ts`

Secondary file if needed:
- `src/tests/alert-router.test.ts`

Possibly also:
- any formatter tests that hard-code current system-shaped labels

This should be a small focused pass.

---

## Test Expectations

Add or update tests so that:
- the old system-shaped labels are no longer expected in Discord-visible text where they were intentionally softened
- the new replacements are asserted instead
- snapshot and extension messages stay deterministic and readable

Suggested test assertions:
- no live Discord text expects `LEVEL SNAPSHOT:` if replaced
- no live Discord text expects `FULL LADDER:` if replaced
- no live Discord text expects `SIDE: RESISTANCE` if replaced
- no live Discord text expects `Importance: high | Confidence: medium` if removed or rewritten

---

## Guardrails

1. Do not undo the stronger AI/advice boundary work.
2. Do not add more words just to sound friendlier.
3. Keep posts concise and calm.
4. Do not remove important support/resistance information to reduce noise.
5. Prefer trader-facing clarity over dashboard-like labeling.

---

## Acceptance Standard

This pass is complete when:
- live Discord posts no longer contain the main remaining dashboard-like labels unless there is a strong reason to keep them
- snapshot and extension posts read more like trader context than tool output
- the severity/confidence style line is either removed from live Discord or softened appropriately
- tests are updated to match the final trader-facing wording

---

## Final Reminder

The remaining issue is polish, not architecture.

The question for every remaining line is:

> Does this sound like something a trader would want to read in a live thread, or does it still sound like the tool talking about itself?

Use that as the final cleanup filter.
