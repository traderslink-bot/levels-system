import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const END_TIME = Date.parse("2026-07-15T16:00:00.000Z");

function spanDays(plan: ReturnType<typeof buildHistoricalFetchPlan>): number {
  return (plan.requestEndTimestamp - plan.requestStartTimestamp) / DAY_MS;
}

test("EODHD planning requests enough calendar history for daily market bars", () => {
  const plan = buildHistoricalFetchPlan(
    { symbol: "NVVE", timeframe: "daily", lookbackBars: 220, endTimeMs: END_TIME },
    "eodhd",
  );

  assert.equal(plan.plannedBarCount, 275);
  assert.ok(spanDays(plan) >= 365, `expected at least 365 days, received ${spanDays(plan)}`);
});

test("EODHD planning accounts for two aggregated 4h bars per regular session", () => {
  const plan = buildHistoricalFetchPlan(
    { symbol: "NVVE", timeframe: "4h", lookbackBars: 180, endTimeMs: END_TIME },
    "eodhd",
  );

  assert.equal(plan.plannedBarCount, 252);
  assert.ok(spanDays(plan) >= 180, `expected at least 180 days, received ${spanDays(plan)}`);
});

test("EODHD planning crosses nights and weekends for short 5m lookbacks", () => {
  const plan = buildHistoricalFetchPlan(
    { symbol: "NVVE", timeframe: "5m", lookbackBars: 100, endTimeMs: END_TIME },
    "eodhd",
  );

  assert.equal(plan.plannedBarCount, 160);
  assert.ok(spanDays(plan) >= 7, `expected at least 7 days, received ${spanDays(plan)}`);
});

test("non-EODHD providers retain nominal-span planning", () => {
  const plan = buildHistoricalFetchPlan(
    { symbol: "NVVE", timeframe: "daily", lookbackBars: 220, endTimeMs: END_TIME },
    "ibkr",
  );

  assert.equal(spanDays(plan), plan.plannedBarCount);
});
