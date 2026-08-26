import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  buildLiveWatchlistPotentialPathPresentation,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import type { LiveWatchlistExtendedQuoteProvider } from "../lib/live-watchlist/live-watchlist-types.js";
import { buildLevelSnapshotPayloadFromEngineOutput } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/u;

export type StockLevelsRuntimeResponse = {
  map?: {
    symbol: string;
    referencePrice: number;
    referencePriceAsOf: number;
    calculatedAt: number;
    cacheStatus: "hit" | "fresh";
    levelMap: ReturnType<typeof buildLiveWatchlistPotentialPathPresentation>["levelMap"];
    fullLadderCard: ReturnType<typeof buildLiveWatchlistPotentialPathPresentation>["fullLadderCard"];
    nearestSupportResistanceCard: ReturnType<typeof buildLiveWatchlistPotentialPathPresentation>["nearestSupportResistanceCard"];
  };
  code?: "invalid_symbol" | "unsupported_equity" | "reference_price_unavailable" | "market_data_unavailable";
  message?: string;
};

export function createStockLevelsGenerator(input: {
  extendedQuoteProvider: LiveWatchlistExtendedQuoteProvider | null;
  generateExistingWatchlistLevels: (request: {
    symbol: string;
    referencePriceOverride: number;
  }) => Promise<{ output: LevelEngineOutput }>;
}) {
  const cached = new Map<string, { expiresAt: number; map: NonNullable<StockLevelsRuntimeResponse["map"]> }>();
  const inFlight = new Map<string, Promise<StockLevelsRuntimeResponse>>();

  async function calculate(symbol: string): Promise<StockLevelsRuntimeResponse> {
    if (!SYMBOL.test(symbol)) {
      return { code: "invalid_symbol", message: "Enter a Nasdaq or NYSE stock ticker." };
    }

    const quote = await input.extendedQuoteProvider?.getExtendedQuote(symbol);
    const exchange = quote?.exchange?.trim().toUpperCase() ?? "";
    if (!(exchange.includes("NASDAQ") || exchange.includes("NYSE"))) {
      return {
        code: "unsupported_equity",
        message: "Stock Levels is available for Nasdaq and NYSE common stocks only.",
      };
    }

    const referencePrice = quote?.lastTradePrice ?? quote?.ethPrice ?? null;
    if (!(typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0)) {
      return {
        code: "reference_price_unavailable",
        message: "A trustworthy EODHD reference price is unavailable for this stock.",
      };
    }

    try {
      const { output } = await input.generateExistingWatchlistLevels({
        symbol,
        referencePriceOverride: referencePrice,
      });
      const presentation = buildLiveWatchlistPotentialPathPresentation(
        buildLevelSnapshotPayloadFromEngineOutput({
          output,
          symbol: output.symbol,
          currentPrice: referencePrice,
          timestamp: output.generatedAt,
        }),
      );
      return {
        map: {
          symbol: output.symbol,
          referencePrice,
          referencePriceAsOf: quote.updatedAt,
          calculatedAt: output.generatedAt,
          cacheStatus: "fresh",
          levelMap: presentation.levelMap,
          fullLadderCard: presentation.fullLadderCard,
          nearestSupportResistanceCard: presentation.nearestSupportResistanceCard,
        },
      };
    } catch {
      return {
        code: "market_data_unavailable",
        message: "The market data needed for a reliable map is unavailable right now.",
      };
    }
  }

  return {
    async generate(inputSymbol: unknown): Promise<StockLevelsRuntimeResponse> {
      const symbol = typeof inputSymbol === "string" ? inputSymbol.trim().toUpperCase() : "";
      const hit = cached.get(symbol);
      if (hit && hit.expiresAt > Date.now()) {
        return { map: { ...hit.map, cacheStatus: "hit" } };
      }

      const existing = inFlight.get(symbol);
      if (existing) {
        return existing;
      }

      const work = calculate(symbol)
        .then((result) => {
          if (result.map) {
            cached.set(symbol, { expiresAt: Date.now() + CACHE_TTL_MS, map: result.map });
          }
          return result;
        })
        .finally(() => inFlight.delete(symbol));
      inFlight.set(symbol, work);
      return work;
    },
  };
}
