export type WatchlistStreamTrade = { symbol: string; price: number; timestamp: number; order: bigint };
type Frame = { connected: boolean; trades: WatchlistStreamTrade[] };
const MAX_FRAME_BYTES = 2_000_000;

/** Validate a complete frame before any prices can escape to consumers. */
export function parseWatchlistPriceFrame(raw: string, symbols: ReadonlySet<string>, now: number): Frame {
  const value = JSON.parse(raw);
  if (!value || value.protocolVersion !== 1 || value.feed !== "sip" || typeof value.connected !== "boolean"
    || !["snapshot", "delta", "status"].includes(value.kind) || !Number.isSafeInteger(value.emittedAt)
    || value.emittedAt > now + 2000 || now - value.emittedAt > 12000
    || !value.prices || typeof value.prices !== "object" || Array.isArray(value.prices)) throw Error("Invalid Watchlist price frame.");
  const rows = Object.entries(value.prices);
  if ((value.kind === "status" || !value.connected) && rows.length) throw Error("Disconnected/status frame contains prices.");
  const trades = rows.map(([symbol, input]) => {
    const row = input as Record<string, unknown>;
    if (!symbols.has(symbol) || !row || typeof row.price !== "number" || !Number.isFinite(row.price) || row.price <= 0
      || typeof row.providerObservedAt !== "string" || typeof row.receiptAt !== "number" || !Number.isSafeInteger(row.receiptAt)
      || row.receiptAt <= 0 || row.receiptAt > value.emittedAt + 2000) throw Error("Invalid Watchlist trade.");
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(row.providerObservedAt);
    const timestamp = Date.parse(row.providerObservedAt);
    if (!match || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > row.receiptAt + 2000) throw Error("Invalid trade observation time.");
    // Retain original nanosecond ordering even though existing price contracts use ms.
    const seconds = Date.parse(`${match[1]}Z`);
    if (new Date(seconds).toISOString().slice(0, 19) !== match[1]) throw Error("Invalid trade calendar date.");
    const order = BigInt(seconds) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
    return { symbol, price: row.price, timestamp, order };
  });
  return { connected: value.connected, trades };
}

/** One bounded SIP SSE attempt. Reconnection and session switching are caller-owned. */
export async function consumeWatchlistPriceStream(input: {
  symbols: readonly string[]; signal: AbortSignal; now: () => number;
  open: (signal: AbortSignal) => Promise<Response>;
  onFrame: (frame: Frame) => void; idleMs?: number;
}): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(timer); timer = setTimeout(abort, input.idleMs ?? 12000); timer.unref(); };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    arm();
    const response = await input.open(controller.signal);
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw Error("Watchlist live price stream unavailable.");
    reader = response.body.getReader();
    const cancelReader = () => { void reader?.cancel().catch(() => undefined); };
    controller.signal.addEventListener("abort", cancelReader, { once: true });
    try {
      let buffer = "";
      const decoder = new TextDecoder();
      const symbols = new Set(input.symbols);
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) throw Error("Watchlist live price stream ended.");
        buffer += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) throw Error("Watchlist price stream buffer exceeded.");
        // Handle CRLF even when a chunk boundary falls between CR and LF.
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const lines = event.split("\n");
          if (lines.find(line => line.startsWith("event:"))?.slice(6).trim() !== "prices") continue;
          const raw = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          const frame = parseWatchlistPriceFrame(raw, symbols, input.now());
          if (controller.signal.aborted) return;
          arm(); input.onFrame(frame);
        }
      }
      throw Error("Watchlist price stream interrupted.");
    } finally { controller.signal.removeEventListener("abort", cancelReader); }
  } finally {
    clearTimeout(timer); controller.abort();
    input.signal.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => undefined);
  }
}
