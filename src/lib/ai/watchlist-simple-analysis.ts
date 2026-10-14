/** Simplified analysis prompt used by the live generator and isolated replays. */
import { SHARED_PULLBACK_SELECTION, PULLBACK_COMPARISON_RULES, withPullbackSelectionAudit } from './watchlist-active-momentum.js';
import { prepareSimpleAnalysisInput } from './watchlist-simple-input.js';
const SIMPLE_ANALYSIS_BASE_PROMPT = `Write a concise, useful micro/nano-cap day-trading analysis using the supplied marketPacket and TradersLink article. Read the whole session and daily history, not just the latest candles. This is a test alternative to the existing read.
Candle identifiers and candle timestamps are internal evidence only. Never quote timeframe:epoch identifiers, raw epoch numbers, or candle times in member-facing prose. Describe price structure in ordinary trading language. Keep IDs only in dedicated evidence fields when required; preserve price levels.

When priceAction.marketTiming says the market is closed, analyze the dated completed session for future setups; do not describe it as live trading or today's activity. Keep the actual observation date/time in the packet distinct from the request time.

Reader-facing news wording: describe the company event itself, not the article or how it was supplied. Never use 'the supplied article', 'the TradersLink article', 'the article reports', 'according to the provided article', or equivalent source narration anywhere in visible analysis. For example, rewrite 'The supplied TradersLink article reports that GRML entered an agreement' as 'GRML entered an agreement.' This is a wording example, not a fact to reuse. Preserve uncertainty, attribution to company claims, dates, amounts and other factual qualifications; do not turn an allegation or company expectation into a confirmed outcome. Before returning JSON, check visible news prose and remove source-introduction wording while retaining the factual statement. Do not add links to visible prose or change source metadata.

Describe the current setup in one or two short sentences. Distinguish the latest move from the broader structure. Use marketClock for Eastern market time, not UTC candle clock values or the time this test runs. Do not call a midday move 'into the close'. Use candleCoverage to know which timeframes are actually present; never claim four-hour confirmation when 4h is unavailable.

Chart-first selection: read the supplied OHLCV chronologically, including earlier sessions when relevant. Identify the active advance, its subsequent retracements and the current trading range. Apply the shared pullback-selection instructions below; candidate summaries are observations, not prescribed zones.

First complete selectionAudit (internal, not visible): expansionAndBase identifies the active advance and its subsequent structure using supplied bars. nearbyShelfRole compares meaningful nearer AND intermediate areas, including observed later tests, rebounds, breaks and reclaims. selectedPullbackReason explains the selected areas and concrete reasons for omitting meaningful alternatives before an older origin. Do not assume the nearest area is a shelf or that a lower area is preferable. EvidenceRefs must cite actual supplied timeframe and timestamp.

Historical relevance: a sharp collapse can be real; do not assume a split, bad data or an adjusted-price mismatch. Keep the old history in context, but prioritize the active post-collapse structure for practical day-trading continuation. Do not jump from cents to remote multi-dollar levels merely to meet a coverage percentage. A financing/subscription price is not chart support by itself. Group only genuinely clustered supply; do not merge several distinct trading areas into an enormous zone to satisfy the row limit.

Choose one or two useful dip-buy areas supported by the current structure. A pullback zone is a future LOWER retest area: its entire low-to-high interval must be below marketPacket.currentPrice. A reclaim price belongs in confirmation, not in the zone's high. If price is already testing a band that contains or extends above the reference, describe that current test in setup and its reclaim in the relevant upside explanation; select an independently supported lower dip area for pullbacks. Do not clip a zone to the reference, invent a lower endpoint, or relabel a current-price pause as a dip merely to fill a box. Use exact observed structural endpoints and cite the supplied bars that establish each endpoint; a cited rebound high is not automatically the zone boundary. Distinguish a demonstrated defense from a prospective retest requiring fresh buyer confirmation. If only one lower area is useful, retain it without inventing another. Explain buyer confirmation. Do not generate pullback invalidation or first-objective fields.

Two pullback areas should offer distinct structural scenarios, not two slices of the same nearby consolidation. Compare the lower tested/reclaimed areas in descending price order before choosing an older origin. Prefer a meaningful intermediate defended area over an older base when it remains relevant; if a recent higher area is only the current test, put that in setup and use the next useful lower areas for the dip plans. Do not skip an intermediate defense merely because it lacks a catalog ID, and do not merge separate structures into a broad zone. Judge separation from their own tests, rebounds and failure/reclaim history, not a fixed percentage or a forced distance. Keep this reasoning internal; public explanations stay brief.

Do not create a separate momentum trigger or must-clear section. Put any necessary breakout or reclaim condition directly into the relevant upside explanation. Use actual rejection highs, range boundaries or prior-session supply, not an arbitrary increment above the reference price. A brief pause without a demonstrated reset may be mentioned there as momentum context; do not categorically exclude a nearer tested pullback from pullbacks.

Where it could go: cover the broader volatile day-trading opportunity, not just the next small move. Select two or three significant upside areas; use a fourth for a materially different farther area. Preserve useful intermediate levels AND include resistance at least 30% above reference when the supplied chart supports it. Thirty percent is a coverage floor, NOT a ceiling: include a relevant farther historical area beyond that when useful. Review the full supplied daily and intraday history before saying there is nothing farther. Group genuinely clustered supply, not an enormous price range. Keep each explanation short, with any breakout condition included there. Say 'resistance', not 'next mapped resistance'. Never generate rounded prices simply to extend coverage. If supplied history establishes an all-time high, say 'Above $X, the stock enters new highs with no established historical resistance.' If the history is only a bounded sample, say 'No higher resistance is identified in the supplied history.' Put this short statement in the explanation of the highest evidenced area; do not add a fabricated numeric row. An empty supplemental map alone does not establish new highs. Never claim a historical date without checking the bar's date.

Do not generate a Thesis invalidation section. A local pullback can fail without erasing a valid deeper setup. Do not add a separate recovery scenario. A valid deeper dip-buy area belongs with pullbacks, not a duplicate recovery section.

Upside presentation: each row is ONE compact reaction area or ONE representative observed price (low equals high), not the whole journey between multiple resistances. If a historical region is wide, select its nearest relevant boundary or strongest rejection price rather than merging the whole region into a band. Preserve the next distinct area before jumping to a remote historical extreme. Use at most two short sentences per explanation; do not append an inventory of additional prices inside the last explanation to bypass the row limit. You do not need to describe where historical coverage ends on every ticker. Mention absent higher resistance only when the selected area actually reaches the highest price in the available history. Broad coverage means well-chosen areas, not listing the entire history.

Do not put an area in upside if your own explanation would call it unrelated to the active price regime or not a practical continuation area. In particular, after an observed collapse, an isolated pre-collapse multi-dollar area with no intermediate current structure is not a useful addition to a cents-priced read. Keep genuine older resistance when it provides a coherent continuation route; do not erase older history categorically. When no useful farther area is supported, retain the valid nearer analysis without an extra row or a failed generation. This exception does not permit omitting useful 30%-plus resistance that is present.

Use ordinary trader language. No candle clock times, UTC timestamps, evidence IDs or technical validation language in visible prose. Exact references belong only in evidenceRefs. EvidenceRefs contain only timeframe plus timestamp; verify the cited bar actually supports the quoted price and interpretation. Do not append copied OHLC or volume values to evidenceRefs. Do not call a selected overhead area the 'first' or 'nearest' if nearer meaningful reactions exist; it is a selected significant area, not an exhaustive ladder. Do not explain internal selection rules, omitted sections, the 30% requirement or missing article plumbing to readers. Keep each explanation short. No standalone listing, dilution, caution-below, needs-to-hold or downside-ladder sections. Mention supplied catalyst facts briefly when relevant.

Use regularSessionExtremes for the full regular-session high and low; regular_after_opening_range is only a later phase, not the full regular session. A newer one-minute extreme can supersede an older five-minute summary. Distinguish all-session high from regular-session high. Never attribute a historical spike to a catalyst just because today's article mentions that theme. State only catalyst facts actually supplied for the relevant date. frozenResistanceSupplement contains only prices corroborated against supplied candle highs; it is not an exhaustive inventory. Use the raw chart history as well. Do not assume a generic map entry proves historical buying or selling. No external research or extra requests. Return only the schema JSON.\n\n${SHARED_PULLBACK_SELECTION}`;

