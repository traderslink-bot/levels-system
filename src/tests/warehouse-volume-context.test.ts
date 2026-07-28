import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DurableCandleWarehouse,
  buildVolumeActivityContextFromWarehouseCandles,
  buildWarehouseVolumeActivityContext,
  type Candle,
} from "../lib/support-resistance/index.js";

const START = Date.parse("2026-05-01T12:00:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1000;

function candle(index: number, volume: number, close = 2): Candle {
  return {
    timestamp: START + index * FIVE_MINUTES,
    open: close,
    high: close + 0.03,
    low: close - 0.03,
    close,
    volume,
  };
}

test("warehouse volume context builds a reliable session-bucket baseline and dollar-volume read", () => {
  const candles = Array.from({ length: 24 }, (_, index) =>
    candle(index, index === 23 ? 260_000 : 100_000 + index * 500, 2 + index * 0.01),
  );

  const context = buildVolumeActivityContextFromWarehouseCandles({
    symbol: "VOLM",
    candles,
    currentPrice: candles.at(-1)!.close,
    resistanceLevels: [2.23],
  });

  assert.equal(context.symbol, "VOLM");
  assert.equal(context.reliability, "reliable");
  assert.equal(context.label, "strong");
  assert.equal(context.sessionBucket, "open");
  assert.ok((context.relativeVolumeRatio ?? 0) >= 2);
  assert.equal(context.liquidityLabel, "tradeable");
  assert.equal(context.atLevel.side, "resistance");
});

test("warehouse volume context stays unreliable when 5m baseline is too thin", () => {
  const context = buildVolumeActivityContextFromWarehouseCandles({
    symbol: "THIN",
    candles: [candle(0, 0), candle(1, 500)],
  });

  assert.equal(context.reliability, "unreliable");
  assert.equal(context.label, "unknown");
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "insufficient_baseline"));
});

test("warehouse volume context can read 5m candles from durable storage", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "warehouse-volume-")));
  const candles = Array.from({ length: 24 }, (_, index) =>
    candle(index, index === 23 ? 20_000 : 10_000, 1.5),
  );
  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "WHVOL",
    timeframe: "5m",
    candles,
  });

  const context = await buildWarehouseVolumeActivityContext({
    warehouse,
    provider: "stub",
    symbol: "WHVOL",
    sessionDate: "2026-05-01",
    asOfTimestamp: candles.at(-1)!.timestamp,
  });

  assert.equal(context.candleCount, 24);
  assert.equal(context.provider, "stub");
  assert.notEqual(context.label, "unknown");
});
