import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildJournalTradeContextOneMinuteExecutionWindowPolicy } from "../lib/analysis/journal-trade-context-1m-execution-window-policy.js";
import {
  LEVEL_ENGINE_ELIGIBLE_TIMEFRAMES,
  PROVIDER_CANDLE_TIMEFRAMES,
  isLevelEngineEligibleTimeframe,
  isProviderCandleTimeframe,
} from "../lib/market-data/candle-types.js";

const FIRST_EXECUTION = Date.parse("2026-06-01T10:03:25-04:00");
const FINAL_EXECUTION = Date.parse("2026-06-01T10:17:40-04:00");

test("1m execution-window policy builds an optional replay request around executions", () => {
  const policy = buildJournalTradeContextOneMinuteExecutionWindowPolicy({
    symbol: "devs",
    firstExecutionTimestamp: FIRST_EXECUTION,
    finalExecutionTimestamp: FINAL_EXECUTION,
  });

  assert.equal(policy.symbol, "DEVS");
  assert.equal(policy.timeframe, "1m");
  assert.equal(policy.priority, "optional_execution_detail");
  assert.equal(policy.window.preExecutionBufferMinutes, 30);
  assert.equal(policy.window.postExecutionBufferMinutes, 30);
  assert.equal(policy.window.startTimestamp, Date.parse("2026-06-01T09:33:00-04:00"));
  assert.equal(policy.window.endTimestamp, Date.parse("2026-06-01T10:48:00-04:00"));
  assert.equal(policy.window.expectedBarCount, 75);
  assert.deepEqual(policy.request, {
    symbol: "DEVS",
    timeframe: "1m",
    lookbackBars: 75,
    startTimeMs: Date.parse("2026-06-01T09:33:00-04:00"),
    endTimeMs: Date.parse("2026-06-01T10:48:00-04:00"),
  });
  assert.equal(policy.cacheIdentity.scope, "symbol_execution_window");
  assert.equal(policy.cacheIdentity.key.includes("DEVS|1m|"), true);
  assert.deepEqual(policy.safety, {
    optionalExecutionReplayOnly: true,
    fiveMinuteDayContextRemainsPrimary: true,
    notFullDayByDefault: true,
    notLevelEngineEligible: true,
    noLevelEngineBehaviorChange: true,
    noTradeAdvice: true,
  });
});

test("1m execution-window policy supports single execution and custom buffers", () => {
  const policy = buildJournalTradeContextOneMinuteExecutionWindowPolicy({
    symbol: "GME",
    firstExecutionTimestamp: FIRST_EXECUTION,
    preExecutionBufferMinutes: 10,
    postExecutionBufferMinutes: 5,
  });

  assert.equal(policy.finalExecutionTimestamp, FIRST_EXECUTION);
  assert.equal(policy.window.startTimestamp, Date.parse("2026-06-01T09:53:00-04:00"));
  assert.equal(policy.window.endTimestamp, Date.parse("2026-06-01T10:09:00-04:00"));
  assert.equal(policy.window.expectedBarCount, 16);
  assert.equal(policy.request.lookbackBars, 16);
});

test("1m execution-window policy rejects ambiguous inputs", () => {
  assert.throws(
    () =>
      buildJournalTradeContextOneMinuteExecutionWindowPolicy({
        symbol: "bad symbol",
        firstExecutionTimestamp: FIRST_EXECUTION,
      }),
    /Invalid symbol/,
  );
  assert.throws(
    () =>
      buildJournalTradeContextOneMinuteExecutionWindowPolicy({
        symbol: "DEVS",
        firstExecutionTimestamp: FIRST_EXECUTION,
        finalExecutionTimestamp: FIRST_EXECUTION - 1,
      }),
    /finalExecutionTimestamp/,
  );
  assert.throws(
    () =>
      buildJournalTradeContextOneMinuteExecutionWindowPolicy({
        symbol: "DEVS",
        firstExecutionTimestamp: FIRST_EXECUTION,
        preExecutionBufferMinutes: -1,
      }),
    /preExecutionBufferMinutes/,
  );
});

test("1m remains optional execution detail and outside provider and LevelEngine eligibility", () => {
  assert.equal(LEVEL_ENGINE_ELIGIBLE_TIMEFRAMES.includes("1m" as any), false);
  assert.equal(PROVIDER_CANDLE_TIMEFRAMES.includes("1m" as any), false);
  assert.equal(isLevelEngineEligibleTimeframe("1m"), false);
  assert.equal(isProviderCandleTimeframe("1m"), false);
});

test("1m execution-window policy source stays out of LevelEngine and trading advice paths", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/analysis/journal-trade-context-1m-execution-window-policy.ts"),
    "utf8",
  ).toLowerCase();
  const forbidden = [
    "../levels",
    "../alerts",
    "../monitoring",
    "discord",
    "recommendation",
    "coaching",
    "giveback",
    "behavior score",
    "buy/sell",
  ];

  for (const term of forbidden) {
    assert.equal(source.includes(term), false, `source should not contain ${term}`);
  }
});
