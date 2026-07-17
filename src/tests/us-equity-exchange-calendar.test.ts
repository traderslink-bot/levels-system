import assert from "node:assert/strict";
import test from "node:test";

import { autoWatchlistSessionForTimestamp } from "../lib/auto-watchlist/auto-watchlist-selector.js";
import { marketSessionAt } from "../lib/ai/traderslink-ai-read-service.js";
import { classifyIntradayCandleTimestamp } from "../lib/market-data/candle-session-classifier.js";
import {
  classifyUsEquityMarketSession,
  getUsEquityTradingDay,
} from "../lib/market-data/us-equity-exchange-calendar.js";

test("U.S. equity calendar closes the scanner and AI Read on exchange holidays", () => {
  for (const timestamp of [
    Date.parse("2026-04-03T14:00:00Z"), // Good Friday, 10:00 ET
    Date.parse("2026-06-19T14:00:00Z"), // Juneteenth, 10:00 ET
    Date.parse("2026-07-03T14:00:00Z"), // Independence Day observed, 10:00 ET
  ]) {
    assert.equal(classifyUsEquityMarketSession(timestamp).session, "closed");
    assert.equal(autoWatchlistSessionForTimestamp(timestamp), "closed");
    assert.equal(marketSessionAt(timestamp), "closed");
    assert.equal(classifyIntradayCandleTimestamp(timestamp).session, "extended");
  }
});

test("U.S. equity calendar moves regular close and after-hours to 13:00 ET on a verified early close", () => {
  const day = getUsEquityTradingDay("2026-11-27");
  assert.equal(day.isTradingDay, true);
  assert.equal(day.earlyClose, true);
  assert.equal(day.regularCloseMinutes, 13 * 60);

  const regular = Date.parse("2026-11-27T17:30:00Z"); // 12:30 ET
  const afterHours = Date.parse("2026-11-27T18:30:00Z"); // 13:30 ET
  assert.equal(classifyUsEquityMarketSession(regular).session, "regular");
  assert.equal(classifyIntradayCandleTimestamp(regular).session, "regular");
  assert.equal(classifyUsEquityMarketSession(afterHours).session, "postmarket");
  assert.equal(classifyIntradayCandleTimestamp(afterHours).session, "after_hours");
  assert.equal(autoWatchlistSessionForTimestamp(afterHours), "postmarket");
  assert.equal(marketSessionAt(afterHours), "postmarket");
});

test("ordinary weekday session boundaries remain unchanged", () => {
  assert.equal(classifyUsEquityMarketSession(Date.parse("2026-07-16T13:00:00Z")).session, "premarket");
  assert.equal(classifyUsEquityMarketSession(Date.parse("2026-07-16T13:30:00Z")).session, "regular");
  assert.equal(classifyUsEquityMarketSession(Date.parse("2026-07-16T20:00:00Z")).session, "postmarket");
  assert.equal(classifyUsEquityMarketSession(Date.parse("2026-07-17T00:00:00Z")).session, "closed");
});
