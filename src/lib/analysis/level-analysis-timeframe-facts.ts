export const FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION = "level-analysis-15m-facts/v1";

export type FifteenMinuteFactAvailabilityStatus = "unavailable" | "limited" | "available";
export type FifteenMinuteRangeState = "unknown" | "compressed" | "normal" | "expanded";
export type FifteenMinuteReferencePosition =
  | "unknown"
  | "below_recent_range"
  | "near_recent_low"
  | "inside_recent_range"
  | "near_recent_high"
  | "above_recent_range";
export type FifteenMinuteTrendState = "unknown" | "mixed" | "up" | "down" | "sideways";
export type FifteenMinuteCloseLocation = "unknown" | "upper_third" | "middle_third" | "lower_third";
export type FifteenMinuteVolumeState = "unknown" | "low" | "normal" | "elevated" | "high" | "extreme";
export type FifteenMinuteParticipationState = "unknown" | "fading" | "steady" | "building" | "surging";
export type FifteenMinuteStructureState = "unknown" | "not_present" | "present";
export type FifteenMinuteFactDiagnosticSeverity = "info" | "warning" | "error";

export type FifteenMinuteFactLimitation =
  | "15m_input_not_provided"
  | "15m_closed_candles_missing"
  | "15m_insufficient_trend_history"
  | "15m_insufficient_volume_history"
  | "15m_facts_contract_only"
  | "15m_future_candles_filtered"
  | "15m_partial_candles_filtered"
  | string;

export type FifteenMinuteDataCompleteness = {
  availabilityStatus: FifteenMinuteFactAvailabilityStatus;
  provided: boolean;
  rawCandleCount: number;
  closedCandleCount: number;
  excludedFutureCandleCount: number;
  excludedPartialCandleCount: number;
  firstClosedTimestamp?: number;
  lastClosedTimestamp?: number;
  sufficientForTrendFacts: boolean;
  sufficientForVolumeFacts: boolean;
};

export type FifteenMinuteRangeFacts = {
  lookbackCandleCount: number;
  recentHigh?: number;
  recentLow?: number;
  recentMidpoint?: number;
  latestRangePct?: number;
  averageRangePct?: number;
  rangeState: FifteenMinuteRangeState;
  referencePosition: FifteenMinuteReferencePosition;
};

export type FifteenMinuteTrendFacts = {
  trendState: FifteenMinuteTrendState;
  higherCloseCount: number;
  lowerCloseCount: number;
  greenCandleCount: number;
  redCandleCount: number;
  latestCloseLocation: FifteenMinuteCloseLocation;
};

export type FifteenMinuteVolumeFacts = {
  volumeState: FifteenMinuteVolumeState;
  latestVolume?: number;
  rollingAverageVolume?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  participationState: FifteenMinuteParticipationState;
};

export type FifteenMinuteStructureFacts = {
  consolidationState: FifteenMinuteStructureState;
  pullbackState: FifteenMinuteStructureState;
  continuationState: FifteenMinuteStructureState;
  recentHighTimestamp?: number;
  recentLowTimestamp?: number;
};

export type FifteenMinuteFactDiagnostic = {
  code: string;
  severity: FifteenMinuteFactDiagnosticSeverity;
  message: string;
};

export type FifteenMinuteFactSafety = {
  noLookaheadApplied: boolean;
  levelOutputUnchanged: true;
  factsOnly: true;
  noRuntimeBehaviorChange: true;
};

export type FifteenMinuteFacts = {
  schemaVersion: typeof FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION;
  symbol: string;
  asOfTimestamp: number;
  dataCompleteness: FifteenMinuteDataCompleteness;
  range: FifteenMinuteRangeFacts;
  trend: FifteenMinuteTrendFacts;
  volume?: FifteenMinuteVolumeFacts;
  structure: FifteenMinuteStructureFacts;
  diagnostics: FifteenMinuteFactDiagnostic[];
  limitations: FifteenMinuteFactLimitation[];
  safety: FifteenMinuteFactSafety;
};

export type LevelAnalysisTimeframeFacts = {
  "15m"?: FifteenMinuteFacts;
};

export type FifteenMinuteFactsValidationResult = {
  valid: boolean;
  errors: string[];
};

export type CreateUnavailableFifteenMinuteFactsInput = {
  symbol: string;
  asOfTimestamp: number;
  rawCandleCount?: number;
  excludedFutureCandleCount?: number;
  excludedPartialCandleCount?: number;
  diagnostics?: FifteenMinuteFactDiagnostic[];
  limitations?: FifteenMinuteFactLimitation[];
};

export type FifteenMinuteFactsSummary = {
  schemaVersion: typeof FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION;
  symbol: string;
  asOfTimestamp: number;
  availabilityStatus: FifteenMinuteFactAvailabilityStatus;
  closedCandleCount: number;
  rangeState: FifteenMinuteRangeState;
  trendState: FifteenMinuteTrendState;
  volumeState: FifteenMinuteVolumeState;
  limitationCount: number;
  diagnosticCount: number;
  noLookaheadApplied: boolean;
  levelOutputUnchanged: true;
  factsOnly: true;
  noRuntimeBehaviorChange: true;
};

