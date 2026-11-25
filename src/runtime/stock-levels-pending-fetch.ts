import { createHash, randomUUID } from "node:crypto";
import { gatewayWireQuery, gatewayWireUrl } from "../lib/market-data/traderslink-gateway-wire.js";
import { SCANNER_LEVELS_EVIDENCE_PROFILE, type StockLevelsEvidenceProfile } from "../lib/market-data/stock-levels-evidence-profile.js";

export type CapturedLevelsRequest = Readonly<{
  version: 1;
  operationId: string;
  requestId: string;
  kind: "quote" | "daily" | "4h";
  symbol: string;
  method: "GET";
  wire: boolean;
  pathname: string;
  search: string;
  capturedAtMs: number;
  timeframe?: "1Day" | "4Hour";
  startMs?: number;
  endMs?: number;
  acceptedEvidence?: true;
  sessionMode?: "regular";
}>;

export type LevelsBrokerReply = Readonly<{
  operationId: string;
  requestId: string;
  status: number;
  body: string | Uint8Array;
}>;

type Entry = {
  request: CapturedLevelsRequest;
  state: "pending" | "fulfilled" | "cancelled";
  signal: AbortSignal;
  abort: () => void;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
  completedAtMs?: number;
  transportBodySha256?: string;
  responseBytes?: number;
  responseStatus?: number;
};

/**
 * Explicit isolated-QA transport, never installed globally or called by normal startup.
 * It does no network/file I/O and never creates an accepted-input revision.
 * History is released as one pair so cancellation cannot deliver just one frame.
 */
export class PendingLevelsFetch {
  readonly operationId: string;
  readonly fetcher: typeof fetch;
  private readonly base: URL;
  private readonly entries = new Map<CapturedLevelsRequest["kind"], Entry>();
  private readonly maxResponseBytes: number;
  private state: "capturing" | "transport_complete" | "cancelled" | "refused" = "capturing";
  private terminalReason?: "request_aborted" | "caller_cancelled" | "broker_refused" | "protocol_violation" | "broker_failed";

