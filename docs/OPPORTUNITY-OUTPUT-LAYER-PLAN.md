# Opportunity Output / Interpretation Layer Plan
## levels-system

---

# 1. Purpose

This layer converts internal system state into trader-readable output.

It is a presentation layer, not a logic layer.

It is responsible for:
- formatting information
- interpreting context for the trader
- displaying output

It is not responsible for:
- scoring
- evaluation
- adaptive logic
- signal generation

---

# 2. Architecture Position

Final system flow:

market -> levels -> monitoring -> scoring -> stability -> persistence -> interpretation -> output

Interpretation is the last step before user-facing output.

---

# 3. Core Principle

The system outputs context, not signals.

Correct:
- "watching pullback into support near 2.40"
- "price testing support near 2.40 - watching reaction"
- "buyers reacting at support near 2.40"

Incorrect:
- "buy now"
- "strong buy"
- "guaranteed entry"

---

# 4. Input Contract

Interpretation receives:

```ts
{
  opportunity,
  levels,
  structure,
  adaptiveState
}
```

---

# 5. Output Contract

Interpretation returns:

```ts
{
  symbol: string,
  message: string,
  type: InterpretationType,
  confidence: number,
  tags: string[],
  timestamp: number
}
```

---

# 6. Interpretation Types

Fixed categories:

- `pre_zone`
- `in_zone`
- `confirmation`
- `weakening`
- `breakout_context`
- `neutral`

These are fixed and must not be dynamic.

---

# 7. State Progression Model

Primary staged progression:

`pre_zone -> in_zone -> confirmation`

The layer must not skip stages in that chain.

Other types:
- `weakening`
- `breakout_context`
- `neutral`

These are still deterministic, but they are not part of the main three-step progression chain.

---

# 8. Deterministic Interpretation Rules

## 8.1 Pre-Zone

Condition:
- breakout or upward-context setup before zone test

Approved message:
- `watching pullback into support near {level}`

## 8.2 In-Zone

Condition:
- `level_touch`

Approved message:
- `price testing support near {level} - watching reaction`

## 8.3 Confirmation

Condition:
- `rejection` or `reclaim`
- only when progression state allows confirmation

Approved message:
- `buyers reacting at support near {level}`

## 8.4 Weakening

Condition:
- weak streak above zero
- adaptive multiplier below `1`

Approved message:
- `support weakening near {level}`

## 8.5 Breakout Context

Condition:
- breakout event
- breakout structure context
- progression state already advanced enough to allow continuation context

Approved message:
- `holding above breakout level near {level}`

## 8.6 Neutral

Condition:
- no stronger interpretation rule applies

Approved message:
- `potential buy zone below near {level}`

---

# 9. Approved Message Map

The accepted deterministic implementation uses exactly one template per type:

- `pre_zone` -> `watching pullback into support near {level}`
- `in_zone` -> `price testing support near {level} - watching reaction`
- `confirmation` -> `buyers reacting at support near {level}`
- `weakening` -> `support weakening near {level}`
- `breakout_context` -> `holding above breakout level near {level}`
- `neutral` -> `potential buy zone below near {level}`

No randomized wording.
No free-form fallback text.
No synonym variation.

---

# 10. Confidence Model

Use existing system inputs only:

- adaptive multiplier
- weak streak
- event strength

Simple deterministic model:

`confidence = baseScore * adaptiveMultiplier * weaknessAdjustment`

Do not introduce a new scoring system.

---

# 11. Noise Control

Prevent spam with:

- duplicate suppression
- identical type + same level suppression
- cooldown per symbol + type

---

# 12. Level Formatting

Level formatting must be deterministic:

- values `>= 1` render with 2 decimals
- values `< 1` render with 4 decimals

The same numeric input must always render the same output string.

---

# 13. Punctuation And Spacing

Console and message formatting must use stable ASCII punctuation.

Accepted phrase example:

`price testing support near 2.40 - watching reaction`

Use the same spacing and punctuation everywhere.

---

# 14. Console Output Format

Output format must always be:

```text
SYMBOL: <symbol>
TYPE: <type>
MESSAGE: <message>
CONFIDENCE: <value>
```

Example:

```text
SYMBOL: ALBT
TYPE: in_zone
MESSAGE: price testing support near 2.40 - watching reaction
CONFIDENCE: 0.68
```

---

# 15. Integration Point

Inside:

`src/lib/monitoring/opportunity-runtime-controller.ts`

Flow:
1. scoring
2. stability applied
3. interpretation generated
4. console output

Interpretation must not feed back into system behavior.

---

# 16. Testing Objective

Test message quality and deterministic behavior, not business logic.

Check:
- clarity
- timing
- usefulness
- noise level
- progression correctness
- exact string determinism

---

# 17. Failure Modes

The layer is wrong if:

- messages are too frequent
- messages contradict each other
- messages appear too late
- messages are too confident
- messages skip progression stages
- the same input produces different output text
- unsupported wording appears

---

# 18. Success Criteria

The layer is correct when:

- messages match chart behavior
- progression feels natural
- output is not spammy
- confidence is not misleading
- the trader can understand context instantly
- identical input produces byte-identical output

---

# 19. Future

Possible later work:
- Discord output
- website UI
- user filters
- alert thresholds

Do not implement those here.

---

# Final Principle

This layer is how the system communicates.

It is not how the system thinks.
