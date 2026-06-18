import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatCandleWarehouseBackfillReport,
  writeCandleWarehouseBackfillReport,
} from "../lib/review/candle-warehouse-backfill-report.js";
import type {
  CandleProviderResponse,
  CandleWarehouseBackfillResult,
} from "../lib/support-resistance/index.js";

test("candle warehouse backfill report shows provider readiness evidence", () => {
  const result: CandleWarehouseBackfillResult = {
    generatedAt: "2026-05-03T12:00:00.000Z",
    mode: "dry_run",
    provider: "stub",
    plan: {
      provider: "stub",
      tasks: [
        {
          provider: "stub",
          symbol: "MISS",
          timeframe: "5m",
          sessionDate: "2026-05-01",
          startTimestamp: 1000,
          endTimestamp: 2000,
          lookbackBars: 12,
          coverage: {
            provider: "stub",
            symbol: "MISS",
            timeframe: "5m",
            candleCount: 0,
            startTimestamp: null,
            endTimestamp: null,
          },
          missingRanges: [{ startTimestamp: 1000, endTimestamp: 2000 }],
          missingCandleCountEstimate: 3,
          likelyNoBarMissingCandleCountEstimate: 0,
        },
      ],
      symbolCount: 1,
      sessionCount: 1,
      plannedTaskCount: 2,
      missingTaskCount: 1,
      fullyCoveredTaskCount: 1,
      missingCandleCountEstimate: 3,
      likelyNoBarMissingTaskCount: 0,
      likelyNoBarMissingCandleCountEstimate: 0,
    },
    totals: {
      plannedTasks: 1,
      attemptedTasks: 0,
      fetchedTasks: 0,
      skippedTasks: 1,
      failedTasks: 0,
      fetchedCandles: 0,
      storedCandles: 0,
    },
    taskResults: [
      {
        symbol: "MISS",
        timeframe: "5m",
        sessionDate: "2026-05-01",
        status: "planned",
        readiness: "safe_to_fetch",
        requestedLookbackBars: 12,
        missingRangeCount: 1,
        missingCandleCountEstimate: 3,
        fetchedCandles: 0,
        storedCandles: 0,
        error: null,
      },
    ],
  };

  const markdown = formatCandleWarehouseBackfillReport(result);

  assert.match(markdown, /Provider Readiness/);
  assert.match(markdown, /already covered tasks: 1/);
  assert.match(markdown, /safe_to_fetch/);
});

test("candle warehouse backfill report execute mode uses the injected fetch client", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candle-backfill-report-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  const warehouseDirectoryPath = join(directory, "warehouse");
  const timestamp = Date.UTC(2026, 4, 1, 14, 30, 0);
  writeFileSync(
    auditPath,
    `${JSON.stringify({
      operation: "post_level_snapshot",
      status: "posted",
      timestamp,
      symbol: "SAFE",
    })}\n`,
    "utf8",
  );

  let called = 0;
  const fetchClient = {
    getProviderName: () => "ibkr" as const,
    fetchCandles: async (): Promise<CandleProviderResponse> => {
      called += 1;
      return {
        provider: "ibkr",
        symbol: "SAFE",
        timeframe: "5m",
        requestedLookbackBars: 1,
        candles: [
          {
            timestamp,
            open: 1,
            high: 1.05,
            low: 0.98,
            close: 1.02,
            volume: 5000,
          },
        ],
        fetchStartTimestamp: timestamp,
        fetchEndTimestamp: timestamp,
        requestedStartTimestamp: timestamp,
        requestedEndTimestamp: timestamp,
        actualBarsReturned: 1,
        completenessStatus: "partial",
        stale: false,
        validationIssues: [],
        sessionSummary: null,
        sessionMetadataAvailable: false,
      };
    },
  };

  const result = await writeCandleWarehouseBackfillReport({
    auditPath,
    warehouseDirectoryPath,
    provider: "ibkr",
    timeframes: ["5m"],
    mode: "execute",
    maxTasks: 1,
    fetchClient,
    jsonPath: join(directory, "report.json"),
    markdownPath: join(directory, "report.md"),
  });

  assert.equal(called, 1);
  assert.equal(result.provider, "ibkr");
  assert.equal(result.totals.attemptedTasks, 1);
  assert.equal(result.totals.fetchedTasks, 1);
  assert.equal(result.taskResults[0]?.readiness, "refreshed");
});

