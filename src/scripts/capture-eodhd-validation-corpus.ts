import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type {
  CandleProviderResponse,
  CandleTimeframe,
} from "../lib/market-data/candle-types.js";
import { EodhdHistoricalCandleProvider } from "../lib/market-data/eodhd-historical-candle-provider.js";

type CaptureCase = {
  symbol: string;
  lookbacks: Record<CandleTimeframe, number>;
};

type CapturedResponse = Omit<
  CandleProviderResponse,
  "fetchStartTimestamp" | "fetchEndTimestamp"
> & {
  fetchStartTimestamp: 0;
  fetchEndTimestamp: 0;
};

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseSymbols(): string[] {
  return (argumentValue("--symbols") ?? "NVVE,GME")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function parseEndTimestamp(): number {
  const value = argumentValue("--end") ?? new Date().toISOString();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid --end timestamp: ${value}`);
  }
  return timestamp;
}

function captureCaseForSymbol(symbol: string): CaptureCase {
  return {
    symbol,
    lookbacks: symbol === "NVVE"
      ? { daily: 80, "4h": 80, "5m": 80 }
      : { daily: 60, "4h": 60, "5m": 60 },
  };
}

function sanitizeResponse(response: CandleProviderResponse): CapturedResponse {
  return {
    ...response,
    candles: response.candles.map((candle) => ({ ...candle })),
    validationIssues: response.validationIssues.map((issue) => ({ ...issue })),
    sessionSummary: response.sessionSummary ? { ...response.sessionSummary } : null,
    providerMetadata: response.providerMetadata ? { ...response.providerMetadata } : undefined,
    fetchStartTimestamp: 0,
    fetchEndTimestamp: 0,
  };
}

async function main(): Promise<void> {
  const endTimeMs = parseEndTimestamp();
  const service = new CandleFetchService(new EodhdHistoricalCandleProvider());
  const cases = [];

  for (const symbol of parseSymbols()) {
    const captureCase = captureCaseForSymbol(symbol);
    const responses = {} as Record<CandleTimeframe, CapturedResponse>;

    for (const timeframe of ["daily", "4h", "5m"] as const) {
      responses[timeframe] = sanitizeResponse(await service.fetchCandles({
        symbol,
        timeframe,
        lookbackBars: captureCase.lookbacks[timeframe],
        endTimeMs,
      }));
    }

    const latestTradedFiveMinute = [...responses["5m"].candles]
      .reverse()
      .find((candle) => candle.volume > 0);
    cases.push({
      symbol,
      referencePrice: latestTradedFiveMinute?.close ?? responses["4h"].candles.at(-1)?.close,
      lookbacks: captureCase.lookbacks,
      responses,
    });
  }

  const serialized = `${JSON.stringify({
    schemaVersion: "eodhd-validation-corpus/v1",
    capturedAt: new Date().toISOString(),
    endTimeMs,
    provenance: {
      source: "live_eodhd_provider_capture",
      tokenIncluded: false,
      reviewRequiredBeforeFixturePromotion: true,
    },
    cases,
  }, null, 2)}\n`;
  const outputPath = argumentValue("--out");
  if (!outputPath) {
    process.stdout.write(serialized);
    return;
  }

  const resolvedOutputPath = resolve(outputPath);
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, serialized, "utf8");
  console.log(`Captured EODHD validation corpus: ${resolvedOutputPath}`);
}

await main();
