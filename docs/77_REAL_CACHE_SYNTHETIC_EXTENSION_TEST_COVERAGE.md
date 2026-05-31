# Real Cache Synthetic Extension Test Coverage

## Scope

This note records the focused regression coverage added after the real-cache extension coverage review. The tests lock current synthetic continuation-map behavior around real cached edge cases without changing support/resistance detection, LevelEngine output behavior, runtime defaults, alerts, monitoring, Discord, trader-context behavior, or journal behavior.

## Test File Added

- `src/tests/level-real-cache-synthetic-extension-cases.test.ts`

## Cases Covered

The new tests cover:

- A `DEVS`-style missing-resistance case where no synthetic resistance is produced because the `30%` target is inside the surfaced resistance map and the `50%` target rounds beyond practical max coverage.
- A focused surfaced-map case proving a synthetic resistance row is not generated when the rounded target would land inside the surfaced resistance map.
- A focused low-price rounding case proving a synthetic resistance row is not generated when the rounded target exceeds practical max range.
- A `DXYZ`-style healthy real resistance extension case proving the selected extension remains historical/real and is not mislabeled as synthetic.
- An `ENVX`-style limited downside case proving real support extensions fill the available slots before synthetic fallback is considered, even when selected coverage remains shallow.
- A normal missing-extension case proving synthetic fallback still works when it is safe and outside the surfaced map.
- A ranked-output guard proving blocked synthetic fallback leaves surfaced buckets, nearest levels, and special levels unchanged.

## Behavior Now Locked In

Current baseline behavior:

- Synthetic continuation-map fallback is active in the extension engine.
- Synthetic extensions are not added inside the surfaced map.
- Synthetic extensions are not added beyond practical max coverage after round-number adjustment.
- Real historical/candidate extensions remain preferred over synthetic extensions.
- Real extension rows do not receive synthetic metadata.
- Existing surfaced buckets, nearest levels, and special levels remain unchanged by blocked synthetic fallback.

## Still Open For Future Tuning

The real-cache review found that `DEVS`, `AIM`, and `PBM` had no resistance `extensionLevels` rows while their surfaced resistance maps already extended materially above reference price. The new tests preserve the current behavior; they do not decide whether the behavior should later be tuned.

Future work can still evaluate:

- Whether the quality audit should distinguish missing `extensionLevels` rows from forward resistance coverage already present in surfaced buckets.
- Whether synthetic target spacing should consider an in-range fallback between the surfaced frontier and practical max.
- Whether low-price round-number handling should avoid rounding just beyond max practical coverage.
- Whether a broader real-cache replay set shows enough evidence to tune synthetic conditions.

## Recommended Next Gate

Recommended next gate: `accept_current_real_cache_behavior`.

Rationale: no bug was found, and the edge cases are now covered by focused regression tests. A short acceptance gate should document the baseline before any future tuning of audit wording or synthetic spacing.
