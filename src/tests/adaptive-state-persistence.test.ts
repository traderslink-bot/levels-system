import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { AdaptiveStatePersistence } from "../lib/monitoring/adaptive-state-persistence.js";
import type { AdaptiveStabilityState } from "../lib/monitoring/adaptive-stability.js";

function makeTempFilePath(): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "adaptive-state-persistence-"));
  return {
    dir,
    filePath: join(dir, "adaptive-state.json"),
  };
}

function makePersistence(filePath: string): AdaptiveStatePersistence {
  return new AdaptiveStatePersistence({
    minMultiplier: 0.4,
    maxMultiplier: 1.4,
    filePath,
  });
}

test("AdaptiveStatePersistence loads valid persisted state", () => {
  const { dir, filePath } = makeTempFilePath();

  try {
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      lastUpdated: 1_776_000_000_000,
      globalMultiplier: 1.05,
      eventTypes: {
        breakout: {
          multiplier: 0.92,
          disabled: true,
          weakStreak: 3,
        },
      },
    }), "utf8");

    const state = makePersistence(filePath).load();

    assert.deepEqual(state, {
      globalMultiplier: 1.05,
      eventTypes: {
        breakout: {
          eventType: "breakout",
          multiplier: 0.92,
          disabled: true,
          disableReason: "persisted_disabled_state",
          weakUpdateStreak: 3,
        },
      },
    } satisfies AdaptiveStabilityState);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AdaptiveStatePersistence discards invalid persisted state", () => {
  const { dir, filePath } = makeTempFilePath();
  const originalConsoleError = console.error;
  const logged: string[] = [];

  try {
    console.error = (message?: unknown) => {
      logged.push(String(message));
    };

    writeFileSync(filePath, JSON.stringify({
      version: 1,
      lastUpdated: 1_776_000_000_000,
      globalMultiplier: 9,
      eventTypes: {},
    }), "utf8");

    const state = makePersistence(filePath).load();

    assert.equal(state, null);
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalConsoleError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AdaptiveStatePersistence saves the expected JSON structure", () => {
  const { dir, filePath } = makeTempFilePath();

  try {
    makePersistence(filePath).save({
      globalMultiplier: 1.02,
      eventTypes: {
        level_touch: {
          eventType: "level_touch",
          multiplier: 0.88,
          disabled: false,
          disableReason: null,
          weakUpdateStreak: 2,
        },
      },
    });

    const saved = JSON.parse(readFileSync(filePath, "utf8")) as {
      version: number;
      lastUpdated: number;
      globalMultiplier: number;
      eventTypes: Record<string, {
        multiplier: number;
        disabled: boolean;
        weakStreak: number;
      }>;
    };

    assert.equal(saved.version, 1);
    assert.equal(typeof saved.lastUpdated, "number");
    assert.equal(saved.globalMultiplier, 1.02);
    assert.deepEqual(saved.eventTypes, {
      level_touch: {
        multiplier: 0.88,
        disabled: false,
        weakStreak: 2,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
