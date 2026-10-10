import { createHash } from "node:crypto";

export type PrivateWatchlistSelection = Readonly<{ analysis: boolean; indicators: boolean; levels: boolean }>;
export type PrivateWatchlistInput = Readonly<{ protocolVersion: 1; userId: string; requestId: string; symbol: string; selection: PrivateWatchlistSelection }>;
export type PrivateWatchlistGenerationRequest = PrivateWatchlistInput & Readonly<{ requestHash: string; maximumCostMicrousd: number }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid private Watchlist request.");
  return value as Record<string, unknown>;
};
export function privateWatchlistRequestHash(input: Pick<PrivateWatchlistGenerationRequest, "symbol" | "selection" | "maximumCostMicrousd">): string {
  return createHash("sha256").update(JSON.stringify([input.symbol, input.selection.analysis, input.selection.indicators, input.selection.levels, input.maximumCostMicrousd])).digest("hex");
}
export function parsePrivateWatchlistInput(raw: unknown, generation = false): PrivateWatchlistInput {
  const value = object(raw), selection = object(value.selection);
  const fields = ["protocolVersion", "userId", "requestId", "symbol", "selection", ...(generation ? ["requestHash", "maximumCostMicrousd"] : [])];
  if (Object.keys(value).some(key => !fields.includes(key)) || value.protocolVersion !== 1 ||
    typeof value.userId !== "string" || !uuid.test(value.userId) ||
    typeof value.requestId !== "string" || !uuid.test(value.requestId) ||
    typeof value.symbol !== "string" || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(value.symbol) ||
    Object.keys(selection).some(key => !["analysis", "indicators", "levels"].includes(key)) ||
    !["analysis", "indicators", "levels"].every(key => typeof selection[key] === "boolean") ||
    !Object.values(selection).some(Boolean)) throw new Error("Invalid private Watchlist request.");
  return { protocolVersion: 1, userId: value.userId, requestId: value.requestId, symbol: value.symbol,
    selection: { analysis: selection.analysis as boolean, indicators: selection.indicators as boolean, levels: selection.levels as boolean } };
}
export function parsePrivateWatchlistGenerationRequest(raw: unknown): PrivateWatchlistGenerationRequest {
  const input = parsePrivateWatchlistInput(raw, true), value = object(raw);
  if (typeof value.maximumCostMicrousd !== "number" || !Number.isSafeInteger(value.maximumCostMicrousd) || value.maximumCostMicrousd < 0 ||
    typeof value.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(value.requestHash)) throw new Error("Invalid private Watchlist reservation.");
  const request = { ...input, maximumCostMicrousd: value.maximumCostMicrousd, requestHash: value.requestHash };
  if (privateWatchlistRequestHash(request) !== request.requestHash) throw new Error("Private Watchlist reservation conflict.");
  return request;
}
