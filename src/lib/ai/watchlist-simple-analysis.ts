/** Isolated test contract. Not imported by the live Watchlist generator. */
import { prepareSimpleAnalysisInput } from './watchlist-simple-input.js';
export const SIMPLE_ANALYSIS_PROMPT = `Write a concise, useful micro/nano-cap day-trading analysis using the supplied marketPacket and TradersLink article. Read the whole session and daily history, not just the latest candles. This is a test alternative to the existing read.

Describe the current setup in one or two short sentences. Distinguish the latest move from the broader structure. Use marketClock for Eastern market time, not UTC candle clock values or the time this test runs. Do not call a midday move 'into the close'. Use candleCoverage to know which timeframes are actually present; never claim four-hour confirmation when 4h is unavailable.

Chart-first selection: the packet intentionally contains raw OHLCV rather than a ranked menu of recommended zones. Read the full five-minute session chronologically: locate the principal expansion, the first substantial consolidation after it, later tests, and the current local swing. Choose the price region where a trader waiting for a real reset would watch buyers return, not the shelf a momentum trader is already trading at. A directional sequence whose bodies share no common acceptance is not a defended base by itself. A three-bar overlap alone also does not prove support. Compare actual subsequent retests and volume response. A nearer local shelf must not displace a meaningful deeper base simply to fill two slots.

First complete selectionAudit (internal, not visible on the card): identify the expansion and substantial base from exact supplied bars, identify the nearest local shelf and decide whether it is momentum context or a genuine reset opportunity, and explain why your chosen dip area is structurally different. If a candidate lies within ordinary current fluctuations, use it only in the momentum explanation and omit it from pullbacks. Keep the meaningful lower area as the sole Pullback when that is the useful plan. This is not a fixed percentage-distance rule. Do not copy the full open-to-close span of a rising sequence as a dip-buy zone. EvidenceRefs must reference actual supplied timeframe and timestamp, never a removed synthetic candidate name.

Historical relevance: a sharp collapse can be real; do not assume a split, bad data or an adjusted-price mismatch. Keep the old history in context, but prioritize the active post-collapse structure for practical day-trading continuation. Do not jump from cents to remote multi-dollar levels merely to meet a coverage percentage. A financing/subscription price is not chart support by itself. Current local invalidation and complete unwinding to the oldest session origin are not interchangeable. Choose the structure that invalidates this actionable thesis, not mechanically the oldest low. Group only genuinely clustered supply; do not merge several distinct trading areas into an enormous zone to satisfy the row limit.

Choose one or two meaningful dip-buy areas from actual defended bases, meaningful retracements, reclaimed supply or historical support. A tiny pause just below the current quote is momentum context, not automatically a pullback. Consider the origin and size of the expansion, reported volume, retests and recent normal candle range. No universal percentage threshold. Evaluate the nearer and deeper opportunities separately BEFORE choosing broader invalidation. Inspect the lower pre-expansion base, reclaimed prior resistance and historical support too: if the nearer dip can fail while a useful lower buy-and-reclaim setup remains, include that lower setup as the second pullback. A deeper setup need not have already been retested after the latest surge; its prior structure and a future buyer-confirmation condition can support a conditional plan. Distinguish demonstrated support from a prospective retest rather than claiming buyers already defended it. Explain the deeper alternative or its absence in selectionAudit.selectedPullbackReason. If only the deeper area is meaningful, give that ONE area as Pullback. Never fill a second slot just to fill it. If the current price is already near a genuine defended base after a large retracement, describe that accurately rather than pretending a tiny additional decline is a new substantial dip. Explain buyer confirmation and what defeats that particular setup.

Do not create a separate momentum trigger or must-clear section. Put any necessary breakout or reclaim condition directly into the relevant upside explanation. Use actual rejection highs, range boundaries or prior-session supply, not an arbitrary increment above the reference price. A nearby momentum shelf may be mentioned briefly there, without becoming a dip-buy zone.

Where it could go: cover the broader volatile day-trading opportunity, not just the next small move. Select two or three significant upside areas; use a fourth for a materially different farther area. Preserve useful intermediate levels AND include resistance at least 30% above reference when the supplied chart supports it. Thirty percent is a coverage floor, NOT a ceiling: include a relevant farther historical area beyond that when useful. Review the full supplied daily and intraday history before saying there is nothing farther. Group genuinely clustered supply, not an enormous price range. Keep each explanation short, with any breakout condition included there. Say 'resistance', not 'next mapped resistance'. Never generate rounded prices simply to extend coverage. If supplied history establishes an all-time high, say 'Above $X, the stock enters new highs with no established historical resistance.' If the history is only a bounded sample, say 'No higher resistance is identified in the supplied history.' Put this short statement in the explanation of the highest evidenced area; do not add a fabricated numeric row. An empty supplemental map alone does not establish new highs. Never claim a historical date without checking the bar's date.

Give the broader thesis invalidation and explain which structure its loss breaks. It is not simply the nearest support. A local pullback can fail without erasing a valid deeper setup. Do not add a separate recovery scenario. A valid deeper dip-buy area belongs with pullbacks, not a duplicate recovery section.

Upside presentation: each row is ONE compact reaction area or ONE representative observed price (low equals high), not the whole journey between multiple resistances. If a historical region is wide, select its nearest relevant boundary or strongest rejection price rather than merging the whole region into a band. Preserve the next distinct area before jumping to a remote historical extreme. Use at most two short sentences per explanation; do not append an inventory of additional prices inside the last explanation to bypass the row limit. You do not need to describe where historical coverage ends on every ticker. Mention absent higher resistance only when the selected area actually reaches the highest price in the available history. Broad coverage means well-chosen areas, not listing the entire history.

Do not put an area in upside if your own explanation would call it unrelated to the active price regime or not a practical continuation area. In particular, after an observed collapse, an isolated pre-collapse multi-dollar area with no intermediate current structure is not a useful addition to a cents-priced read. Keep genuine older resistance when it provides a coherent continuation route; do not erase older history categorically. When no useful farther area is supported, retain the valid nearer analysis without an extra row or a failed generation. This exception does not permit omitting useful 30%-plus resistance that is present.

Use ordinary trader language. No candle clock times, UTC timestamps, evidence IDs or technical validation language in visible prose. Exact references belong only in evidenceRefs. EvidenceRefs contain only timeframe plus timestamp; verify the cited bar actually supports the quoted price and interpretation. Do not append copied OHLC or volume values to evidenceRefs. Do not call a selected overhead area the 'first' or 'nearest' if nearer meaningful reactions exist; it is a selected significant area, not an exhaustive ladder. Do not explain internal selection rules, omitted sections, the 30% requirement or missing article plumbing to readers. Keep each explanation short. No standalone listing, dilution, caution-below, needs-to-hold or downside-ladder sections. Mention supplied catalyst facts briefly when relevant.

Use regularSessionExtremes for the full regular-session high and low; regular_after_opening_range is only a later phase, not the full regular session. A newer one-minute extreme can supersede an older five-minute summary. Distinguish all-session high from regular-session high. Never attribute a historical spike to a catalyst just because today's article mentions that theme. State only catalyst facts actually supplied for the relevant date. frozenResistanceSupplement contains only prices corroborated against supplied candle highs; it is not an exhaustive inventory. Use the raw chart history as well. Do not assume a generic map entry proves historical buying or selling. No external research or extra requests. Return only the schema JSON.`;

const string = { type: 'string' } as const;
const price = { type: 'number', exclusiveMinimum: 0 } as const;
const refs = { type: 'array', items: string, minItems: 1, maxItems: 8 } as const;
const object = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
});
const area = object({ low: price, high: price, explanation: string, evidenceRefs: refs });
export const SIMPLE_ANALYSIS_SCHEMA = object({
  selectionAudit: object({ expansionAndBase: string, nearbyShelfRole: string, selectedPullbackReason: string }),
  setup: string,
  pullbacks: { type: 'array', minItems: 0, maxItems: 2, items: object({
    low: price, high: price, confirmation: string, invalidation: price,
    explanation: string, evidenceRefs: refs,
  }) },
  upside: { type: 'array', minItems: 0, maxItems: 4, items: area },
  invalidation: { anyOf: [object({ price, explanation: string, evidenceRefs: refs }), { type: 'null' }] },
});

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
