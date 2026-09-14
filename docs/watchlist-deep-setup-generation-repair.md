# Deep dip-buy generation repair

Status: active. Local completed-response owner review repair is focused-test verified;
five-ticker live acceptance and full analysis-quality acceptance remain incomplete.

Owner requires complete useful analysis for dip buyers and breakout/momentum
traders in one normal request, including deep setups and farther price paths.
An absent deep section is not an acceptable claim of completed feature work.

## Confirmed BMGL evidence

The saved request includes candidate `1m-pre-impulse-base`, 5.13–5.57, with
eight observed one-minute bodies, and a separate broader move origin at 4.58.
The model returned that deep base but put invalidation at 5.42 inside it. The
same response selected momentumFailure 5.42. The validator correctly detects
the arithmetic contradiction but the end product loses all deep coverage.
The raw response must remain preserved; no replacement number has been inferred.

## Smallest experiment proposed

Current JSON property order emits the core failure before pullback plans.
Hypothesis (not proven): requesting evidence-backed pullback structures before
the final core boundary, then explicitly reconciling the whole plan, reduces
premature commitment to a local impulse-origin failure that contradicts a deep
base. Order alone is not proof of correct analysis.

Proposed exact allowlist: service schema/prompt, service test, this document,
and the existing provider-corrections progress link. No public schema, card UI,
nullable invalidation, global validation weakening, ticker-specific rule,
automatic retry, new provider request in ordinary use, or draft publication.

Acceptance needs bounded isolated model experiments with the already saved
SOAR and BMGL packets; synthetic/mock tests cannot establish model quality.
Verify generated deep bounds, confirmation, invalidation and whole-plan failure
together against original data, plus retained upside/downside coverage. Preserve
the original packet, response, exact prompts, model, cost and rejection outcomes.
Original-packet replay never mutates live drafts. The owner subsequently authorized
new live generations of SOAR, BMGL, FTFT, NCT and ELMT, with no approval/publication.
Do not use later market data to pretend the original analysis had different evidence.

If no complete supported deep setup is generated, record failure and continue
investigation; do not mark this repair complete based on aliases or schema tests.

## September 14 implementation checkpoint

- Request properties and required-field order now place pullbackPlans before
  coreEvidence and the final momentumFailure. The public fields/types are unchanged.
- Prompt explicitly distinguishes a base's lower boundary from an impulse-origin
  price inside it, and requires joint scenario/failure selection.
- Prompt explicitly keeps deep independent when shallow is absent or only a
  local momentum pause. No additional ordinary API request was added.
- Five selected service tests and all 15 section-validation tests passed before
  adding recorded-price BMGL/SOAR regression cases. These are code checks, not
  evidence of improved model output. The SOAR arithmetic fixture uses its saved
  prices with a test-local candidate identifier; it is not a full captured replay.
- Final focused service run passes all seven selected tests, including those
  two saved-price regressions. No OpenAI call was made by these tests.
- Chrome's content export is unsupported. Saved BMGL audit is readable through
  the owner browser; requested secure artifact transfer through the existing
  Coordinator runtime read path for isolated tests. Do not copy credentials.
- The older private runner is locked to September 11 and its old cost accounting;
  do not execute it for September 14 or silently reset its historical ledger.
- Release of the two completed price-path commits is independent of this experiment.
- Help requires no change for this experiment: no control, field, workflow or
  public contract changed. Review Help again if the eventual fix changes those.

## September 14 owner-control correction and actual experiments

The owner explicitly requires every completed AI analysis to be available to
view/edit before they decide whether to publish. Semantic validation is advisory
inside a durable owner-review cycle. It must not remove completed sections,
targets or narrative, or reject the entire draft. This supersedes the earlier
automatic omission policy for owner-reviewed generations only. Ungated automatic
generation retains its existing validation policy. Transport truncation has no
complete draft to render and remains distinct from semantic findings.

- The runtime now passes ownerReviewRequired only after persisting the required
  review cycle. Existing cancellation, actor checks, version checks, explicit
  approval and Discord/publication delivery contracts remain unchanged.
- The service retains the completed original model analysis for the editable
  draft; primary breakout (or alternate when primary is absent), its checkpoints,
  approach checkpoints, both pullbacks, failure/recovery and narrative survive
  semantic findings. Checks run against a separate value and are stored as
  reviewOnly diagnostics. The original response remains in its existing audit.
- Review audit copy distinguishes advisory findings from actual omissions.
  No new public fields, settings, migration, automatic retry or paid fallback.
- The single-request default deadline becomes 180 seconds: live SOAR exhausted
  90 seconds after the separate 12k output-limit repair. Explicit overrides remain
  authoritative. Activation acknowledgement already runs independently.
- FTFT's observed 4.03–4.15 subzone is allowed within its cited 4.03–4.322 base
  using the observed 4.15 boundary. Unsupported widening/bridging stays rejected
  in the automatic path. Owner-reviewed content remains editable regardless.

Recorded original-packet experiments (all Luna; not end-to-end acceptance):