test("priority backfill report preserves timeframe-specific ranges", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candle-priority-range-"));
  const priorityReportPath = join(directory, "priority.json");
  const warehouseDirectoryPath = join(directory, "warehouse");
  const endTimestamp = Date.UTC(2026, 3, 10, 15, 30, 0);
  const dailyStartTimestamp = endTimestamp - 520 * 24 * 60 * 60_000;
  const fourHourStartTimestamp = endTimestamp - 180 * 4 * 60 * 60_000;
  const dailyTask = {
    provider: "ibkr",
    symbol: "RANGE",
    sessionDate: "2026-04-10",
    timeframe: "daily",
    priority: "fetch_first",
    score: 1000,
    reasons: ["daily test range"],
    startTimestamp: dailyStartTimestamp,
    endTimestamp,
    estimatedCandleCount: 520,
    missingCandleCountEstimate: 520,
    likelyNoBarMissingCandleCountEstimate: 0,
    storedCandles: 0,
    tradeRequestCount: 1,
  };
  const fourHourTask = {
    ...dailyTask,
    timeframe: "4h",
    reasons: ["4h test range"],
    startTimestamp: fourHourStartTimestamp,
    estimatedCandleCount: 180,
    missingCandleCountEstimate: 180,
  };
  writeFileSync(
    priorityReportPath,
    `${JSON.stringify({
      generatedAt: "2026-05-05T12:00:00.000Z",
      sourceAuditPath: "test",
      sourceAuditPaths: ["test"],
      warehouseDirectoryPath,
      cacheDirectoryPath: ".validation-cache/candles",
      provider: "ibkr",
      totals: {
        missingTasks: 2,
        fetchFirstTasks: 2,
        fetchNextTasks: 0,
        fetchLaterTasks: 0,
        estimatedMissingCandles: 700,
        likelyNoBarMissingCandles: 0,
        priorityStages: 1,
        quietMayHideSymbols: 0,
        runtimeSilenceSymbols: 0,
        unprovenQuietSymbols: 1,
        postNoiseBudgetSymbols: 0,
        supportResistanceWatchSymbols: 0,
        supportResistanceBrokenSymbols: 0,
        supportResistanceUnprovenSymbols: 1,
      },
      rankedTasks: [dailyTask, fourHourTask],
      priorityBySymbolSession: [],
      providerStages: [
        {
          stageIndex: 1,
          priority: "fetch_first",
          taskCount: 2,
          estimatedCandleCount: 700,
          symbols: ["RANGE"],
          timeframes: ["daily", "4h"],
          tasks: [dailyTask, fourHourTask],
        },
      ],
    })}\n`,
    "utf8",
  );

  const result = await writeCandleWarehouseBackfillReport({
    auditPath: directory,
    warehouseDirectoryPath,
    provider: "ibkr",
    timeframes: ["daily", "4h"],
    mode: "dry_run",
    priorityReportPath,
    jsonPath: join(directory, "report.json"),
    markdownPath: join(directory, "report.md"),
  });
  const daily = result.plan.tasks.find((task) => task.timeframe === "daily");
  const fourHour = result.plan.tasks.find((task) => task.timeframe === "4h");

  assert.equal(daily?.startTimestamp, dailyStartTimestamp);
  assert.equal(daily?.lookbackBars, 521);
  assert.equal(fourHour?.startTimestamp, fourHourStartTimestamp);
  assert.equal(fourHour?.lookbackBars, 181);
});
