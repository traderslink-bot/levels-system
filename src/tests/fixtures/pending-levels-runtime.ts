import { LevelEngine } from "../../lib/levels/level-engine.js";
import { AlpacaRuntimeHistoricalProvider } from "../../lib/market-data/alpaca-runtime-providers.js";
import { CandleFetchService } from "../../lib/market-data/candle-fetch-service.js";
import { encodeGatewayWire, gatewayWireEnabled } from "../../lib/market-data/traderslink-gateway-wire.js";
import { ManualWatchlistRuntimeManager, DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS } from "../../lib/monitoring/manual-watchlist-runtime-manager.js";
import { createStockLevelsGenerator } from "../../runtime/stock-levels-generator.js";
import { PendingLevelsFetch, type CapturedLevelsRequest, type LevelsBrokerReply } from "../../runtime/stock-levels-pending-fetch.js";
import type { StockLevelsEvidenceProfile } from "../../lib/market-data/stock-levels-evidence-profile.js";

/** Dummy JSON only: never a real market observation or accepted-input receipt. */
export function pendingLevelsDummyReply(request: CapturedLevelsRequest): LevelsBrokerReply {
  let data: unknown;
  if (request.kind === "quote") {
    data = { feed: "sip", snapshots: { [request.symbol]: {
      latestTrade: { p: 1.7, t: new Date(Date.now() - 10).toISOString() },
    } } };
  } else {
    const step = request.kind === "daily" ? 86_400_000 : 14_400_000;
    data = { symbol: request.symbol, feed: "sip", adjustment: "split", complete: true, nextPageToken: null,
      bars: Array.from({ length: 60 }, (_, index) => {
        const close = 1.45 + 0.25 * Math.sin(index * 0.65);
        return { time: Math.floor((request.endMs! - (61 - index) * step) / 1000),
          open: close - 0.02, high: close + 0.1, low: close - 0.12, close, volume: 1000 + index * 10 };
      }) };
  }
  return { operationId: request.operationId, requestId: request.requestId, status: 200,
    body: JSON.stringify(request.wire ? encodeGatewayWire(request.kind === "quote" ? "quotes" : "history", data) : data) };
}

/**
 * Synthetic integration bootstrap only; importing/constructing it does no I/O.
 * Install its synthetic environment and fetcher in the test's own scope.
 * It never installs globals, starts normal Runtime workers or creates evidence.
 */
export function createPendingLevelsRuntimeFixture(options: {
  symbol?: string;
  wire?: boolean;
  profile?: StockLevelsEvidenceProfile;
  onCapture?: (request: CapturedLevelsRequest) => void | Promise<void>;
} = {}) {
  const symbol = options.symbol ?? "SYN";
  const gatewayBaseUrl = "https://levels-capture.invalid/gateway/";
  const runtimeBaseUrl = "https://levels-runtime.invalid/";
  const environment = Object.freeze({
    TRADERLINK_MARKET_DATA_PROVIDER: "alpaca",
    TRADERLINK_ALPACA_GATEWAY_URL: gatewayBaseUrl,
    TRADERLINK_ALPACA_GATEWAY_TOKEN: "fixture-gateway-only",
    TRADERLINK_STOCK_LEVELS_RUNTIME_URL: runtimeBaseUrl,
    TRADERLINK_STOCK_LEVELS_RUNTIME_ACCESS_TOKEN: "fixture-runtime-only",
    TRADERLINK_GATEWAY_CONTRACT: options.wire ? "traderslink.market.1" : undefined,
  });
  const bridge = new PendingLevelsFetch({ gatewayBaseUrl, symbol, profile: options.profile, onCapture: options.onCapture });
  let generator: ReturnType<typeof createStockLevelsGenerator> | undefined;
  let runtimeRequests = 0, successfulReplies = 0;
  let runtimeReplyAtMs: number | undefined, runtimeReplyBody: string | undefined;

  const getGenerator = () => {
    if (Object.entries(environment).some(([key, value]) =>
      value === undefined ? gatewayWireEnabled() : process.env[key] !== value)) {
      throw new Error("fixture_transport_or_environment_not_installed");
    }
    if (!generator) {
      const service = new CandleFetchService(new AlpacaRuntimeHistoricalProvider({
        url: gatewayBaseUrl, token: "fixture-gateway-only", fetcher: bridge.fetcher,
      }));
      // Exercise the actual pure Manager methods without constructing any lifecycle/worker dependencies.
      const manager = Object.assign(Object.create(ManualWatchlistRuntimeManager.prototype), {
        options: { candleFetchService: service }, levelEngine: new LevelEngine(service),
        historicalLookbackBars: { ...DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS },
      }) as ManualWatchlistRuntimeManager;
      generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: (request) =>
        manager.generateLevelsWithWatchlistConfiguration({ ...request, historicalFetchService: service }) });
    }
    return generator;
  };

  const handleLevelsRequest = async (request: Request): Promise<Response> => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/api/runtime/stock-levels") {
      return Response.json({ error: "fixture_route_unavailable" }, { status: 404 });
    }
    if (request.headers.get("authorization") !== "Bearer fixture-runtime-only") {
      return Response.json({ error: "fixture_unauthorized" }, { status: 403 });
    }
    if (runtimeRequests !== 0) return Response.json({ error: "fixture_single_post_only" }, { status: 409 });
    runtimeRequests++;
    const abort = () => bridge.cancel();
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      if (request.signal.aborted) bridge.cancel();
      const input = await request.json() as { symbol?: unknown; profile?: unknown };
      const result = await getGenerator().generate(input.symbol, input.profile);
      if (result.map) successfulReplies++;
      runtimeReplyBody = JSON.stringify(result);
      runtimeReplyAtMs = Date.now();
      return new Response(runtimeReplyBody, { status: result.map ? 200 : 422, headers: { "content-type": "application/json" } });
    } finally { request.signal.removeEventListener("abort", abort); }
  };

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === new URL(runtimeBaseUrl).origin) {
      return handleLevelsRequest(new Request(input, init));
    }
    if (url.origin === new URL(gatewayBaseUrl).origin) return bridge.fetcher(input, init);
    throw new Error("fixture_network_not_allowed");
  };

  return Object.freeze({ environment, fetcher, handleLevelsRequest, bridge,
    cancel: () => bridge.cancel(),
    runtimeReplyBody: () => runtimeReplyBody,
    snapshot: () => Object.freeze({ runtimeRequests, successfulReplies, runtimeReplyAtMs, transport: bridge.snapshot() }),
  });
}