| Symbol | Result |
| --- | --- |
| BMGL | Both pullbacks; deep 5.13–5.57 with invalidation 4.95, an actual supplied 5m low; upside 9.48/10.60. |
| SOAR | First response omitted intermediate upside; revised prompt with 12k returned .259/.265/.272 and both pullbacks. The farther snapshot extension is not proven by this replay. |
| FTFT | Both pullbacks and 5.52/5.68/5.76/6.12; original validator falsely omitted the observed narrower shallow zone, now covered by regression. |
| NCT | Completed response but neither pullback; original packet supplied zero candidate zones. Not accepted. Broader structural candidate lineage under investigation. |
| ELMT | Completed response with shallow, four upside levels and recovery, but no deep. Not accepted as complete coverage. |

Live re-addition after the acknowledgement/12k releases: BMGL became Ready for
review with its editor enabled; SOAR exhausted the old 90-second deadline.
FTFT/NCT/ELMT retain their earlier truncated failed attempts pending regeneration.
None was approved or published by this worker.

Focused checkpoint: 9 owner-review/service/private-activation checks plus 30
section-validation/review-audit/omission checks passed serially. These verify code
contracts, not professional analysis quality or completed production acceptance.
Private September 14 experiments and cost accounting remain under data/analysis-replay,
never in Git. Runtime known cost was $0.3720082 before the two new live re-additions;
seven isolated experiments accounted conservatively for $0.9358636. Refresh hosted
costs before further paid experiments; total owner cap remains $5.

Help boundary: no new control. Existing save/edit/preview/approve sequence is
preserved. The generated review audit now says content is kept for owner review;
the Platform Help owner must reflect advisory rather than automatic omission for
review-required generations in the coordinated release.

Final local slice checkpoint: all 51 service tests pass, including unchanged
automatic-path rejection and single-request behavior; the 30 review/section tests
and six private activation/approval tests also pass. No full local build/server.
This is readiness to reconcile and verify the narrow repair, not completed live
acceptance of all five symbols or finished analysis-quality work.

## Chart-evidence follow-up (separate from the in-flight owner-draft release)

Original live NCT supplied daily history down to 0.26 but no selectable catalog
zones. The current historical-base detector still finds no three-overlapping-body
candidate in those 27 bars; deploying that detector alone cannot resolve the gap.
ELMT similarly has chart observations beyond its two supplied candidate areas.

Bounded same-input experiments changed only the candidate-only prompt restriction:
NCT then returned shallow 0.4397–0.4445, deep 0.4271–0.4354 and a daily recovery
zone 0.279–0.301. The shallow boundary/cited bars and deeper premarket lows were
checked directly in the original supplied OHLC data. ELMT returned both shallow
21.15–21.645 and deep 20.33–20.89, plus recovery. These prove the catalog restriction
was excluding available chart-based scenarios; they do not prove every selected
level is the best professional interpretation. Old catalog-only validator results
are not acceptance for this new evidence protocol.

The follow-up source is deliberately review-mode-only:

- Owner-reviewed prompts may use the actual supplied chart history, with exact
  timeframe/timestamp references, rather than only precomputed candidates.
- Confidence describes uncertainty; it does not tell the model to erase supported
  conditional scenarios before the owner can see them.
- The reviewed response allows six continuation checkpoints plus two approach
  checkpoints. The previous four-slot branch cap could force a choice between
  intermediate levels and the farther boundary. The owner draft retains all six.
- Ordinary automatic-mode prompt/schema remain unchanged. No additional market
  fetch, article lookup, API retry or automatic fallback was added.
- The SOAR original-packet call using the actual proposed prompt/schema completed
  with both pullbacks and .259/.265/.272, but still omitted farther resistance.
  Six available slots alone do not guarantee sufficient range.
- Owner-reviewed drafts now append actual frozen Potential Path resistance in
  ascending order when the existing route is less than 30% above the analysis
  reference price. Preserve the original AI points, include intervening mapped
  resistance, and stop at the first mapped point reaching that distance (at most
  six additions). Missing mapped levels do not manufacture a price. No additional
  provider request is made. The automatic-mode fallback remains unchanged.
- All 53 service tests pass serially, including frozen intermediate/farther map
  supplementation, unchanged original AI points, and one-request behavior.

## Production draft-preservation acceptance — September 14

Coordinator confirmed production deployment 98021436-47bc-4f76-a015-95e87d370a0c
healthy on reconciled source e58d650. Five new real production generations all
completed and prepared drafts: SOAR, BMGL, FTFT, NCT and ELMT. Admin shows all five
Ready for review; no ticker was approved or published. Private exact request,
response and prepared evidence is saved under data/analysis-replay.

This proves preservation, not final analysis quality: FTFT and NCT returned both
pullbacks; SOAR and ELMT returned only deep; BMGL returned neither. The missing
branches were already absent from the model responses, not removed by validation.
The chart-evidence follow-up above addresses the restrictive generation contract
and still requires live verification after its separate coordinated release.
Known hosted spend is $0.8466 with one unpriced earlier timeout. Private experiment
costs are conservatively tracked separately ($1.415134); a $2 hosted reserve is
used in the private runner's $5 total budget check. These are not an exact combined
billed total. No approval/publication or Discord test message has been sent.

The manual refresh completion banner said "Published" even for a held review
draft. Corrected that banner to "Generated" and failures to generation wording;
the separate row state and approval action remain authoritative. No publication
logic changed. This is a distinct small copy follow-up to the generation commit.
