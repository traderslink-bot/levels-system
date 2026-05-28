import assert from "node:assert/strict";
import test from "node:test";

import { formatCandleWarehouseBackfillReport } from "../lib/review/candle-warehouse-backfill-report.js";
import type { CandleWarehouseBackfillResult } from "../lib/support-resistance/index.js";

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
        },
      ],
      symbolCount: 1,
      sessionCount: 1,
      plannedTaskCount: 2,
      missingTaskCount: 1,
      fullyCoveredTaskCount: 1,
      missingCandleCountEstimate: 3,
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
