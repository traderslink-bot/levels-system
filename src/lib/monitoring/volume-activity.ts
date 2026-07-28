// 2026-05-01 America/Toronto
// Quiet volume/activity read for operator evidence and optional trader-facing enrichment.

import type { Candle } from "../market-data/candle-types.js";

type VolumePriceUpdate = {
  symbol: string;
  timestamp: number;
  lastPrice: number;
  volume?: number;
};

export type VolumeActivityLabel =
  | "expanding"
  | "strong"
  | "normal"
  | "thin"
  | "fading"
  | "unknown";

export type VolumeActivityReliability = "reliable" | "watch" | "unreliable";

export type VolumeActivityDirection =
  | "increasing"
  | "flat"
  | "fading"
  | "unknown";

export type VolumeActivityContext = {
  label: VolumeActivityLabel;
  reliability: VolumeActivityReliability;
  currentBucketVolume: number | null;
  baselineAverageVolume: number | null;
  relativeVolumeRatio: number | null;
  direction: VolumeActivityDirection;
  reason: string;
  traderLine?: string;
};

export type VolumeActivityBaseline = {
  averageVolume: number;
  sampleSize: number;
};

export type VolumeActivityTrackerOptions = {
  bucketMs?: number;
  minBaselineBars?: number;
  repeatedVolumeLimit?: number;
  strongRatio?: number;
  expandingRatio?: number;
  thinRatio?: number;
  fadingBucketRatio?: number;
};

type SymbolVolumeState = {
  baseline?: VolumeActivityBaseline;
  lastCumulativeVolume?: number;
  repeatedVolumeCount: number;
  currentBucketStart?: number;
  currentBucketVolume: number;
  completedBuckets: Array<{ start: number; volume: number }>;
  context: VolumeActivityContext;
};

const DEFAULT_OPTIONS: Required<VolumeActivityTrackerOptions> = {
  bucketMs: 5 * 60 * 1000,
  minBaselineBars: 10,
  repeatedVolumeLimit: 4,
  strongRatio: 2,
  expandingRatio: 1.4,
  thinRatio: 0.75,
  fadingBucketRatio: 0.8,
};

export function unknownVolumeActivityContext(reason: string): VolumeActivityContext {
  return {
    label: "unknown",
    reliability: "unreliable",
    currentBucketVolume: null,
    baselineAverageVolume: null,
    relativeVolumeRatio: null,
    direction: "unknown",
    reason,
  };
}

export function buildVolumeBaselineFromCandles(
  candles: Candle[],
  minBaselineBars = DEFAULT_OPTIONS.minBaselineBars,
  maxBars = 20,
): VolumeActivityBaseline | null {
  const volumes = candles
    .map((candle) => candle.volume)
    .filter((volume) => Number.isFinite(volume) && volume > 0)
    .slice(-maxBars);

  if (volumes.length < minBaselineBars) {
    return null;
  }

  const averageVolume = volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length;
  if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
    return null;
  }

  return {
    averageVolume,
    sampleSize: volumes.length,
  };
}

