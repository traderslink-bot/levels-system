import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildTradersLinkAiReadRequestPreview } from "../src/lib/ai/traderslink-ai-read-service.js";
import type { TradersLinkAiReadPriceActionContext } from "../src/lib/ai/traderslink-ai-read-price-action.js";
import type { LevelSnapshotPayload } from "../src/lib/alerts/alert-types.js";
import type { Candle } from "../src/lib/market-data/candle-types.js";
import { YahooHistoricalCandleProvider } from "../src/lib/market-data/yahoo-historical-candle-provider.js";
import { buildTradeCandleContext } from "../src/lib/market-data/trade-candle-context.js";

type ArchiveRecord = {
  symbol: string;
  generatedAt: number;
  read: {
    dataAsOf: number;
    currentPrice: number;
  };
};

type ArchiveFile = {
  records: ArchiveRecord[];
};

type Tokenizer = {
  encode(text: string): number[];
};

type RequestShape = {
  input?: Array<{
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const MONTH_DAYS = 30.4375;
const MONTH_DEPTHS = [3, 6, 12, 18, 24] as const;
const LUNA_INPUT_PER_1M = 1;
const TERRA_INPUT_PER_1M = 2.5;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function roundPrice(value: number): number {
  if (value >= 100) return Number(value.toFixed(2));
  if (value >= 10) return Number(value.toFixed(3));
  if (value >= 1) return Number(value.toFixed(4));
  return Number(value.toFixed(6));
}

function compactDailyBar(candle: Candle): Record<string, number | string | null> {
  return {
    timestamp: candle.timestamp,
    timestampIso: new Date(candle.timestamp).toISOString(),
    open: roundPrice(candle.open),
    high: roundPrice(candle.high),
    low: roundPrice(candle.low),
    close: roundPrice(candle.close),
    volume: candle.volume > 0 ? Math.round(candle.volume) : null,
  };
}

function requestText(request: Record<string, unknown>): string {
  const shape = request as RequestShape;
  return (shape.input ?? [])
    .flatMap((message) => message.content ?? [])
    .map((content) => content.text ?? "")
    .join("\n");
}

function cloneWithFullDailyHistory(
  request: Record<string, unknown>,
  dailyCandles: Candle[],
): Record<string, unknown> {
  const clone = structuredClone(request) as RequestShape;
  const userMessage = clone.input?.find((message) => message.role === "user");
  const userText = userMessage?.content?.find((content) => content.type === "input_text");
  if (!userText?.text) return clone as Record<string, unknown>;
  const payload = JSON.parse(userText.text) as {
    marketPacket?: {
      priceAction?: Record<string, unknown>;
    };
  };
  if (payload.marketPacket?.priceAction) {
    payload.marketPacket.priceAction.recentDailyBars = dailyCandles.map(compactDailyBar);
    delete payload.marketPacket.priceAction.historicalOverheadSearch;
    userText.text = JSON.stringify(payload);
  }
  return clone as Record<string, unknown>;
}

async function reconstruct(
  record: ArchiveRecord,
): Promise<{
  oneMinuteCandles: Candle[];
  fiveMinuteCandles: Candle[];
  dailyCandles: Candle[];
  dailyAdjustmentMode: TradersLinkAiReadPriceActionContext["dailyAdjustmentMode"];
}> {
  const yahoo = new YahooHistoricalCandleProvider();
  let oneMinuteCandles: Candle[] = [];
  try {
    const oneMinute = await buildTradeCandleContext({
      symbol: record.symbol,
      fromTimeMs: record.read.dataAsOf - 5 * DAY_MS,
      toTimeMs: record.read.dataAsOf,
      timeframes: ["1m"],
      nowMs: record.read.dataAsOf,
      recentProvider: yahoo,
      historicalProvider: yahoo,
    });
    oneMinuteCandles = oneMinute.series.find((series) => series.timeframe === "1m")?.candles ?? [];
  } catch {
    // Historical Yahoo 1-minute coverage can be unavailable; the 5-minute and
    // daily packet still gives a representative history-cost measurement.
  }
  const fiveMinute = await buildTradeCandleContext({
    symbol: record.symbol,
    fromTimeMs: record.read.dataAsOf - 8 * DAY_MS,
    toTimeMs: record.read.dataAsOf,
    timeframes: ["5m"],
    nowMs: record.read.dataAsOf,
    recentProvider: yahoo,
    historicalProvider: yahoo,
  });
  const daily = await buildTradeCandleContext({
    symbol: record.symbol,
    fromTimeMs: record.read.dataAsOf - 730 * DAY_MS,
    toTimeMs: record.read.dataAsOf,
    timeframes: ["daily"],
    nowMs: record.read.dataAsOf,
  });
  const dailySeries = daily.series.find((series) => series.timeframe === "daily");
  const adjustmentMode = dailySeries?.response.providerMetadata?.providerAdjustmentMode;
  return {
    oneMinuteCandles,
    fiveMinuteCandles: fiveMinute.series.find((series) => series.timeframe === "5m")?.candles ?? [],
    dailyCandles: dailySeries?.candles ?? [],
    dailyAdjustmentMode:
      adjustmentMode === "adjusted_close_ratio" ||
      adjustmentMode === "split_adjusted" ||
      adjustmentMode === "raw"
        ? adjustmentMode
        : "unknown",
  };
}

async function main(): Promise<void> {
  const tokenizerModulePath = flag("--tokenizer");
  if (!tokenizerModulePath) {
    throw new Error("--tokenizer must point to the installed gpt-tokenizer module entry.");
  }
  const tokenizer = await import(pathToFileURL(resolve(tokenizerModulePath)).href) as Tokenizer;
  const archivePath = resolve(flag("--archive") ?? "data/traderslink-ai-reads/archive.json");
  const outputPath = resolve(
    flag("--out") ?? "artifacts/traderslink-ai-read-history-cost-matrix.json",
  );
  const requestedSymbols = (flag("--symbols") ?? "PN,RPGL,STKH")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const archive = JSON.parse(readFileSync(archivePath, "utf8")) as ArchiveFile;
  const records = requestedSymbols.map((symbol) => {
    const candidates = archive.records.filter((record) => record.symbol === symbol);
    const record = candidates.sort((left, right) => right.generatedAt - left.generatedAt)[0];
    if (!record) throw new Error(`No archived AI Read found for ${symbol}.`);
    return record;
  });

  const rows: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const reconstructed = await reconstruct(record);
    for (const months of MONTH_DEPTHS) {
      const cutoff = record.read.dataAsOf - months * MONTH_DAYS * DAY_MS;
      const dailyCandles = reconstructed.dailyCandles.filter((candle) =>
        candle.timestamp >= cutoff && candle.timestamp <= record.read.dataAsOf
      );
      const priceAction: TradersLinkAiReadPriceActionContext = {
        source: "cost-only historical reconstruction",
        fetchedAt: Date.now(),
        priorRegularClose: null,
        dailyAdjustmentMode: reconstructed.dailyAdjustmentMode,
        oneMinuteCandles: reconstructed.oneMinuteCandles,
        intradayCandles: reconstructed.fiveMinuteCandles,
        dailyCandles,
      };
      const snapshot = {
        symbol: record.symbol,
        timestamp: record.read.dataAsOf,
        currentPrice: record.read.currentPrice,
        marketStructure: null,
        supportZones: [],
        resistanceZones: [],
      } as LevelSnapshotPayload;
      const request = buildTradersLinkAiReadRequestPreview({
        model: "gpt-5.6-luna",
        reasoningEffort: "low",
        webSearchEnabled: false,
        maxOutputTokens: 8_000,
        input: {
          snapshot,
          priceAction,
          research: {
            ticker: record.symbol,
            businessDays: 5,
            count: 0,
            articles: [],
          },
          dataAsOf: record.read.dataAsOf,
          generationId: `${record.symbol}-COST-${months}M`,
        },
        dataAsOf: record.read.dataAsOf,
      });
      const fullRequest = cloneWithFullDailyHistory(request, dailyCandles);
      const compactTokens = tokenizer.encode(requestText(request)).length;
      const fullTokens = tokenizer.encode(requestText(fullRequest)).length;
      rows.push({
        symbol: record.symbol,
        months,
        dailyBarsFetched: dailyCandles.length,
        adjustmentMode: reconstructed.dailyAdjustmentMode,
        compactInputTokens: compactTokens,
        compactLunaInputCostUsd: compactTokens / 1_000_000 * LUNA_INPUT_PER_1M,
        compactTerraInputCostUsd: compactTokens / 1_000_000 * TERRA_INPUT_PER_1M,
        fullDailyInputTokens: fullTokens,
        fullDailyLunaInputCostUsd: fullTokens / 1_000_000 * LUNA_INPUT_PER_1M,
        fullDailyTerraInputCostUsd: fullTokens / 1_000_000 * TERRA_INPUT_PER_1M,
      });
    }
  }
  const summary = MONTH_DEPTHS.map((months) => {
    const group = rows.filter((row) => row.months === months);
    const average = (field: string): number =>
      group.reduce((sum, row) => sum + Number(row[field]), 0) / group.length;
    return {
      months,
      averageDailyBarsFetched: Math.round(average("dailyBarsFetched")),
      averageCompactInputTokens: Math.round(average("compactInputTokens")),
      averageCompactLunaInputCostUsd: average("compactLunaInputCostUsd"),
      averageFullDailyInputTokens: Math.round(average("fullDailyInputTokens")),
      averageFullDailyLunaInputCostUsd: average("fullDailyLunaInputCostUsd"),
    };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    paidModelCalls: 0,
    symbols: records.map((record) => record.symbol),
    depths: MONTH_DEPTHS,
    pricing: {
      luna: { inputPer1MTokensUsd: LUNA_INPUT_PER_1M },
      terra: { inputPer1MTokensUsd: TERRA_INPUT_PER_1M },
    },
    notes: [
      "Token counts cover developer and user text. Responses API envelope overhead is not included.",
      "Compact mode keeps recent daily bars plus selected split-adjusted monthly-high windows.",
      "Full-daily mode replaces compact historical selection with every daily candle in the requested range.",
      "Output/reasoning tokens are intentionally excluded from this input-only depth comparison.",
    ],
    summary,
    rows,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