export const SIMPLE_ANALYSIS_PROMPT = SIMPLE_ANALYSIS_BASE_PROMPT + '\n' + PULLBACK_COMPARISON_RULES;
const string = { type: 'string' } as const;
const price = { type: 'number', exclusiveMinimum: 0 } as const;
const refs = { type: 'array', items: string, minItems: 1, maxItems: 8 } as const;
const object = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
});
const area = object({ low: price, high: price, explanation: string, evidenceRefs: refs });
export const SIMPLE_ANALYSIS_SCHEMA = withPullbackSelectionAudit(object({
  selectionAudit: object({ expansionAndBase: string, nearbyShelfRole: string, selectedPullbackReason: string }),
  setup: string,
  pullbacks: { type: 'array', minItems: 0, maxItems: 2, items: object({
    low: price, high: price, confirmation: string,
    explanation: string, evidenceRefs: refs,
  }) },
  upside: { type: 'array', minItems: 0, maxItems: 4, items: area },
}));

export function buildSimpleAnalysisTestRequest(marketInput: unknown) {
  return {
    model: 'gpt-5.6-luna', reasoning: { effort: 'high' }, max_output_tokens: 16000,
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: SIMPLE_ANALYSIS_PROMPT }] },
      { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(prepareSimpleAnalysisInput(marketInput)) }] },
    ],
    text: { format: { type: 'json_schema', name: 'watchlist_simple_analysis_test', strict: true, schema: SIMPLE_ANALYSIS_SCHEMA } },
  };
}
