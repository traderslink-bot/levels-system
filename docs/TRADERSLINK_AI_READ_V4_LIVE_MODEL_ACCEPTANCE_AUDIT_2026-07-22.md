# TradersLink AI Read v4 live-model acceptance audit — 2026-07-22

## Outcome

The closed-market audit exercised every one of the 45 archived ticker snapshots through the live v4 model path without publishing, changing watchlist state, restarting a runtime, or enabling web search.

All 45 symbols ultimately produced an accepted four-horizon v4 forward plan. The first unchanged pass accepted 41 of 45 cases (91.1%) within the primary-plus-correction lifecycle. The four rejected cases were preserved and investigated rather than counted as successes:

- HIHO, SLGB, and KUST exposed an overbroad validator that treated honest wording such as `no observed resistance remains` as if a projected price had been mislabeled as observed. The validator was narrowed and all three passed live rechecks.
- BDRX twice misstated the reconstructed current premarket high. The rejection was correct; an independent recheck passed.

The audit then exposed a separate pullback/reversal coverage gap: archived reconstructions had five-minute and daily candles, but Yahoo no longer returned the historical one-minute window, and the packet discarded five-minute pullback candidates whenever one-minute candles were absent. The packet now retains observed five-minute acceptance shelves and session bases. Named live rechecks demonstrate the result for PN and STKH, while BIYA and MTEN honestly remain without structured pullback zones at low confidence.

## Replay classification and limitations

These are **historical reconstructions**, not exact original-packet replays.

`data/traderslink-ai-reads/archive.json` contains completed payloads only. It does not contain the original level snapshot, candle arrays, research packet, or raw rejected drafts. For each archived `dataAsOf`, the audit recovered:

- five-minute full-session OHLCV from Yahoo;
- daily OHLCV through the archived timestamp;
- the archived reference price;
- a prior regular-session close derived from recovered five-minute candles.

Yahoo returned HTTP 422 for the historical one-minute requests. The audit therefore records one-minute data as unavailable for all 45 reconstructed cases. Research was intentionally empty and web search was disabled, so catalyst, dilution, and listing conclusions in these replays are not exact historical reproductions.

## Broad-plan results

- Unique archived symbols: 45
- Initial accepted reads: 41/45
- Initial primary successes: 32
- Initial correction successes: 9
- Initial rejected after correction: 4
- Targeted rechecks after diagnosis: 4/4 accepted
- Symbols with an accepted four-horizon v4 reconstruction: 45/45
- Unrecoverable five-minute/daily packets: 0
- Live model: `gpt-5.6-luna`
- Configured final repair model: `gpt-5.6-terra`
- Web-search calls: 0
- Total measured cost across the broad run, diagnostic duplicates, and all targeted pullback/fallback rechecks: $5.984912

The 45 processed symbols were:

VMAR, NXXT, RPGL, BIYA, GMM, SKYQ, HIHO, SHPH, NEXR, PAPL, ADVB, SLGB, LASE, JUNS, VIVS, CCTG, VIVK, GSUN, DFNS, ZYBT, GREE, KIDZ, IPW, RDGT, ZNB, CHAI, AEHL, NVVE, JZXN, OMH, CPHI, LICN, HKPD, SNTG, BDRX, SXTC, LABT, INLF, KUST, KSCP, ZBAO, ZCMD, MTEN, PN, and STKH.

Notable complete-wide outcomes included:

| Symbol | Archived reference | Nearest | Continued | Strong | Extreme |
| --- | ---: | ---: | ---: | ---: | ---: |
| PN | $8.6450 | $9.00 | $9.90 | $11.87 | $20.40 |
| BIYA | $2.9500 | $3.50 | $4.15 | $4.79 | $6.90 |
| STKH | $0.7730 | $0.95 | $1.10 | $1.35 | $1.75 |
| MTEN | $1.0226 | $1.47 | $1.69 | $2.85 | $4.00 |
| KSCP | $2.0050 | $2.18 | $2.29 | $3.17 | $5.96 |
| KUST | $1.7201 | $2.15 | $2.53 | $3.00 | $4.55 |
| ZCMD | $10.7700 | $12.50 | $15.00 | $20.00 | $30.00 |
| NVVE | $8.7996 | $10.00 | $11.17 | $15.66 | $53.10 |