function bucketStart(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function classifyDirection(
  currentBucketVolume: number,
  previousBucketVolume: number | undefined,
  options: Required<VolumeActivityTrackerOptions>,
): VolumeActivityDirection {
  if (previousBucketVolume === undefined || previousBucketVolume <= 0) {
    return "unknown";
  }

  if (currentBucketVolume <= previousBucketVolume * options.fadingBucketRatio) {
    return "fading";
  }
  if (currentBucketVolume >= previousBucketVolume * 1.15) {
    return "increasing";
  }
  return "flat";
}

function classifyLabel(
  relativeVolumeRatio: number,
  direction: VolumeActivityDirection,
  options: Required<VolumeActivityTrackerOptions>,
): VolumeActivityLabel {
  if (direction === "fading" && relativeVolumeRatio < 1) {
    return "fading";
  }
  if (relativeVolumeRatio >= options.strongRatio) {
    return "strong";
  }
  if (relativeVolumeRatio >= options.expandingRatio && direction !== "fading") {
    return "expanding";
  }
  if (relativeVolumeRatio < options.thinRatio) {
    return direction === "fading" ? "fading" : "thin";
  }
  return "normal";
}

function buildTraderLine(label: VolumeActivityLabel): string | undefined {
  switch (label) {
    case "strong":
      return "activity: volume is running well above its recent pace";
    case "expanding":
      return "activity: volume is expanding compared with recent 5-minute activity";
    case "thin":
      return "activity: volume is still thin, so the move needs stronger acceptance";
    case "fading":
      return "activity: volume is fading while price is still testing the area";
    default:
      return undefined;
  }
}

export class VolumeActivityTracker {
  private readonly options: Required<VolumeActivityTrackerOptions>;
  private readonly states = new Map<string, SymbolVolumeState>();

  constructor(options: VolumeActivityTrackerOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  reset(symbol: string): void {
    this.states.delete(symbol.toUpperCase());
  }

  setBaseline(symbol: string, baseline: VolumeActivityBaseline | null | undefined): void {
    if (!baseline || baseline.sampleSize < this.options.minBaselineBars || baseline.averageVolume <= 0) {
      return;
    }

    const state = this.ensureState(symbol);
    state.baseline = baseline;
    state.context = {
      ...state.context,
      baselineAverageVolume: baseline.averageVolume,
    };
  }

  getContext(symbol: string): VolumeActivityContext | undefined {
    return this.states.get(symbol.toUpperCase())?.context;
  }

  update(update: VolumePriceUpdate): VolumeActivityContext {
    const state = this.ensureState(update.symbol);
    const volume = update.volume;
    if (!Number.isFinite(volume) || volume === undefined || volume <= 0) {
      state.context = {
        ...unknownVolumeActivityContext("live volume missing or empty"),
        baselineAverageVolume: state.baseline?.averageVolume ?? null,
      };
      return state.context;
    }

    if (state.lastCumulativeVolume === undefined) {
      state.lastCumulativeVolume = volume;
      state.currentBucketStart = bucketStart(update.timestamp, this.options.bucketMs);
      state.context = {
        label: "unknown",
        reliability: "watch",
        currentBucketVolume: 0,
        baselineAverageVolume: state.baseline?.averageVolume ?? null,
        relativeVolumeRatio: null,
        direction: "unknown",
        reason: "waiting for cumulative volume delta",
      };
      return state.context;
    }

    if (volume < state.lastCumulativeVolume) {
      state.lastCumulativeVolume = volume;
      state.repeatedVolumeCount = 0;
      state.currentBucketVolume = 0;
      state.currentBucketStart = bucketStart(update.timestamp, this.options.bucketMs);
      state.context = {
        ...unknownVolumeActivityContext("live volume moved backward or reset"),
        baselineAverageVolume: state.baseline?.averageVolume ?? null,
      };
      return state.context;
    }

    if (volume === state.lastCumulativeVolume) {
      state.repeatedVolumeCount += 1;
      state.context = {
        label: "unknown",
        reliability:
          state.repeatedVolumeCount >= this.options.repeatedVolumeLimit
            ? "unreliable"
            : "watch",
        currentBucketVolume: state.currentBucketVolume,
        baselineAverageVolume: state.baseline?.averageVolume ?? null,
        relativeVolumeRatio: state.baseline
          ? state.currentBucketVolume / state.baseline.averageVolume
          : null,
        direction: "unknown",
        reason:
          state.repeatedVolumeCount >= this.options.repeatedVolumeLimit
            ? "live volume repeated too long"
            : "waiting for live volume to advance",
      };
      return state.context;
    }

    const delta = volume - state.lastCumulativeVolume;
    state.lastCumulativeVolume = volume;
    state.repeatedVolumeCount = 0;
    const nextBucketStart = bucketStart(update.timestamp, this.options.bucketMs);
    if (state.currentBucketStart === undefined) {
      state.currentBucketStart = nextBucketStart;
    }
    if (nextBucketStart > state.currentBucketStart) {
      state.completedBuckets.push({
        start: state.currentBucketStart,
        volume: state.currentBucketVolume,
      });
      state.completedBuckets = state.completedBuckets.slice(-24);
      state.currentBucketStart = nextBucketStart;
      state.currentBucketVolume = 0;
    }
    state.currentBucketVolume += delta;

    const liveBaseline =
      state.baseline ??
      this.deriveLiveBaseline(state.completedBuckets.map((bucket) => bucket.volume));
    if (!liveBaseline) {
      state.context = {
        label: "unknown",
        reliability: "watch",
        currentBucketVolume: state.currentBucketVolume,
        baselineAverageVolume: null,
        relativeVolumeRatio: null,
        direction: "unknown",
        reason: "not enough 5-minute baseline volume yet",
      };
      return state.context;
    }

    const previousBucket = state.completedBuckets.at(-1)?.volume;
    const direction = classifyDirection(state.currentBucketVolume, previousBucket, this.options);
    const relativeVolumeRatio = state.currentBucketVolume / liveBaseline.averageVolume;
    const label = classifyLabel(relativeVolumeRatio, direction, this.options);
    state.context = {
      label,
      reliability: "reliable",
      currentBucketVolume: state.currentBucketVolume,
      baselineAverageVolume: liveBaseline.averageVolume,
      relativeVolumeRatio,
      direction,
      reason: `current 5m bucket is ${relativeVolumeRatio.toFixed(2)}x recent average`,
      traderLine: buildTraderLine(label),
    };
    return state.context;
  }

  private deriveLiveBaseline(volumes: number[]): VolumeActivityBaseline | null {
    const valid = volumes.filter((volume) => Number.isFinite(volume) && volume > 0);
    if (valid.length < this.options.minBaselineBars) {
      return null;
    }
    const sample = valid.slice(-20);
    return {
      averageVolume: sample.reduce((sum, volume) => sum + volume, 0) / sample.length,
      sampleSize: sample.length,
    };
  }

  private ensureState(symbol: string): SymbolVolumeState {
    const normalized = symbol.toUpperCase();
    const existing = this.states.get(normalized);
    if (existing) {
      return existing;
    }

    const created: SymbolVolumeState = {
      repeatedVolumeCount: 0,
      currentBucketVolume: 0,
      completedBuckets: [],
      context: unknownVolumeActivityContext("no live volume received yet"),
    };
    this.states.set(normalized, created);
    return created;
  }
}
