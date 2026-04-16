import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";

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
      refreshPending: false,
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
      refreshPending: false,
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
