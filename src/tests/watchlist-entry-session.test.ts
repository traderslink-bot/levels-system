import assert from "node:assert/strict";
import test from "node:test";

import { getWatchlistEntrySessionGroup } from "../lib/monitoring/watchlist-entry-session.js";

test("watchlist entry session grouping follows the website's New York add-time boundary", () => {
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"], activatedAt: Date.parse("2026-07-16T12:00:00Z") }), "main");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"], activatedAt: Date.parse("2026-07-16T19:59:00Z") }), "main");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"], activatedAt: Date.parse("2026-07-16T20:00:00Z") }), "postmarket");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"], activatedAt: Date.parse("2026-07-16T23:59:00Z") }), "postmarket");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"], activatedAt: Date.parse("2026-07-17T00:00:00Z") }), "main");
});

test("explicit automatic session tags and legacy notes take precedence over timestamps", () => {
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["auto", "auto-postmarket"], activatedAt: Date.parse("2026-07-16T15:00:00Z") }), "postmarket");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["auto", "auto-main"], activatedAt: Date.parse("2026-07-16T22:00:00Z") }), "main");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"], note: "Auto-selected during postmarket: test" }), "postmarket");
  assert.equal(getWatchlistEntrySessionGroup({ tags: ["manual"] }), "main");
});
