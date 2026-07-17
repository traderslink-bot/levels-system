import "dotenv/config";

import { writeFileSync } from "node:fs";

import {
  buildTradeCandleContext,
  type TradeCandleContextTimeframe,
} from "../lib/market-data/trade-candle-context.js";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function parseTimestamp(value: string | undefined, label: string): number {
  if (!value?.trim()) {
    throw new Error(`${label} is required.`);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an epoch timestamp or ISO date/time.`);
  }
  return parsed;
}

function parseTimeframes(value: string | undefined): TradeCandleContextTimeframe[] {
  const raw = value?.trim() || "1m,5m,4h";
  const parsed = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = new Set(["1m", "5m", "4h", "daily"]);

  for (const timeframe of parsed) {
    if (!allowed.has(timeframe)) {
      throw new Error(`Unsupported timeframe: ${timeframe}. Use one of 1m,5m,4h,daily.`);
    }
  }

  return parsed as TradeCandleContextTimeframe[];
}

async function main(): Promise<void> {
  const symbol = readFlag("--symbol")?.trim();
  if (!symbol) {
    throw new Error("--symbol is required.");
  }

  const fromTimeMs = parseTimestamp(readFlag("--from"), "--from");
  const toTimeMs = parseTimestamp(readFlag("--to"), "--to");
  const timeframes = parseTimeframes(readFlag("--timeframes"));
  const outputPath = readFlag("--out");
  const context = await buildTradeCandleContext({
    symbol,
    fromTimeMs,
    toTimeMs,
    timeframes,
  });
  const json = `${JSON.stringify(context, null, 2)}\n`;

  if (outputPath?.trim()) {
    writeFileSync(outputPath, json, "utf8");
    return;
  }

  process.stdout.write(json);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[get-trade-candles] ${message}`);
  process.exitCode = 1;
});
