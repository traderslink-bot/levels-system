import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVolumeBaselineFromCandles,
  VolumeActivityTracker,
} from "../lib/monitoring/volume-activity.js";

const minute = 60_000;

test("volume activity converts IBKR-style cumulative volume into 5m bucket deltas", () => {
  const tracker = new VolumeActivityTracker({ minBaselineBars: 3 });
  tracker.setBaseline("ATER", { averageVolume: 1000, sampleSize: 12 });

  assert.equal(tracker.update({ symbol: "ATER", timestamp: 0, lastPrice: 1, volume: 10_000 }).reliability, "watch");
  tracker.update({ symbol: "ATER", timestamp: minute, lastPrice: 1.01, volume: 10_700 });
  const context = tracker.update({ symbol: "ATER", timestamp: 2 * minute, lastPrice: 1.02, volume: 12_200 });

  assert.equal(context.reliability, "reliable");
  assert.equal(context.currentBucketVolume, 2200);
  assert.equal(context.label, "strong");
  assert.equal(Number(context.relativeVolumeRatio?.toFixed(2)), 2.2);
});

test("volume activity marks missing, repeated, and non-monotonic volume as unsafe", () => {
  const tracker = new VolumeActivityTracker({ repeatedVolumeLimit: 2 });
  tracker.setBaseline("BIYA", { averageVolume: 1000, sampleSize: 12 });

  assert.equal(
    tracker.update({ symbol: "BIYA", timestamp: 0, lastPrice: 2 }).reliability,
    "unreliable",
  );
  tracker.update({ symbol: "BIYA", timestamp: minute, lastPrice: 2, volume: 5000 });
  assert.equal(
    tracker.update({ symbol: "BIYA", timestamp: 2 * minute, lastPrice: 2, volume: 5000 }).reliability,
    "watch",
  );
  assert.equal(
    tracker.update({ symbol: "BIYA", timestamp: 3 * minute, lastPrice: 2, volume: 5000 }).reliability,
    "unreliable",
  );
  assert.match(
    tracker.update({ symbol: "BIYA", timestamp: 4 * minute, lastPrice: 2, volume: 4900 }).reason,
    /backward|reset/,
  );
});

test("volume activity labels strong, expanding, normal, thin, and fading reads", () => {
  const tracker = new VolumeActivityTracker({ minBaselineBars: 3 });
  for (const symbol of ["STRONG", "EXPAND", "NORMAL", "THIN", "FADING"]) {
    tracker.setBaseline(symbol, { averageVolume: 1000, sampleSize: 12 });
    tracker.update({ symbol, timestamp: 0, lastPrice: 10, volume: 1000 });
  }

  assert.equal(
    tracker.update({ symbol: "STRONG", timestamp: minute, lastPrice: 10, volume: 3200 }).label,
    "strong",
  );
  assert.equal(
    tracker.update({ symbol: "EXPAND", timestamp: minute, lastPrice: 10, volume: 2500 }).label,
    "expanding",
  );
  assert.equal(
    tracker.update({ symbol: "NORMAL", timestamp: minute, lastPrice: 10, volume: 1900 }).label,
    "normal",
  );
  assert.equal(
    tracker.update({ symbol: "THIN", timestamp: minute, lastPrice: 10, volume: 1400 }).label,
    "thin",
  );

  tracker.update({ symbol: "FADING", timestamp: minute, lastPrice: 10, volume: 2500 });
  assert.equal(
    tracker.update({ symbol: "FADING", timestamp: 5 * minute, lastPrice: 10, volume: 2600 }).label,
    "fading",
  );
});

test("volume baseline uses recent positive 5m candle volume only after enough bars", () => {
  const small = buildVolumeBaselineFromCandles([
    { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 100 },
    { timestamp: 2, open: 1, high: 1, low: 1, close: 1, volume: 200 },
  ]);
  assert.equal(small, null);

  const baseline = buildVolumeBaselineFromCandles(
    Array.from({ length: 12 }, (_, index) => ({
      timestamp: index,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1000 + index,
    })),
  );
  assert.equal(baseline?.sampleSize, 12);
  assert.equal(baseline?.averageVolume, 1005.5);
});
