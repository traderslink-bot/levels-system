import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import type { LiveWatchlistExtendedQuoteProvider } from "../lib/live-watchlist/live-watchlist-types.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/u;

type Side = "support" | "resistance";

type Level = {
  side: Side;
  price: number;
  distancePct: number;
  strength: "weak" | "moderate" | "strong" | "major";
  type: string;
  timeframeSources: readonly string[];
  formedAt: number | null;
  lastTestedAt: number | null;
  lastConfirmedAt: number | null;
};

export type StockLevelsRuntimeResponse = {
  map?: {
    symbol: string;
    referencePrice: number;
    referencePriceAsOf: number;
    calculatedAt: number;
    cacheStatus: "hit" | "fresh";
    nearestSupport: Level | null;
    nearestResistance: Level | null;
    support: readonly Level[];
    resistance: readonly Level[];
    fullLadder: { support: readonly Level[]; resistance: readonly Level[] };
  };
  code?: "invalid_symbol" | "unsupported_equity" | "reference_price_unavailable" | "market_data_unavailable";
  message?: string;
};

function serializeLevel(side: Side, zone: FinalLevelZone, referencePrice: number): Level {
  return {
    side,
    price: zone.representativePrice,
    distancePct: (zone.representativePrice - referencePrice) / referencePrice,
    strength: zone.strengthLabel,
    type: zone.sourceTypes.join(", ") || zone.kind,
    timeframeSources: zone.timeframeSources,
    formedAt: zone.marketDataProvenance?.formedAt ?? zone.firstTimestamp ?? null,
    lastTestedAt: zone.marketDataProvenance?.lastTestedAt ?? null,
    lastConfirmedAt: zone.marketDataProvenance?.lastConfirmedAt ?? null,
  };
}

function serializeZones(
  side: Side,
  zones: readonly FinalLevelZone[],
  referencePrice: number,
): readonly Level[] {
  return zones.map((zone) => serializeLevel(side, zone, referencePrice));
}

function existingSurfaceZones(output: LevelEngineOutput, side: Side): readonly FinalLevelZone[] {
  return side === "support"
    ? [
        ...output.majorSupport,
        ...output.intermediateSupport,
        ...output.intradaySupport,
        ...output.extensionLevels.support,
      ]
    : [
        ...output.majorResistance,
        ...output.intermediateResistance,
        ...output.intradayResistance,
        ...output.extensionLevels.resistance,
      ];
}

function serializeExistingOutput(input: {
  output: LevelEngineOutput;
  referencePrice: number;
  referencePriceAsOf: number;
}): NonNullable<StockLevelsRuntimeResponse["map"]> {
  const support = serializeZones(
    "support",
    existingSurfaceZones(input.output, "support"),
    input.referencePrice,
  );
  const resistance = serializeZones(
    "resistance",
    existingSurfaceZones(input.output, "resistance"),
    input.referencePrice,
  );
  const fullLadder = input.output.fullLadderLevels;

  return {
    symbol: input.output.symbol,
    referencePrice: input.referencePrice,
    referencePriceAsOf: input.referencePriceAsOf,
    calculatedAt: input.output.generatedAt,
    cacheStatus: "fresh",
    // The engine's existing bucket ordering is retained exactly. The first
    // returned surface row is only labelled here; no stock-levels sorting,
    // de-duplication, filtering, ranking, or nearest-level calculation occurs.
    nearestSupport: support[0] ?? null,
    nearestResistance: resistance[0] ?? null,
    support,
    resistance,
    fullLadder: {
      support: serializeZones("support", fullLadder?.support ?? [], input.referencePrice),
      resistance: serializeZones("resistance", fullLadder?.resistance ?? [], input.referencePrice),
    },
  };
}

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
      return {
        map: serializeExistingOutput({
          output,
          referencePrice,
          referencePriceAsOf: quote.updatedAt,
        }),
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