  constructor(private readonly options: {
    gatewayBaseUrl: string;
    symbol: string;
    profile?: StockLevelsEvidenceProfile;
    operationId?: string;
    maxResponseBytes?: number;
    onCapture?: (request: CapturedLevelsRequest) => void | Promise<void>;
  }) {
    this.base = new URL(options.gatewayBaseUrl);
    if (this.base.username || this.base.password || this.base.search || this.base.hash ||
        !["http:", "https:"].includes(this.base.protocol) || !/^[A-Z][A-Z0-9.-]{0,9}$/u.test(options.symbol) ||
        options.profile !== undefined && options.profile !== SCANNER_LEVELS_EVIDENCE_PROFILE) {
      throw new TypeError("invalid_capture_configuration");
    }
    if (!this.base.pathname.endsWith("/")) this.base.pathname += "/";
    this.operationId = options.operationId ?? randomUUID();
    if (!/^[A-Za-z0-9._:-]{1,192}$/u.test(this.operationId)) throw new TypeError("invalid_capture_operation");
    this.maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) throw new TypeError("invalid_capture_budget");
    this.fetcher = (input, init) => this.capture(input, init);
  }

  private describe(input: RequestInfo | URL, init?: RequestInit): { request: CapturedLevelsRequest; signal: AbortSignal } {
    const original = input instanceof Request ? input : undefined;
    const url = new URL(original?.url ?? String(input));
    const signal = init?.signal === undefined ? original?.signal : init.signal;
    if (!signal || (init?.method ?? original?.method ?? "GET").toUpperCase() !== "GET" ||
        init?.body != null || url.origin !== this.base.origin || url.username || url.password || url.hash) {
      throw new TypeError("capture_request_not_allowed");
    }
    const route = (["history", "quotes"] as const).flatMap((resource) => [
      { resource, wire: false, pathname: new URL(resource, this.base).pathname },
      { resource, wire: true, pathname: gatewayWireUrl(this.base, resource).pathname },
    ]).find((item) => item.pathname === url.pathname);
    if (!route) throw new TypeError("capture_request_not_allowed");
    const query = route.wire ? gatewayWireQuery(url.searchParams, true) : url.searchParams;
    const regular = route.resource === "history" && query.get("timeframe") === "4Hour" &&
      this.options.profile === SCANNER_LEVELS_EVIDENCE_PROFILE;
    const keys = route.resource === "quotes" ? ["symbols"] : ["symbol", "timeframe", "start", "end", "acceptedEvidence",
      ...(regular ? ["sessionMode"] : [])];
    if ([...query.keys()].some((key) => !keys.includes(key)) || keys.some((key) => query.getAll(key).length !== 1)) {
      throw new TypeError("capture_query_not_allowed");
    }
    const symbol = query.get(route.resource === "quotes" ? "symbols" : "symbol");
    if (symbol !== this.options.symbol) throw new TypeError("capture_symbol_mismatch");
    const common = {
      version: 1 as const, operationId: this.operationId, requestId: randomUUID(), symbol,
      method: "GET" as const, wire: route.wire, pathname: url.pathname, search: url.search, capturedAtMs: Date.now(),
    };
    if (route.resource === "quotes") return { request: Object.freeze({ ...common, kind: "quote" }), signal };
    const timeframe = query.get("timeframe");
    const start = query.get("start")!, end = query.get("end")!;
    if ((timeframe !== "1Day" && timeframe !== "4Hour") || query.get("acceptedEvidence") !== "1" ||
        regular && query.get("sessionMode") !== "regular" ||
        !/^[1-9]\d*$/u.test(start) || !/^[1-9]\d*$/u.test(end) ||
        !Number.isSafeInteger(Number(start)) || !Number.isSafeInteger(Number(end)) || Number(start) >= Number(end)) {
      throw new TypeError("capture_history_not_allowed");
    }
    return { request: Object.freeze({ ...common, kind: timeframe === "1Day" ? "daily" : "4h", timeframe,
      startMs: Number(start), endMs: Number(end), acceptedEvidence: true,
      ...(regular ? { sessionMode: "regular" as const } : {}) }), signal };
  }

  private async capture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.state !== "capturing") throw new Error("capture_operation_terminal");
    let described: ReturnType<PendingLevelsFetch["describe"]>;
    try { described = this.describe(input, init); } catch (error) {
      this.terminate("refused", "protocol_violation", error); throw error;
    }
    const { request, signal } = described;
    if (this.entries.has(request.kind)) {
      const error = new Error("capture_duplicate_request");
      this.terminate("refused", "protocol_violation", error); throw error;
    }
    if (signal.aborted) {
      this.terminate("cancelled", "request_aborted", signal.reason); throw signal.reason;
    }
    return new Promise<Response>((resolve, reject) => {
      const abort = () => this.terminate("cancelled", "request_aborted", signal.reason);
      const entry: Entry = { request, signal, abort, resolve, reject, state: "pending" };
      this.entries.set(request.kind, entry);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try {
        Promise.resolve(this.options.onCapture?.(request)).catch((error) => this.terminate("refused", "broker_failed", error));
      } catch (error) { this.terminate("refused", "broker_failed", error); }
    });
  }

  pendingHistory(): readonly [CapturedLevelsRequest, CapturedLevelsRequest] | undefined {
    const daily = this.entries.get("daily"), fourHour = this.entries.get("4h");
    return this.state === "capturing" && daily?.state === "pending" && fourHour?.state === "pending"
      ? Object.freeze([daily.request, fourHour.request] as const) : undefined;
  }

  private prepare(reply: LevelsBrokerReply, kind: CapturedLevelsRequest["kind"]) {
    const entry = this.entries.get(kind);
    if (this.state !== "capturing" || !entry || entry.state !== "pending" || entry.signal.aborted ||
        reply.operationId !== this.operationId || reply.requestId !== entry.request.requestId) {
      throw new Error("capture_reply_mismatch");
    }
    if (!Number.isInteger(reply.status) || reply.status < 200 || reply.status > 599 ||
        reply.status >= 300 && reply.status < 400 || [204, 205, 304].includes(reply.status)) {
      throw new TypeError("capture_response_status_not_allowed");
    }
    if (typeof reply.body !== "string" && !(reply.body instanceof Uint8Array)) throw new TypeError("capture_response_body_not_allowed");
    const body = typeof reply.body === "string" ? Buffer.from(reply.body, "utf8") : Buffer.from(reply.body);
    if (body.byteLength > this.maxResponseBytes) throw new RangeError("capture_response_budget_exceeded");
    return { entry, response: new Response(body, { status: reply.status, headers: { "content-type": "application/json" } }),
      bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex"), status: reply.status };
  }

  private release(value: ReturnType<PendingLevelsFetch["prepare"]>): void {
    const { entry } = value;
    entry.signal.removeEventListener("abort", entry.abort);
    entry.state = "fulfilled";
    entry.completedAtMs = Date.now();
    entry.responseBytes = value.bytes;
    entry.responseStatus = value.status;
    entry.transportBodySha256 = value.sha256;
    entry.resolve(value.response);
  }

  resolveQuote(reply: LevelsBrokerReply): void {
    try { this.release(this.prepare(reply, "quote")); } catch (error) {
      this.terminate("refused", "protocol_violation", error); throw error;
    }
  }

  resolveHistory(replies: { daily: LevelsBrokerReply; fourHour: LevelsBrokerReply }): void {
    try {
      if (!this.pendingHistory()) throw new Error("capture_history_pair_not_pending");
      if (this.entries.get("quote")?.state === "pending") throw new Error("capture_quote_still_pending");
      const daily = this.prepare(replies.daily, "daily"), fourHour = this.prepare(replies.fourHour, "4h");
      this.release(daily); this.release(fourHour);
      this.state = "transport_complete";
    } catch (error) { this.terminate("refused", "protocol_violation", error); throw error; }
  }

  refuse(): void { this.terminate("refused", "broker_refused", new Error("capture_broker_refused")); }

  cancel(): void {
    this.terminate("cancelled", "caller_cancelled", new DOMException("Pending Levels capture cancelled", "AbortError"));
  }

  private terminate(state: "cancelled" | "refused", reason: NonNullable<PendingLevelsFetch["terminalReason"]>, error: unknown): void {
    if (this.state !== "capturing") return;
    this.state = state; this.terminalReason = reason;
    for (const entry of this.entries.values()) {
      entry.signal.removeEventListener("abort", entry.abort);
      if (entry.state === "pending") {
        entry.state = "cancelled"; entry.completedAtMs = Date.now(); entry.reject(error);
      }
    }
  }

  snapshot() {
    return Object.freeze({ operationId: this.operationId, profile: this.options.profile, state: this.state, terminalReason: this.terminalReason,
      requests: Object.freeze([...this.entries.values()].map(({ request, state, completedAtMs,
        transportBodySha256, responseBytes, responseStatus }) => Object.freeze({ ...request, state,
        completedAtMs, transportBodySha256, responseBytes, responseStatus }))) });
  }
}
