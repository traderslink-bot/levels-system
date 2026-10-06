export type AnalysisUpdateContext = Readonly<{
  automatic: boolean;
  hasPreviousAnalysis?: boolean;
  categoryMoveNote?: string;
  firstAnalysisPrice: number | null;
  updatedAnalysisPrice: number | null;
}>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const price = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** A listing-only approval is not an analysis, even if the ticker is public. */
function containsPublishedAnalysis(event: Record<string, unknown>): boolean {
  const body = record(event.body);
  const website = record(record(body.publication).website);
  if (body.draftRevision === 0 || website.tradersLinkAiReadCardVisible === false) return false;
  const card = record(record(website.cards).tradersLinkAiRead);
  try { return Object.keys(record(JSON.parse(String(card.body)))).length > 0; } catch { return false; }
}

/** Prices come only from immutable website-acknowledged analysis approvals in
 * this listing cycle, ending at this event. Never use the current market quote. */
export function analysisUpdateContextFromReview(value: unknown, approvalRevision: number): AnalysisUpdateContext {
  const review = record(value);
  const events = Array.isArray(review.events) ? review.events.map(record) : [];
  const delivered = new Set(events.filter(event => {
    const body = record(event.body);
    return body.kind === "delivery" && body.channel === "website" && body.status === "acknowledged";
  }).map(event => record(event.body).approvalRevision));
  const approvals = events.filter(event => record(event.body).kind === "approve" &&
    typeof event.revision === "number" && event.revision <= approvalRevision && delivered.has(event.revision))
    .sort((a, b) => Number(a.revision) - Number(b.revision));
  const current = approvals.find(event => event.revision === approvalRevision);
  const frozen = parseAnalysisUpdateContext(record(record(current?.body).publication).analysisUpdateContext);
  if (current && frozen) return { ...frozen, hasPreviousAnalysis: frozen.hasPreviousAnalysis ?? approvals.some(event => Number(event.revision) < approvalRevision && containsPublishedAnalysis(event)), automatic: current.actor === "runtime:automatic-boundary" };
  const readPrice = (event: Record<string, unknown>) => {
    try {
      const publication = record(record(event.body).publication);
      const card = record(record(record(publication.website).cards).tradersLinkAiRead);
      return price(record(JSON.parse(String(card.body))).currentPrice);
    } catch { return null; }
  };
  const first = approvals.find(event => readPrice(event) !== null);
  return {
    hasPreviousAnalysis: approvals.some(event => Number(event.revision) < approvalRevision && containsPublishedAnalysis(event)),
    automatic: current?.actor === "runtime:automatic-boundary",
    firstAnalysisPrice: first && first.revision !== approvalRevision ? readPrice(first) : null,
    updatedAnalysisPrice: current ? readPrice(current) : null,
  };
}

export function parseAnalysisUpdateContext(value: unknown): AnalysisUpdateContext | undefined {
  const item = record(value);
  if (typeof item.automatic !== "boolean") return undefined;
  return { ...(typeof item.hasPreviousAnalysis === "boolean" ? { hasPreviousAnalysis: item.hasPreviousAnalysis } : {}), ...(typeof item.categoryMoveNote === "string" && /^Now on (Overnight Watches|Main Session|Top Regular Hour Watches|Post-Market|General Watchlist|Swings)\.$/.test(item.categoryMoveNote) ? {categoryMoveNote:item.categoryMoveNote} : {}), automatic: item.automatic, firstAnalysisPrice: price(item.firstAnalysisPrice), updatedAnalysisPrice: price(item.updatedAnalysisPrice) };
}

export const ANALYSIS_UPDATE_EXPLANATION = "A follow-up to the original analysis, with updated levels and setups for those holding a position or watching the trade develop.";

export function analysisUpdateComparison(context?: AnalysisUpdateContext): string | null {
  const first = price(context?.firstAnalysisPrice), updated = price(context?.updatedAnalysisPrice);
  if (first === null || updated === null) return null;
  const percentage = (updated / first - 1) * 100;
  if (!Number.isFinite(percentage)) return null;
  const rounded = Math.round(percentage * 10) / 10;
  const format = (value: number) => value.toFixed(value >= 1 ? 2 : 4);
  return `Originally analyzed at $${format(first)}. Now $${format(updated)} (${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%).`;
}

/** Freeze the first acknowledged analysis price before a new draft is published. */
export function analysisUpdateContextForDraft(value: unknown, updatedPrice: unknown): AnalysisUpdateContext {
  const review = record(value);
  const events = Array.isArray(review.events) ? review.events.map(record) : [];
  const delivered = new Set(events.filter(event => { const body=record(event.body); return body.kind === "delivery" && body.channel === "website" && body.status === "acknowledged"; }).map(event => record(event.body).approvalRevision));
  const approvals=events.filter(event => record(event.body).kind === "approve" && delivered.has(event.revision)).sort((a,b)=>Number(a.revision)-Number(b.revision));
  let firstAnalysisPrice: number | null = null;
  for (const event of approvals) {
    try { const publication=record(record(event.body).publication); const card=record(record(record(publication.website).cards).tradersLinkAiRead); firstAnalysisPrice=price(record(JSON.parse(String(card.body))).currentPrice); } catch { /* Listing without analysis. */ }
    if(firstAnalysisPrice !== null) break;
  }
  return { hasPreviousAnalysis: approvals.some(containsPublishedAnalysis), automatic:false,firstAnalysisPrice,updatedAnalysisPrice:price(updatedPrice) };
}
