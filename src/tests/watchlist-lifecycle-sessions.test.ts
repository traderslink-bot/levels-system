import assert from "node:assert/strict";
import test from "node:test";

import type { ManualWatchlistLifecycleEvent } from "../lib/monitoring/manual-watchlist-runtime-events.js";
import {
  buildWatchlistLifecycleSessionsFromEvents,
  classifyWatchlistLifecycleScope,
  groupWatchlistLifecycleSessionsBySymbol,
} from "../lib/review/watchlist-lifecycle-sessions.js";

function event(
  eventName: ManualWatchlistLifecycleEvent["event"],
  symbol: string,
  timestamp: number,
): ManualWatchlistLifecycleEvent {
  return {
    type: "manual_watchlist_lifecycle",
    event: eventName,
    symbol,
    timestamp,
  };
}

test("watchlist lifecycle sessions turn activation and deactivation events into an active window", () => {
  const sessions = buildWatchlistLifecycleSessionsFromEvents([
    event("activation_queued", "abcd", 1000),
    event("activation_started", "ABCD", 1500),
    event("activation_completed", "ABCD", 3000),
    event("deactivated", "ABCD", 9000),
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.symbol, "ABCD");
  assert.equal(sessions[0]?.startedAt, 1000);
  assert.equal(sessions[0]?.endedAt, 9000);
  assert.equal(sessions[0]?.source, "event_log");
  assert.equal(sessions[0]?.status, "live");

  const grouped = groupWatchlistLifecycleSessionsBySymbol(sessions);
  assert.equal(classifyWatchlistLifecycleScope({
    symbol: "ABCD",
    timestamp: 5000,
    sessionsBySymbol: grouped,
  }), "active_window");
  assert.equal(classifyWatchlistLifecycleScope({
    symbol: "ABCD",
    timestamp: 9500,
    sessionsBySymbol: grouped,
  }), "outside_active_window");
});

test("watchlist lifecycle sessions preserve restart restore windows", () => {
  const sessions = buildWatchlistLifecycleSessionsFromEvents([
    event("restore_started", "REST", 2000),
    event("restore_completed", "REST", 4000),
  ]);

  const grouped = groupWatchlistLifecycleSessionsBySymbol(sessions);
  assert.equal(classifyWatchlistLifecycleScope({
    symbol: "REST",
    timestamp: 3000,
    sessionsBySymbol: grouped,
  }), "restart_restore_window");
  assert.equal(classifyWatchlistLifecycleScope({
    symbol: "REST",
    timestamp: 5000,
    sessionsBySymbol: grouped,
  }), "active_window");
});
