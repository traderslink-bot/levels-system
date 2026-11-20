import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  buildLiveWatchlistPotentialPathPresentation,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import { buildLevelSnapshotPayloadFromEngineOutput } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { isUsableStockLevelsPrice, resolveStockLevelsReferencePrice } from "./stock-levels-reference-price.js";

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/u;

export type StockLevelsRuntimeResponse = {
  map?: {
    symbol: string;
    referencePrice: number;
    referencePriceAsOf: number;
    referencePriceBasis: "last_trade" | "reference";
    calculatedAt: number;
    cacheStatus: "hit" | "fresh";
    levelMap: ReturnType<typeof buildLiveWatchlistPotentialPathPresentation>["levelMap"];
    fullLadderCard: ReturnType<typeof buildLiveWatchlistPotentialPathPresentation>["fullLadderCard"];
    nearestSupportResistanceCard: ReturnType<typeof buildLiveWatchlistPotentialPathPresentation>["nearestSupportResistanceCard"];
  };
  code?: "invalid_symbol" | "reference_price_unavailable" | "market_data_unavailable";
  message?: string;
};

export function createStockLevelsGenerator(input: {
  generateExistingWatchlistLevels: (request: {
    symbol: string;
    referencePriceOverride: number;
    calculationProfile: "dashboard_eodhd_daily_4h";
  }) => Promise<{ output: LevelEngineOutput }>;
}) {
  const inFlight = new Map<string, Promise<StockLevelsRuntimeResponse>>();

  async function calculate(symbol: string): Promise<StockLevelsRuntimeResponse> {
    if (!SYMBOL.test(symbol)) {
      return { code: "invalid_symbol", message: "Enter a stock ticker." };
    }

    const quote = await resolveStockLevelsReferencePrice(symbol, fetch, "same_session_trade");
    if (!quote) {
      return { code: "reference_price_unavailable", message: "A reliable price for this trading session is unavailable. Try again shortly." };
    }
    const referencePrice = quote.price;

    try {
      const { output } = await input.generateExistingWatchlistLevels({
        symbol,
        referencePriceOverride: referencePrice,
        calculationProfile: "dashboard_eodhd_daily_4h",
      });
      if (!isUsableStockLevelsPrice(quote, Date.now(), "same_session_trade")) {
        return { code: "reference_price_unavailable", message: "The reference price is no longer valid for this trading session. Please regenerate." };
      }
      const payload = buildLevelSnapshotPayloadFromEngineOutput({
        output, symbol: output.symbol, currentPrice: referencePrice, timestamp: output.generatedAt,
      });
      // Stock Levels is a price-relative static map. Watchlist's confirmation
      // buffer remains unchanged for its separate monitoring consumers.
      const zones = [...payload.supportZones, ...payload.resistanceZones];
      const ladderZones = [...(payload.ladderSupportZones ?? payload.supportZones),
        ...(payload.ladderResistanceZones ?? payload.resistanceZones)];
      const presentation = buildLiveWatchlistPotentialPathPresentation({
        ...payload,
        supportZones: zones.filter((zone) => zone.representativePrice < referencePrice),
        resistanceZones: zones.filter((zone) => zone.representativePrice >= referencePrice),
        ladderSupportZones: ladderZones.filter((zone) => zone.representativePrice < referencePrice),
        ladderResistanceZones: ladderZones.filter((zone) => zone.representativePrice >= referencePrice),
      });
      return {
        map: {
          symbol: output.symbol,
          referencePrice,
          referencePriceAsOf: quote.asOf,
          referencePriceBasis: quote.source === "yahoo" ? "reference" : "last_trade",
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
      const existing = inFlight.get(symbol);
      if (existing) {
        return existing;
      }

      const work = calculate(symbol)
        .finally(() => inFlight.delete(symbol));
      inFlight.set(symbol, work);
      return work;
    },
  };
}
