import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";

test("WatchlistStatePersistence saves and loads manual watchlist state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "watchlist-state-"));
  const filePath = join(tempDir, "manual-watchlist-state.json");
  const persistence = new WatchlistStatePersistence({ filePath });

  persistence.save([
    {
      symbol: "albt",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "watching squeeze",
      discordThreadId: "discord-thread-7",
      lifecycle: "active",
      activatedAt: 123,
      lastLevelPostAt: 456,
      lastExtensionPostAt: 789,
      lastPriceUpdateAt: 800,
      lastPrice: 4.96,
      lastThreadPostAt: 900,
      lastThreadPostKind: "snapshot",
      refreshPending: false,
      tradersLinkAiReadBoundaryState: {
        generatedAt: 850,
        currentPrice: 3.95,
        upperBoundary: 4.2,
        lowerBoundary: 3.77,
        boundaries: [
          { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
        ],
        lastAutomaticRefreshRegime: null,
      },
      operationStatus: "monitoring live price",
    },
  ]);

  const loaded = persistence.load();
  assert.deepEqual(loaded, [
    {
      symbol: "ALBT",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "watching squeeze",
      discordThreadId: "discord-thread-7",
      lifecycle: "active",
      activatedAt: 123,
      lastLevelPostAt: 456,
      lastExtensionPostAt: 789,
      lastPriceUpdateAt: 800,
      lastPrice: 4.96,
      lastThreadPostAt: 900,
      lastThreadPostKind: "snapshot",
      refreshPending: false,
      tradersLinkAiReadBoundaryState: {
        generatedAt: 850,
        currentPrice: 3.95,
        upperBoundary: 4.2,
        lowerBoundary: 3.77,
        boundaries: [
          { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
        ],
        lastAutomaticRefreshRegime: null,
      },
      operationStatus: "monitoring live price",
    },
  ]);

  const raw = JSON.parse(readFileSync(filePath, "utf8")) as { version: number };
  assert.equal(raw.version, 1);

  rmSync(tempDir, { recursive: true, force: true });
});

test("WatchlistStatePersistence discards invalid persisted state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "watchlist-state-"));
  const filePath = join(tempDir, "manual-watchlist-state.json");
  const persistence = new WatchlistStatePersistence({ filePath });

  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      lastUpdated: Date.now(),
      entries: [
        {
          symbol: "ALBT",
          active: "yes",
          priority: 1,
          tags: ["manual"],
          lifecycle: "active",
        },
      ],
    }),
  );

  assert.equal(persistence.load(), null);
  rmSync(tempDir, { recursive: true, force: true });
});

test("WatchlistStore clears a published AI generation receipt explicitly", () => {
  const store = new WatchlistStore();
  const boundaryState = {
    generatedAt: 1_000,
    currentPrice: 1.25,
    upperBoundary: 1.4,
    lowerBoundary: 1.1,
    boundaries: [{ role: "mustClear" as const, side: "upside" as const, impact: "improves" as const, price: 1.4 }],
    lastAutomaticRefreshRegime: null,
  };
  store.upsertManualEntry({
    symbol: "TLQA",
    active: true,
    tags: ["manual"],
    pendingTradersLinkAiReadGeneration: {
      generationId: "TLQA-test-generation",
      createdAt: 1_001,
      trigger: "activation",
      boundaryState,
    },
  });

  const updated = store.patchEntry("TLQA", {
    pendingTradersLinkAiReadGeneration: null,
  });

  assert.ok(updated);
  assert.equal(updated.pendingTradersLinkAiReadGeneration, undefined);
});
