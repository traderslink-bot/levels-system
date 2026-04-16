import type { AdaptiveScoringConfig } from "./adaptive-scoring.js";

export type AdaptiveStabilityConfig = {
  baseSmoothingFactor: number;
  driftSmoothingFactor: number;
  minSamplesForConfidence: number;
  samplesForFullConfidence: number;
  globalMinSamplesForConfidence: number;
  globalSamplesForFullConfidence: number;
  maxIncreasePerUpdate: number;
  maxDecreasePerUpdate: number;
  disableMinSamples: number;
  disableWeakStreakThreshold: number;
  protectedFloorMultiplier: number;
  driftDampeningFactor: number;
  driftDecreaseMultiplier: number;
  driftDisableProtection: number;
};

export type AdaptiveEventTypeState = {
  eventType: string;
  multiplier: number;
  disabled: boolean;
  disableReason: string | null;
  weakUpdateStreak: number;
  lastTargetMultiplier?: number;
  lastConfidence?: number;
};

export type AdaptiveStabilityState = {
  globalMultiplier: number;
  eventTypes: Record<string, AdaptiveEventTypeState>;
};

export type AdaptiveEventTypeTarget = {
  eventType: string;
  targetMultiplier: number;
  disableIntent: boolean;
  disableReason: string | null;
  expectancy: number;
  sampleSize: number;
};

export type AdaptiveTargetState = {
  targetGlobalMultiplier: number;
  globalSampleSize: number;
  driftDeclining: boolean;
  driftDelta: number;
  eventTypeTargets: Record<string, AdaptiveEventTypeTarget>;
};

export type AdaptiveStabilityDiagnostics = {
  globalConfidence: number;
  globalDeltaApplied: number;
  driftDampeningActive: boolean;
  eventTypeDiagnostics: Record<string, {
    confidence: number;
    deltaApplied: number;
    disableProtected: boolean;
    weakUpdateStreak: number;
  }>;
};

export type AdaptiveStabilityResult = {
  state: AdaptiveStabilityState;
  appliedGlobalMultiplier: number;
  appliedEventTypeMultipliers: Record<string, number>;
  disabledEventTypes: Record<string, {
    disabled: boolean;
    disableReason: string | null;
  }>;
  diagnostics: AdaptiveStabilityDiagnostics;
};

