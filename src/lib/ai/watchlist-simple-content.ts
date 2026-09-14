/** Stored simple-format content. Internal model audit/evidence stays in request diagnostics. */
export type SimpleAnalysis = {
  setup: string;
  pullbacks: Array<{ low: number; high: number; explanation: string; confirmation: string; invalidation: number }>;
  upside: Array<{ low: number; high: number; explanation: string }>;
  invalidation: { price: number; explanation: string } | null;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 8000 && !value.includes("\u0000");
const price = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
/** Shape only: never reject a whole read because of an optional area's trading interpretation. */
export function parseSimpleAnalysis(value: unknown): SimpleAnalysis | null {
  if (!record(value) || !text(value.setup) || !Array.isArray(value.pullbacks) ||
      value.pullbacks.length > 2 || !Array.isArray(value.upside) || value.upside.length > 5) return null;
  const area = (item: unknown) => record(item) && price(item.low) && price(item.high) && text(item.explanation);
  if (!value.pullbacks.every(item => area(item) && text(item.confirmation) && price(item.invalidation)) ||
      !value.upside.every(area) || (value.invalidation !== null &&
      !(record(value.invalidation) && price(value.invalidation.price) && text(value.invalidation.explanation)))) return null;
  return {
    setup: value.setup,
    pullbacks: value.pullbacks.map(item => ({ low:item.low, high:item.high, explanation:item.explanation,
      confirmation:item.confirmation, invalidation:item.invalidation })),
    upside: value.upside.map(item => ({low:item.low, high:item.high, explanation:item.explanation})),
    invalidation: value.invalidation === null ? null : {
      price:value.invalidation.price as number, explanation:value.invalidation.explanation as string },
  };
}
