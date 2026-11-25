import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import type { LevelEngineOutputWithCandleSeries } from "../lib/levels/level-engine.js";
import {
  buildLiveWatchlistPotentialPathPresentation,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import { buildLevelSnapshotPayloadFromEngineOutput } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { isUsableStockLevelsPrice, resolveStockLevelsReferencePrice } from "./stock-levels-reference-price.js";
import { buildStockLevelsChartProvenance, type StockLevelsChartEvidenceProvenance } from "./stock-levels-chart-provenance.js";
import { annotateStockLevelsEvidence } from "./stock-levels-evidence-status.js";
import { SCANNER_LEVELS_DAILY_DATASET, SCANNER_LEVELS_EVIDENCE_PROFILE, SCANNER_LEVELS_REGULAR_DATASET, type StockLevelsEvidenceProfile } from "../lib/market-data/stock-levels-evidence-profile.js";

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
    chartEvidenceProvenance?: StockLevelsChartEvidenceProvenance;
  };
  code?: "invalid_symbol" | "reference_price_unavailable" | "market_data_unavailable";
  message?: string;
};

export function createStockLevelsGenerator(input: {
  generateExistingWatchlistLevels: (request: {
    symbol: string;
    referencePriceOverride: number;
    calculationProfile: "dashboard_eodhd_daily_4h" | StockLevelsEvidenceProfile;
    acceptedEvidence?: boolean;
  }) => Promise<{ output: LevelEngineOutput; seriesMap?: LevelEngineOutputWithCandleSeries["seriesMap"] }>;
}) {
  const inFlight = new Map<string, Promise<StockLevelsRuntimeResponse>>();

  async function calculate(symbol: string, profile?: StockLevelsEvidenceProfile): Promise<StockLevelsRuntimeResponse> {
    if (!SYMBOL.test(symbol)) {
      return { code: "invalid_symbol", message: "Enter a stock ticker." };
    }

    const quote = await resolveStockLevelsReferencePrice(symbol, fetch, "same_session_trade");
    if (!quote) {
      return { code: "reference_price_unavailable", message: "A reliable price for this trading session is unavailable. Try again shortly." };
    }
    const referencePrice = quote.price;

    try {
      const { output, seriesMap } = await input.generateExistingWatchlistLevels({
        symbol,
        referencePriceOverride: referencePrice,
        calculationProfile: profile ?? "dashboard_eodhd_daily_4h",
        acceptedEvidence: true,
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
      const chartEvidenceProvenance = output.symbol === symbol
        ? buildStockLevelsChartProvenance({ symbol, seriesMap, levelMap: presentation.levelMap, calculatedAtMs: Date.now() })
        : undefined;
      if (profile === SCANNER_LEVELS_EVIDENCE_PROFILE) {
        const daily = chartEvidenceProvenance?.inputs.find((item) => item.frame === "daily");
        const fourHour = chartEvidenceProvenance?.inputs.find((item) => item.frame === "4h");
        if (!daily || !fourHour || chartEvidenceProvenance?.inputs.length !== 2 ||
            daily.datasetId !== SCANNER_LEVELS_DAILY_DATASET || daily.sessionMode !== "extended" ||
            fourHour.datasetId !== SCANNER_LEVELS_REGULAR_DATASET || fourHour.sessionMode !== "regular" ||
            daily.calendarRevision !== fourHour.calendarRevision ||
            !chartEvidenceProvenance.zones.some((zone) => zone.inputIds.length === 1 && zone.inputIds[0] === fourHour.id)) {
          return { code: "market_data_unavailable", message: "Qualifying chart evidence is unavailable." };
        }
        annotateStockLevelsEvidence(presentation.levelMap, chartEvidenceProvenance);
        const hasEligibleFourHourZone = chartEvidenceProvenance.zones.some(zone => {
          if (zone.inputIds.length !== 1 || zone.inputIds[0] !== fourHour.id) return false;
          const level = presentation.levelMap?.[zone.side === "support" ? "supportLevels" : "resistanceLevels"][zone.index];
          return level && (level.evidenceStatus === "detected_structure" || level.evidenceStatus === "historically_tested") &&
            (level.freshness === "fresh" || level.freshness === "aging") && level.roleFlipState !== "testing";
        });
        if (!hasEligibleFourHourZone) {
          return { code: "market_data_unavailable", message: "Qualifying chart evidence is unavailable." };
        }
      }
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
          ...(chartEvidenceProvenance ? { chartEvidenceProvenance } : {}),
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
    async generate(inputSymbol: unknown, profile?: unknown): Promise<StockLevelsRuntimeResponse> {
      if (profile !== undefined && profile !== SCANNER_LEVELS_EVIDENCE_PROFILE) {
        return { code: "market_data_unavailable", message: "Qualifying chart evidence is unavailable." };
      }
      const symbol = typeof inputSymbol === "string" ? inputSymbol.trim().toUpperCase() : "";
      const key = `${profile ?? "native"}:${symbol}`;
      const existing = inFlight.get(key);
      if (existing) {
        return existing;
      }

      const work = calculate(symbol, profile)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, work);
      return work;
    },
  };
}
