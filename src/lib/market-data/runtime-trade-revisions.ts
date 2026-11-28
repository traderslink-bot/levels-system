/** Invalidation metadata only; canonical corrected OHLCV comes from Gateway history. */
export const MAX_RUNTIME_TRADE_REVISION_WINDOW_MS = 730 * 86_400_000;
export type RuntimeTradeRevisionRequest = { symbols: readonly string[]; start: number; end: number };
export type RuntimeTradeRevision = { minutes: number[]; pending: boolean; revision: string | null };
export type RuntimeTradeRevisions = {
  feed: "sip"; generation?: number; symbols: Partial<Record<string, RuntimeTradeRevision>>;
};

export function runtimeTradeRevisionQuery(request: RuntimeTradeRevisionRequest, now: number): URLSearchParams {
  const { symbols, start, end } = request;
  if (!symbols.length || symbols.length > 400 || new Set(symbols).size !== symbols.length ||
      symbols.some(symbol => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start ||
      end > now + 60_000 || end - start > MAX_RUNTIME_TRADE_REVISION_WINDOW_MS) {
    throw Error("Invalid trade correction scope.");
  }
  return new URLSearchParams({ symbols: symbols.join(","), start: String(start), end: String(end) });
}

export function parseRuntimeTradeRevisions(payload: unknown, request: RuntimeTradeRevisionRequest): RuntimeTradeRevisions {
  const reply = payload as RuntimeTradeRevisions | null;
  if (reply?.feed !== "sip" || !reply.symbols || typeof reply.symbols !== "object" || Array.isArray(reply.symbols) ||
      reply.generation !== undefined && (!Number.isSafeInteger(reply.generation) || reply.generation < 0)) {
    throw Error("Invalid trade correction response.");
  }
  const requested = new Set(request.symbols);
  for (const [symbol, entry] of Object.entries(reply.symbols)) {
    if (!requested.has(symbol) || !entry || typeof entry.pending !== "boolean" ||
        !Array.isArray(entry.minutes) || !entry.minutes.every((minute, index) =>
          Number.isSafeInteger(minute) && minute % 60 === 0 && minute * 1000 >= request.start &&
          minute * 1000 < request.end && (!index || minute > entry.minutes[index - 1]!)) ||
        (entry.minutes.length ? typeof entry.revision !== "string" || !/^[a-f0-9]{64}$/.test(entry.revision)
          : !entry.pending || entry.revision !== null)) throw Error("Invalid trade correction response.");
  }
  return reply;
}
