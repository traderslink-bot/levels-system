# Timeframe Role Split Plan
## levels-system

---

# 1. Purpose

This plan defines a cleaner role split for timeframe usage in the support/resistance engine.

The goal is not to add more timeframes just because we can.

The goal is to make the system read small-cap charts more like a strong trader:
- major structure from higher timeframes
- live session context from intraday structure
- less noise from over-relying on `5m`

---

# 2. Problem

The current system uses:
- `daily`
- `4h`
- `5m`

That works, but it mixes two different jobs:

1. structural support/resistance discovery
2. immediate session/micro-move context

`5m` is often too noisy to carry real structural weight.

At the same time, some small-cap runners create important same-day structure that does not exist yet on `daily` or `4h`.

So the system still needs some intraday read, but `5m` should probably not be treated as a major structural source.

---

# 3. Core Thesis

Use each timeframe for a different job.

Recommended role split:

- `daily`
  - major support/resistance backbone
  - historical overhead map
  - prior spike highs and important shelves

- `4h`
  - intermediate structure
  - nearby higher-timeframe continuation levels
  - cleaner same-trend structure than `5m`

- `15m`
  - intraday structural context
  - same-day runner shelves
  - failed pushes, reclaims, local trend continuation
  - opening-session structural read without `5m` noise

- `5m`
  - micro-context only
  - opening range
  - immediate reclaim/failure behavior
  - very near reaction reference
  - not a dominant support/resistance source

---

# 4. Design Direction

The preferred future design is not:
- "replace `4h` with `15m`"
- "make `5m` more important"

The preferred design is:
- keep `daily` and `4h` as the structural backbone
- add `15m` as the main intraday structural timeframe
- demote `5m` to a lighter-weight micro-context role

This should make the system more trader-like on PR/news runners without letting noisy `5m` structure dominate the ladder.

---

# 5. Immediate Rules

Until `15m` exists in the engine, future work should follow these rules:

- do not treat weak or missing `5m` as meaning the whole symbol is unreadable
- do not let `5m` dominate the major surfaced ladder
- continue prioritizing `daily` and `4h` for meaningful support/resistance
- keep using `5m` for near live context where useful

Validation interpretation rule:

- if `daily` and `4h` are usable but `5m` is weak, the symbol should generally still be considered structurally readable

---

# 6. Why `15m`

`15m` is the most likely best intraday structural timeframe because it is:
- much less noisy than `5m`
- still responsive enough for same-day runner structure
- better for detecting intraday shelves, failed breakouts, and reclaim zones
- more likely to produce trader-meaningful local levels

`15m` should help with:
- early runner structure
- intraday continuation structure
- news/press-release moves that are too new for `4h` / `daily`

---

# 7. Why Keep `5m`

`5m` still has value, but not as a major structural authority.

Keep `5m` for:
- opening range high/low
- immediate live reaction context
- micro confirmation / rejection behavior
- local price reference near the current move

This means `5m` should be:
- lighter-weight
- easier to suppress
- less trusted for far / extension structure

---

# 8. Higher-Timeframe Lookback

Another connected problem is historical depth.

Small-cap runners can move:
- `50%`
- `100%`
- `150%`
- `200%+`

That means real overhead resistance may exist far back in `daily` or `4h` history.

So future work should also consider:
- deeper `daily` lookback
- deeper `4h` lookback
- especially for symbols whose current price is still far below prior historical spike zones

This is separate from the timeframe-role issue, but closely related.

---

# 9. Recommended Implementation Order

Do not implement all of this at once.

Recommended order:

1. stop over-penalizing symbols when `5m` is weak but `daily` / `4h` are still usable
2. add `15m` support to candle types, fetch planning, provider mapping, and validation
3. introduce `15m` as the primary intraday structural timeframe
4. reduce `5m` structural influence and keep it for micro-context
5. optionally deepen `daily` / `4h` lookback for extreme small-cap overhead discovery

Status:

- step `1` is now implemented
- later steps remain future work and should be evaluated with the validation system before being promoted into the engine

---

# 10. Validation Expectations

After a future `15m` implementation, validation should be used to check:

- whether surfaced resistance usefulness improves versus the old `5m`-heavy intraday mix
- whether near and intermediate usefulness improve without adding clutter
- whether `5m` missing-data cases stop collapsing otherwise-usable symbols
- whether far / extension usefulness improves when the main ladder becomes more structurally sound

---

# 11. Recommendation

Current recommendation:

- do not rush a `15m` implementation as an unplanned hotfix
- do not keep treating `5m` as a primary structural read
- use this role split as the design target for future timeframe work

Short version:

- `daily` = backbone
- `4h` = intermediate structure
- `15m` = intraday structure
- `5m` = micro-context only

---

# Final Principle

The system should not use every timeframe for the same job.

Better chart reading will come from assigning each timeframe a clearer role.
