# Trader Context Layers Implementation

## What This File Is For

This file records the first implementation pass for the next useful intelligence layers beyond support/resistance, market structure, and volume.

The goal is to make the candle-data system more trader-aware without creating more Discord noise. These layers are deterministic, structured, and quiet by default. They are meant to enrich scoring, audits, shared-engine consumers, and carefully gated trader wording later.

## Layers Added

### 1. Liquidity / Tradability

Implemented in:

- `src/lib/trader-context/trader-context.ts`

This layer reads:

- bid / ask spread when available
- recent 5-minute dollar volume
- baseline 5-minute dollar volume

It returns:

- `clean`
- `acceptable`
- `thin`
- `messy`
- `unknown`

Purpose:

- prevent the app from trusting support/resistance reactions too much when prints are thin or the spread is ugly
- keep small-cap level reads grounded in tradability, not only chart shape

### 2. Catalyst / Profile Context

Implemented in:

- `src/lib/trader-context/trader-context.ts`

This layer reads:

- market cap
- float / shares outstanding
- short interest when available
- known catalyst flag when available

It returns:

- profile risk label: `low`, `watch`, `elevated`, `unknown`
- market-cap bucket
- float bucket
- short-interest label
- catalyst label

Purpose:

- let nano-cap / micro-float names be treated with more caution
- keep company/profile risk separate from support/resistance facts

### 3. Session / Gap Context

Implemented in:

- `src/lib/trader-context/trader-context.ts`

This layer reads:

- previous day high / low / close
- premarket high / low
- opening range high / low
- current price versus those ranges

It returns:

- `gap_up`
- `gap_down`
- `inside_previous_range`
- `above_previous_high`
- `below_previous_low`
- `unknown`

Purpose:

- make the system aware of prior-day, premarket, and opening-range anchors
- support natural trader reads such as price holding above prior-day high or working inside the prior-day range

### 4. Candle Behavior / Reaction Quality

Implemented in:

- `src/lib/trader-context/trader-context.ts`

This layer reads the latest candle around an optional reference level.

It returns:

- `strong_close_through`
- `wick_rejection`
- `support_defense`
- `support_loss`
- `failed_breakout`
- `reclaim`
- `indecision`
- `unknown`

Purpose:

- reduce bad posts caused by price barely tapping through a level
- distinguish candle acceptance from wick rejection or weak reclaim attempts

### 5. Float / Market Cap / Profile Risk

This is included inside the catalyst/profile layer.

Purpose:

- treat micro-float / nano-cap names differently from ordinary liquid names
- avoid making penny moves sound too structurally important when the ticker profile is naturally volatile

### 6. Move Extension / Exhaustion

Implemented in:

- `src/lib/trader-context/trader-context.ts`

This layer reads:

- percent from intraday low
- percent from intraday high
- distance from VWAP
- distance from EMA9 / EMA20
- green candle streak

It returns:

- `normal`
- `extended`
- `stretched`
- `pulling_back`
- `unknown`

Purpose:

- identify when a move is already stretched before the app overstates a breakout or support reaction
- make future posts calmer around late-stage moves

### 7. Post Story Memory

Implemented in:

- `TraderStoryMemory`
- `buildTraderStoryKey`
- `evaluateTraderStoryMemory`

This layer returns:

- `new_story`
- `material_update`
- `repeat`
- `cooldown`

Purpose:

- track what the thread has already told the trader
- reduce repeated posts while price is still telling the same level / structure / reaction story

## Follow-Up Layers Added Later The Same Day

The second implementation pass is tracked in:

- `docs/56_TRADE_IDEA_DATA_QUALITY_AND_SMALL_CAP_CONTEXT_2026-05-02.md`

That pass added:

- small-cap volatility normalization so ordinary one-cent movement is not treated as a fresh structure story
- opening-range context from 9:30-10:00 ET 5-minute candles
- halt / pause awareness for stale candles after fast moves
- level-quality calibration for thin or wide-gap ladders
- a cross-layer data-quality gate
- deterministic trade-idea summary and first-post trade-plan lines
- operator-only no-post explanations

Those layers remain quiet by default and should not create standalone Discord posts.

## Public Shared API

The new layer is exported through:

```ts
levels-system-phase1/support-resistance-engine
```

New exports include:

```ts
buildTraderIntelligenceContext
buildLiquidityTradabilityContext
buildCatalystProfileRiskContext
buildSessionGapContext
buildCandleReactionContext
buildMoveExtensionContext
TraderStoryMemory
```

`SupportResistanceContext` now includes:

```ts
traderContext: TraderIntelligenceContext
```

That means both this app and `trader-intelligence-v2` can consume the same structured context without copying logic.

## Signal Category Rules

New quiet categories were added:

- `liquidity_tradability`
- `catalyst_context`
- `session_context`
- `move_extension`
- `story_memory`

These are not standalone Discord streams.

Default behavior:

- operator artifacts: enabled
- internal scoring: enabled
- live Discord: disabled unless explicitly gated later

## Trader-Facing Rule

These layers should not create new Discord posts by themselves.

Allowed later:

- short supporting lines inside an already-useful post
- only when data is reliable
- only when the line changes the interpretation
- no direct buy/sell/entry/exit advice

Avoid:

- `volume confirms`
- `buy here`
- `best entry`
- `sell`
- `exit`
- deterministic claims that price will move to a level

## Verification

Added tests:

- `src/tests/trader-context.test.ts`

Updated tests:

- `src/tests/support-resistance-shared-api.test.ts`
- `src/tests/signal-category-config.test.ts`
- `src/tests/signal-category-routing.test.ts`

Commands run:

```powershell
npx tsx --test src/tests/trader-context.test.ts src/tests/support-resistance-shared-api.test.ts src/tests/signal-category-config.test.ts src/tests/signal-category-routing.test.ts
npm run build
```

Latest focused result:

```text
28 passing, 0 failing
npm run build: passed
```

## Remaining Work

The next step is not to make these noisy. The next step is to collect saved-data proof:

1. add these context labels to audit rows where available
2. compare high-noise saved sessions against candle reaction and story-memory labels
3. only after review, allow one or two safe trader-facing enrichment lines
4. keep standalone posts disabled