const FACT_ONLY_PROHIBITED_PATTERNS: Array<[string, RegExp]> = [
  ["recommendation", /\brecommendation\b/i],
  ["coaching", /\bcoaching\b/i],
  ["coach", /\bcoach\b/i],
  ["grading", /\bgrading\b/i],
  ["grade", /\bgrade\b/i],
  ["p/l", /\bp\/l\b/i],
  ["pnl", /\bpnl\b/i],
  ["giveback", /\bgiveback\b/i],
  ["behavior score", /\bbehavior score\b/i],
  ["behavior scoring", /\bbehavior scoring\b/i],
  ["trade advice", /\btrade advice\b/i],
  ["entry decision", /\bentry decision\b/i],
  ["exit decision", /\bexit decision\b/i],
  ["buy", /\bbuy\b/i],
  ["sell", /\bsell\b/i],
  ["hold", /\bhold\b/i],
  ["good trade", /\bgood trade\b/i],
  ["bad trade", /\bbad trade\b/i],
  ["should have", /\bshould have\b/i],
];

const LEVEL_CREATION_FIELD_NAMES = new Set([
  "supportLevels",
  "resistanceLevels",
  "generatedLevels",
  "candidateLevels",
  "levelCandidates",
  "levelEngineOutput",
  "majorSupport",
  "majorResistance",
  "intermediateSupport",
  "intermediateResistance",
  "intradaySupport",
  "intradayResistance",
  "extensionLevels",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireObject(value: unknown, label: string, errors: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return undefined;
  }

  return value;
}

function requireNumberField(value: Record<string, unknown>, field: string, label: string, errors: string[]): void {
  if (!isFiniteNumber(value[field])) {
    errors.push(`${label}.${field} must be a finite number.`);
  }
}

function requireBooleanField(value: Record<string, unknown>, field: string, label: string, errors: string[]): void {
  if (typeof value[field] !== "boolean") {
    errors.push(`${label}.${field} must be a boolean.`);
  }
}

function requireStringField(value: Record<string, unknown>, field: string, label: string, errors: string[]): void {
  if (typeof value[field] !== "string" || value[field].trim().length === 0) {
    errors.push(`${label}.${field} must be a non-empty string.`);
  }
}

function collectFactsOnlyBoundaryIssues(value: unknown): string[] {
  const issues: string[] = [];
  const seen = new Set<unknown>();

  function visit(item: unknown, path: string): void {
    if (item === null || item === undefined) {
      return;
    }

    if (typeof item === "string") {
      for (const [label, pattern] of FACT_ONLY_PROHIBITED_PATTERNS) {
        if (pattern.test(item)) {
          issues.push(`${path || "value"} contains ${label} language.`);
        }
      }
      return;
    }

    if (typeof item !== "object") {
      return;
    }

    if (seen.has(item)) {
      return;
    }
    seen.add(item);

    if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }

    for (const [key, entry] of Object.entries(item as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (LEVEL_CREATION_FIELD_NAMES.has(key)) {
        issues.push(`${nextPath} is a level-generation field and is not allowed in 15m facts.`);
      }

      for (const [label, pattern] of FACT_ONLY_PROHIBITED_PATTERNS) {
        if (pattern.test(key)) {
          issues.push(`${nextPath} uses ${label} field language.`);
        }
      }

      visit(entry, nextPath);
    }
  }

  visit(value, "");
  return issues;
}

export function assertFifteenMinuteFactsAreFactsOnly(value: unknown): void {
  const issues = collectFactsOnlyBoundaryIssues(value);
  if (issues.length > 0) {
    throw new Error(`15m facts must remain facts-only: ${issues.join(" ")}`);
  }
}

export function validateFifteenMinuteFacts(value: unknown): FifteenMinuteFactsValidationResult {
  const errors: string[] = [];
  const facts = requireObject(value, "FifteenMinuteFacts", errors);
  if (!facts) {
    return { valid: false, errors };
  }

  if (facts.schemaVersion !== FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION}.`);
  }
  requireStringField(facts, "symbol", "FifteenMinuteFacts", errors);
  requireNumberField(facts, "asOfTimestamp", "FifteenMinuteFacts", errors);

  const dataCompleteness = requireObject(facts.dataCompleteness, "dataCompleteness", errors);
  if (dataCompleteness) {
    requireStringField(dataCompleteness, "availabilityStatus", "dataCompleteness", errors);
    requireBooleanField(dataCompleteness, "provided", "dataCompleteness", errors);
    for (const field of [
      "rawCandleCount",
      "closedCandleCount",
      "excludedFutureCandleCount",
      "excludedPartialCandleCount",
    ]) {
      requireNumberField(dataCompleteness, field, "dataCompleteness", errors);
    }
    requireBooleanField(dataCompleteness, "sufficientForTrendFacts", "dataCompleteness", errors);
    requireBooleanField(dataCompleteness, "sufficientForVolumeFacts", "dataCompleteness", errors);
  }

  const range = requireObject(facts.range, "range", errors);
  if (range) {
    requireNumberField(range, "lookbackCandleCount", "range", errors);
    requireStringField(range, "rangeState", "range", errors);
    requireStringField(range, "referencePosition", "range", errors);
  }

  const trend = requireObject(facts.trend, "trend", errors);
  if (trend) {
    requireStringField(trend, "trendState", "trend", errors);
    for (const field of ["higherCloseCount", "lowerCloseCount", "greenCandleCount", "redCandleCount"]) {
      requireNumberField(trend, field, "trend", errors);
    }
    requireStringField(trend, "latestCloseLocation", "trend", errors);
  }

  if (facts.volume !== undefined) {
    const volume = requireObject(facts.volume, "volume", errors);
    if (volume) {
      requireStringField(volume, "volumeState", "volume", errors);
      requireStringField(volume, "participationState", "volume", errors);
    }
  }

  const structure = requireObject(facts.structure, "structure", errors);
  if (structure) {
    requireStringField(structure, "consolidationState", "structure", errors);
    requireStringField(structure, "pullbackState", "structure", errors);
    requireStringField(structure, "continuationState", "structure", errors);
  }

  if (!Array.isArray(facts.diagnostics)) {
    errors.push("diagnostics must be an array.");
  }
  if (!Array.isArray(facts.limitations)) {
    errors.push("limitations must be an array.");
  }

  const safety = requireObject(facts.safety, "safety", errors);
  if (safety) {
    for (const field of ["noLookaheadApplied", "levelOutputUnchanged", "factsOnly", "noRuntimeBehaviorChange"]) {
      requireBooleanField(safety, field, "safety", errors);
      if (safety[field] !== true) {
        errors.push(`safety.${field} must be true.`);
      }
    }
  }

  errors.push(...collectFactsOnlyBoundaryIssues(facts));

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isFifteenMinuteFacts(value: unknown): value is FifteenMinuteFacts {
  return validateFifteenMinuteFacts(value).valid;
}

export function createUnavailableFifteenMinuteFacts(
  input: CreateUnavailableFifteenMinuteFactsInput,
): FifteenMinuteFacts {
  return {
    schemaVersion: FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION,
    symbol: normalizeSymbol(input.symbol),
    asOfTimestamp: input.asOfTimestamp,
    dataCompleteness: {
      availabilityStatus: "unavailable",
      provided: false,
      rawCandleCount: input.rawCandleCount ?? 0,
      closedCandleCount: 0,
      excludedFutureCandleCount: input.excludedFutureCandleCount ?? 0,
      excludedPartialCandleCount: input.excludedPartialCandleCount ?? 0,
      sufficientForTrendFacts: false,
      sufficientForVolumeFacts: false,
    },
    range: {
      lookbackCandleCount: 0,
      rangeState: "unknown",
      referencePosition: "unknown",
    },
    trend: {
      trendState: "unknown",
      higherCloseCount: 0,
      lowerCloseCount: 0,
      greenCandleCount: 0,
      redCandleCount: 0,
      latestCloseLocation: "unknown",
    },
    structure: {
      consolidationState: "unknown",
      pullbackState: "unknown",
      continuationState: "unknown",
    },
    diagnostics: input.diagnostics ?? [
      {
        code: "15m_facts_unavailable",
        severity: "info",
        message: "No closed 15m facts are available for this snapshot.",
      },
    ],
    limitations: input.limitations ?? ["15m_input_not_provided", "15m_facts_contract_only"],
    safety: {
      noLookaheadApplied: true,
      levelOutputUnchanged: true,
      factsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

export function summarizeFifteenMinuteFacts(value: FifteenMinuteFacts): FifteenMinuteFactsSummary {
  return {
    schemaVersion: value.schemaVersion,
    symbol: value.symbol,
    asOfTimestamp: value.asOfTimestamp,
    availabilityStatus: value.dataCompleteness.availabilityStatus,
    closedCandleCount: value.dataCompleteness.closedCandleCount,
    rangeState: value.range.rangeState,
    trendState: value.trend.trendState,
    volumeState: value.volume?.volumeState ?? "unknown",
    limitationCount: value.limitations.length,
    diagnosticCount: value.diagnostics.length,
    noLookaheadApplied: value.safety.noLookaheadApplied,
    levelOutputUnchanged: value.safety.levelOutputUnchanged,
    factsOnly: value.safety.factsOnly,
    noRuntimeBehaviorChange: value.safety.noRuntimeBehaviorChange,
  };
}
