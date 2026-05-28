# Level Intelligence Discord Facts Preview Review

Date: 2026-05-28

## Purpose

Generate a richer dry-run Discord preview from an existing `LevelEngineOutput` JSON plus supplied session, volume, volume shelf, and market context fact files.

This review is documentation and sample-artifact only. It does not change support/resistance detection, `LevelEngine` output, runtime defaults, alert routing, monitoring, production Discord behavior, or trader-context behavior.

## Input Files

- `docs/examples/level-intelligence/sample-level-engine-output.json`
- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

## Commands Run

```powershell
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-with-facts.txt
```

```powershell
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --format json --out docs/examples/level-intelligence/latest-discord-preview-with-facts.json
```

```powershell
npx tsc --noEmit
npm test
```

## Output Files

- `docs/examples/level-intelligence/latest-discord-preview-with-facts.txt`
- `docs/examples/level-intelligence/latest-discord-preview-with-facts.json`

## Quality Assessment

The facts-enhanced preview is better than the previous no-facts preview for market-reading context. It now shows why each existing support/resistance zone relates to supplied session landmarks, volume conditions, volume shelves, and market context. The output remains facts-only and does not alter the supplied level map.

The compact Discord presentation now keeps the same useful facts while reducing repetition. The prior dense facts preview created 8 Discord-sized messages with section truncation. The compact preview creates 2 Discord-sized messages with no truncation.

## Session Facts Appearing

- Major support at `3.20` is tied to low-of-day and premarket-low facts.
- Major resistance at `3.75` is tied to high-of-day and premarket-high facts.
- Intermediate support at `3.35` is tied to opening-range-low facts.
- Intermediate resistance at `3.60` is tied to opening-range-high facts.
- Intraday support at `3.40` is tied to VWAP and current/reference-price facts.

VWAP appears only as factual context. It does not change level selection, scoring, alerting, or runtime behavior.

## Volume Facts Appearing

- Volume state: `high`
- Relative volume: `3.2051`
- Dollar volume: `4275000`
- Liquidity quality: `good`
- Acceleration state: `building`
- Pullback volume state: `drying_up`
- Breakout volume state: `confirmed`

These appear as market facts only. They do not change support/resistance detection, scoring, or bucket membership.

## Shelf Facts Appearing

- `SAMP-shelf-335-343` overlaps the intermediate/intraday support area.
- `SAMP-shelf-356-365` overlaps the intermediate resistance/opening-range-high area.
- `SAMP-shelf-368-382` overlaps the major resistance/high-of-day area.

The preview states that volume shelves remain facts-only. The shelves are not converted into support/resistance levels.

## Message Count And Length

- Preview messages: `2`
- Max message length: `1800`
- Truncated: `false`
- Sections: `11`

The message count is suitable for test-channel review. The compact preview keeps grouped levels, key session facts, shelf facts, a single volume/context summary, diagnostics, and safety flags without repeating the same volume/context lines under every level.

## Wording Review

Forbidden wording scan was run against:

- `docs/examples/level-intelligence/latest-discord-preview-with-facts.txt`
- `docs/examples/level-intelligence/latest-discord-preview-with-facts.json`

No forbidden wording was found for:

- `buy`
- `sell`
- `enter`
- `exit`
- `good trade`
- `bad trade`
- `mistake`
- `should`
- `coaching`
- `p/l`
- `giveback`
- `grading`

## Next Recommended Gate

Move to a shadow/test Discord send review using the compact preview output before any broader Discord rollout. The next gate verifies:

- the 2-message compact preview renders cleanly in the test channel,
- facts remain readable on mobile,
- no recommendation/coaching/grading wording appears,
- no live alert routing changes are required,
- full detail remains available through `detailMode: "full"` for local review/debugging.

Do not change level selection or scoring as part of that gate.
