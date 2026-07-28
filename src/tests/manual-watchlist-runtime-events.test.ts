import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createManualWatchlistLifecycleFileListener,
  isMarketStructureLifecycleEvent,
} from "../lib/monitoring/manual-watchlist-runtime-events.js";

test("manual watchlist lifecycle file listener can persist only market structure events", () => {
  const directory = mkdtempSync(join(tmpdir(), "manual-watchlist-lifecycle-"));
  const path = join(directory, "market-structure-lifecycle.jsonl");
  const listener = createManualWatchlistLifecycleFileListener(path, {
    include: isMarketStructureLifecycleEvent,
  });

  listener({
    type: "manual_watchlist_lifecycle",
    event: "activation_completed",
    timestamp: 1_000,
    symbol: "ABCD",
  });
  listener({
    type: "manual_watchlist_lifecycle",
    event: "market_structure_posted",
    timestamp: 2_000,
    symbol: "ABCD",
    details: {
      reason: "pending_fresh_structure",
    },
  });

  const rows = readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, "market_structure_posted");
});
