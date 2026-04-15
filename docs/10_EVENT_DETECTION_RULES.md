# Event Detection Rules

## Breakout

Trigger when:
- price was below a resistance zone
- price moves above the zone high
- confirmation threshold is met

Suggested confirmation:
- price exceeds zoneHigh by a minimum breakout percent
- or close remains above zoneHigh for N updates

## Breakdown

Trigger when:
- price was above a support zone
- price moves below zoneLow
- confirmation threshold is met

## Rejection

Trigger when:
- price enters or touches a zone
- price reverses away without confirming through it

## Fake breakout

Trigger when:
- breakout is attempted
- price gets above resistance
- price falls back inside or below the zone within the failure window

## Fake breakdown

Trigger when:
- breakdown is attempted
- price loses support
- price quickly reclaims the zone

## Reclaim

Trigger when:
- price had been below a resistance area or prior lost support
- price moves back above and starts holding

## Compression

Trigger when:
- price remains very near a key level
- short-term range tightens
- multiple updates occur without decisive break

## Important note

All of these should be driven by state transitions, not only one-off comparisons.