const DEFAULT_STABILITY_CONFIG: AdaptiveStabilityConfig = {
  baseSmoothingFactor: 0.3,
  driftSmoothingFactor: 0.18,
  minSamplesForConfidence: 3,
  samplesForFullConfidence: 20,
  globalMinSamplesForConfidence: 5,
  globalSamplesForFullConfidence: 40,
  maxIncreasePerUpdate: 0.08,
  maxDecreasePerUpdate: 0.05,
  disableMinSamples: 12,
  disableWeakStreakThreshold: 3,
  protectedFloorMultiplier: 0.72,
  driftDampeningFactor: 0.65,
  driftDecreaseMultiplier: 0.75,
  driftDisableProtection: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function interpolateConfidence(
  sampleSize: number,
  minSamples: number,
  fullSamples: number,
): number {
  if (sampleSize <= 0) {
    return 0;
  }

  if (sampleSize <= minSamples) {
    return round(clamp(sampleSize / Math.max(minSamples, 1), 0.05, 1));
  }

  if (sampleSize >= fullSamples) {
    return 1;
  }

  const range = Math.max(1, fullSamples - minSamples);
  return round(clamp((sampleSize - minSamples) / range, 0.05, 1));
}

function clampDelta(
  delta: number,
  maxIncrease: number,
  maxDecrease: number,
): number {
  if (delta >= 0) {
    return Math.min(delta, maxIncrease);
  }

  return Math.max(delta, -maxDecrease);
}

function applyTransition(params: {
  current: number;
  target: number;
  confidence: number;
  smoothingFactor: number;
  maxIncrease: number;
  maxDecrease: number;
}): { next: number; deltaApplied: number } {
  const desiredDelta = (params.target - params.current) * params.confidence * params.smoothingFactor;
  const deltaApplied = clampDelta(desiredDelta, params.maxIncrease, params.maxDecrease);

  return {
    next: params.current + deltaApplied,
    deltaApplied,
  };
}

function createInitialState(): AdaptiveStabilityState {
  return {
    globalMultiplier: 1,
    eventTypes: {},
  };
}

export class AdaptiveStabilityLayer {
  private state: AdaptiveStabilityState;

  constructor(
    private readonly scoringConfig: Pick<AdaptiveScoringConfig, "minMultiplier" | "maxMultiplier">,
    private readonly config: AdaptiveStabilityConfig = DEFAULT_STABILITY_CONFIG,
    initialState?: AdaptiveStabilityState,
  ) {
    this.state = initialState
      ? {
        globalMultiplier: initialState.globalMultiplier,
        eventTypes: { ...initialState.eventTypes },
      }
      : createInitialState();
  }

  getState(): AdaptiveStabilityState {
    return {
      globalMultiplier: this.state.globalMultiplier,
      eventTypes: Object.fromEntries(
        Object.entries(this.state.eventTypes).map(([eventType, value]) => [eventType, { ...value }]),
      ),
    };
  }

  applyTargets(targets: AdaptiveTargetState): AdaptiveStabilityResult {
    const driftActive = targets.driftDeclining;
    const globalConfidence = interpolateConfidence(
      targets.globalSampleSize,
      this.config.globalMinSamplesForConfidence,
      this.config.globalSamplesForFullConfidence,
    );
    const globalTransition = applyTransition({
      current: this.state.globalMultiplier,
      target: targets.targetGlobalMultiplier,
      confidence: globalConfidence,
      smoothingFactor: driftActive
        ? this.config.driftSmoothingFactor
        : this.config.baseSmoothingFactor,
      maxIncrease: this.config.maxIncreasePerUpdate * (driftActive ? this.config.driftDampeningFactor : 1),
      maxDecrease: this.config.maxDecreasePerUpdate *
        (driftActive ? this.config.driftDecreaseMultiplier : 1),
    });

    const nextState: AdaptiveStabilityState = {
      globalMultiplier: round(clamp(
        globalTransition.next,
        this.scoringConfig.minMultiplier,
        this.scoringConfig.maxMultiplier,
      )),
      eventTypes: {},
    };
    const appliedEventTypeMultipliers: Record<string, number> = {};
    const disabledEventTypes: Record<string, { disabled: boolean; disableReason: string | null }> = {};
    const eventTypeDiagnostics: AdaptiveStabilityDiagnostics["eventTypeDiagnostics"] = {};

    for (const [eventType, target] of Object.entries(targets.eventTypeTargets)) {
      const previousState = this.state.eventTypes[eventType] ?? {
        eventType,
        multiplier: 1,
        disabled: false,
        disableReason: null,
        weakUpdateStreak: 0,
      };
      const confidence = interpolateConfidence(
        target.sampleSize,
        this.config.minSamplesForConfidence,
        this.config.samplesForFullConfidence,
      );
      const transition = applyTransition({
        current: previousState.multiplier,
        target: target.targetMultiplier,
        confidence,
        smoothingFactor: driftActive
          ? this.config.driftSmoothingFactor
          : this.config.baseSmoothingFactor,
        maxIncrease: this.config.maxIncreasePerUpdate * (driftActive ? this.config.driftDampeningFactor : 1),
        maxDecrease: this.config.maxDecreasePerUpdate *
          (driftActive ? this.config.driftDecreaseMultiplier : 1),
      });

      const requiredWeakStreak = this.config.disableWeakStreakThreshold +
        (driftActive ? this.config.driftDisableProtection : 0);
      const weakUpdateStreak = target.disableIntent ? previousState.weakUpdateStreak + 1 : 0;
      const disableEligible = target.disableIntent &&
        target.sampleSize >= this.config.disableMinSamples &&
        weakUpdateStreak >= requiredWeakStreak;
      const disableProtected = target.disableIntent && !disableEligible;
      const protectedFloor = disableProtected
        ? Math.max(this.scoringConfig.minMultiplier, this.config.protectedFloorMultiplier)
        : this.scoringConfig.minMultiplier;
      const nextMultiplier = round(clamp(
        transition.next,
        protectedFloor,
        this.scoringConfig.maxMultiplier,
      ));
      const disabled = disableEligible
        ? true
        : (!target.disableIntent && previousState.disabled ? false : previousState.disabled);
      const disableReason = disabled ? target.disableReason ?? "sustained_negative_expectancy" : null;

      nextState.eventTypes[eventType] = {
        eventType,
        multiplier: nextMultiplier,
        disabled,
        disableReason,
        weakUpdateStreak,
        lastTargetMultiplier: round(target.targetMultiplier),
        lastConfidence: confidence,
      };
      appliedEventTypeMultipliers[eventType] = nextMultiplier;
      disabledEventTypes[eventType] = {
        disabled,
        disableReason,
      };
      eventTypeDiagnostics[eventType] = {
        confidence,
        deltaApplied: round(transition.deltaApplied),
        disableProtected,
        weakUpdateStreak,
      };
    }

    this.state = nextState;

    return {
      state: this.getState(),
      appliedGlobalMultiplier: nextState.globalMultiplier,
      appliedEventTypeMultipliers,
      disabledEventTypes,
      diagnostics: {
        globalConfidence,
        globalDeltaApplied: round(globalTransition.deltaApplied),
        driftDampeningActive: driftActive,
        eventTypeDiagnostics,
      },
    };
  }
}

export function createAdaptiveStabilityLayer(
  scoringConfig: Pick<AdaptiveScoringConfig, "minMultiplier" | "maxMultiplier">,
  config?: AdaptiveStabilityConfig,
  initialState?: AdaptiveStabilityState,
): AdaptiveStabilityLayer {
  return new AdaptiveStabilityLayer(scoringConfig, config, initialState);
}

export const DEFAULT_ADAPTIVE_STABILITY_CONFIG = DEFAULT_STABILITY_CONFIG;
