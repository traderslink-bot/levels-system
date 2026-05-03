import assert from "node:assert/strict";
import test from "node:test";

import { buildPrimaryTradeAreaContext } from "../lib/monitoring/primary-trade-area.js";
import type { PracticalTradeStructureContext } from "../lib/monitoring/monitoring-types.js";

function tradeStructure(): PracticalTradeStructureContext {
  return {
    state: "range_bound",
    supportArea: {
      side: "support",
      low: 0.98,
      high: 1.00,
      representative: 1.00,
      strengthLabel: "moderate",
      zoneCount: 2,
    },
    resistanceArea: {
      side: "resistance",
      low: 1.06,
      high: 1.08,
      representative: 1.06,
      strengthLabel: "major",
      zoneCount: 2,
    },
    structureKey: "range_bound|0.98-1.08",
    practicalZoneKey: "0.98-1.08",
    traderLine: "range",
    reason: "test",
    isMaterialStateChange: false,
  };
}

test("primary trade area locks quiet range behavior inside the same battlefield", () => {
  const context = buildPrimaryTradeAreaContext({
    symbol: "CYCU",
    price: 1.03,
    tradeStructure: tradeStructure(),
    rangeBox: { label: "active", low: 0.98, high: 1.08, widthPct: 8, recentInsidePostCount: 2 },
    acceptance: { label: "testing", beyondZonePct: null, reasons: [] },
  });

  assert.equal(context.locked, true);
  assert.equal(context.escapeSide, "none");
  assert.match(context.traderLine ?? "", /inside 1\.00 support and 1\.06 resistance/);
});

test("primary trade area distinguishes testing escape from accepted expansion", () => {
  const testing = buildPrimaryTradeAreaContext({
    symbol: "CYCU",
    price: 1.09,
    tradeStructure: tradeStructure(),
    rangeBox: { label: "active", low: 0.98, high: 1.08, widthPct: 8, recentInsidePostCount: 2 },
    acceptance: { label: "weak_probe", beyondZonePct: 0.8, reasons: [] },
  });
  const accepted = buildPrimaryTradeAreaContext({
    symbol: "CYCU",
    price: 1.12,
    tradeStructure: tradeStructure(),
    rangeBox: { label: "active", low: 0.98, high: 1.08, widthPct: 8, recentInsidePostCount: 2 },
    acceptance: { label: "accepted", beyondZonePct: 3.7, reasons: [] },
  });

  assert.equal(testing.escapeSide, "up");
  assert.equal(testing.escapeConfidence, "testing");
  assert.equal(accepted.escapeSide, "up");
  assert.equal(accepted.escapeConfidence, "accepted");
});