SKYQ and PAPL, whose archived v2/v3 reads had empty forward maps, both returned all four horizons in the live v4 reconstruction.

## Pullback, reversal, and downside recheck

The final named recheck used the wider five-minute candidate fallback and the three-stage primary/correction/fallback lifecycle.

| Symbol | Confidence | Hold | Failure | Shallow pullback | Deep pullback | Failure recovery | Downside checkpoints |
| --- | --- | ---: | ---: | --- | --- | --- | ---: |
| PN | Medium | $7.50 | $4.90 | $5.56–$5.90 | $5.00–$5.10 | $3.84–$4.31 | 2 |
| STKH | Medium | $0.73 | $0.459 | $0.5391–$0.5490 | $0.4859–$0.4885 | $0.4590–$0.4823 | 0 |
| BIYA | Low | $2.91 | $2.75 | Unavailable | Unavailable | Unavailable | 1 |
| MTEN | Low | $1.02 | $0.98 | Unavailable | Unavailable | Unavailable | 2 |

The unavailable BIYA and MTEN zones are deliberate. The service retains needs-to-hold, momentum-failure, and downside coverage but does not manufacture exact pullback or recovery zones when the reconstructed evidence and confidence do not support them.

## Corrections made from live evidence

1. **Projected/observed wording validation**
   - The prior regex rejected any phrase containing observed resistance/high language.
   - Validation now rejects only language that ties the selected projected price itself to observed structure.
   - A projected scenario may truthfully state that no observed resistance remains.

2. **Five-minute pullback fallback**
   - Missing one-minute candles no longer erase usable five-minute structure.
   - The packet can supply observed overlapping five-minute acceptance shelves and session-low bases.
   - Exact candidate IDs and zones remain mandatory; the model still cannot invent or widen a zone.

3. **Final fallback-model repair**
   - If the primary draft and its correction both fail validation, the configured fallback model receives the complete latest rejection bundle for one final repair.
   - All three responses are independently parsed, normalized, and validated.
   - A third invalid response still fails closed and cannot publish.

4. **Audit harness**
   - The harness is direct-to-service and non-publishing.
   - It disables web search, writes a checkpoint after every ticker, supports symbol subsets and resume, records each attempt and cost, and distinguishes historical reconstruction from exact replay.

## Focused verification

- Complete-wide forward validation: 7/7 passed.
- AI Read service: 25/25 passed.
- Price-action evidence suite: 8/8 passed before the final five-minute scan widening; the final five-minute fallback test passed again in isolation.
- Configured fallback-repair test passed in isolation.
- Cost-ledger and refresh-decision suites: 27/27 passed.
- Repository TypeScript check: passed with `npx tsc --noEmit --pretty false`.
- Earlier implementation verification remains unchanged: AI Read service, forward/reference/price-action, publisher/outbox/refresh, recovered sanitized fixture, and website parser suites passed before this live audit correction.

## Remaining risks

- Exact original request packets still do not exist in the 45-record archive. Claims are limited to reconstructed historical acceptance.
- Historical one-minute data was unavailable. Live runtime reads should normally have one-minute candles, but the five-minute fallback now prevents that source gap from deleting all pullback/reversal consideration.
- Model latency was highly variable, and some high-reasoning calls took several minutes.
- The final pullback change was live-checked on the four named cases, not rerun across all 45, because the broad 45-case objective had already completed and the change was isolated to pullback candidate availability.
- Low confidence may legitimately leave structured pullback and failure-recovery objects unavailable. The public read must still show hold, caution, momentum failure, downside, and the reason confidence is low.

## Operational boundary

No deployment, merge, runtime restart, watchlist mutation, website ingest, publisher call, Discord post, or production-state change was performed.
