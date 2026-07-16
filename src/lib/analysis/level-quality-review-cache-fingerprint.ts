export type LevelQualityReviewCacheFingerprintTimeframe = "5m" | "15m" | "4h" | "daily";

export type LevelQualityReviewCacheFingerprintProvider = "ibkr" | "eodhd" | "stub" | "twelve_data";

export type LevelQualityReviewCacheFingerprintSafety = {
  rawCandlesIncluded: false;
  rawCacheWrapperPayloadsIncluded: false;
  fullSnapshotsIncluded: false;
  providerCallsMade: false;
  cacheFilesWritten: false;
  fifteenMinuteFedIntoLevelEngine: false;
};

export type LevelQualityReviewCacheFingerprint = {
  schemaVersion: "level-quality-review-cache-fingerprint/v1";
  relativePath: string;
  provider: LevelQualityReviewCacheFingerprintProvider;
  symbol: string;
  timeframe: LevelQualityReviewCacheFingerprintTimeframe;
  sha256: string;
  wrapperCandleCount: number;
  requestLookbackBars: number;
  requestEndTimestamp: number;
  actualBarsReturned: number;
  validationIssueCount: number;
  firstCandleTimestamp?: number;
  lastCandleTimestamp?: number;
  asOfTimestamp?: number;
  includedInLevelEngine?: boolean;
  contextOnly?: boolean;
  safety: LevelQualityReviewCacheFingerprintSafety;
};

export type LevelQualityReviewCacheFingerprintSet = {
  schemaVersion: "level-quality-review-cache-fingerprint-set/v1";
  generatedAt?: string;
  provider?: LevelQualityReviewCacheFingerprintProvider;
  fingerprints: LevelQualityReviewCacheFingerprint[];
};

export type LevelQualityReviewCacheFingerprintValidationResult = {
  valid: boolean;
  errors: string[];
};

export type LevelQualityReviewCacheFingerprintSummary = {
  totalFingerprints: number;
  symbolCount: number;
  symbols: string[];
  providerCounts: Partial<Record<LevelQualityReviewCacheFingerprintProvider, number>>;
  timeframeCounts: Partial<Record<LevelQualityReviewCacheFingerprintTimeframe, number>>;
  levelEngineInputCount: number;
  contextOnlyCount: number;
  fifteenMinuteContextOnlyCount: number;
  validationIssueCount: number;
  wrapperCandleCount: number;
  actualBarsReturned: number;
  hasValidationIssues: boolean;
  firstCandleTimestamp?: number;
  lastCandleTimestamp?: number;
};

const FINGERPRINT_SCHEMA_VERSION = "level-quality-review-cache-fingerprint/v1";
const FINGERPRINT_SET_SCHEMA_VERSION = "level-quality-review-cache-fingerprint-set/v1";

const PROVIDERS: readonly LevelQualityReviewCacheFingerprintProvider[] = [
  "ibkr",
  "eodhd",
  "stub",
  "twelve_data",
];

const TIMEFRAMES: readonly LevelQualityReviewCacheFingerprintTimeframe[] = [
  "5m",
  "15m",
  "4h",
  "daily",
];

const FINGERPRINT_KEYS = new Set([
  "schemaVersion",
  "relativePath",
  "provider",
  "symbol",
  "timeframe",
  "sha256",
  "wrapperCandleCount",
  "requestLookbackBars",
  "requestEndTimestamp",
  "actualBarsReturned",
  "validationIssueCount",
  "firstCandleTimestamp",
  "lastCandleTimestamp",
  "asOfTimestamp",
  "includedInLevelEngine",
  "contextOnly",
  "safety",
]);

const FINGERPRINT_SET_KEYS = new Set([
  "schemaVersion",
  "generatedAt",
  "provider",
  "fingerprints",
]);

const SAFETY_KEYS = new Set([
  "rawCandlesIncluded",
  "rawCacheWrapperPayloadsIncluded",
  "fullSnapshotsIncluded",
  "providerCallsMade",
  "cacheFilesWritten",
  "fifteenMinuteFedIntoLevelEngine",
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "candles",
  "cacheWrapper",
  "cacheWrapperPayload",
  "rawCacheWrapper",
  "rawCacheWrapperPayload",
  "response",
  "request",
  "snapshot",
  "fullSnapshot",
  "levelAnalysisSnapshot",
  "levelEngineOutput",
]);

const FACTUAL_ONLY_BLOCKED_PATTERNS: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ["buy", /\bbuy\b/i],
  ["sell", /\bsell\b/i],
  ["hold", /\bhold\b/i],
  ["recommendation", /\brecommendation\b/i],
  ["trade advice", /\btrade\s+advice\b/i],
  ["grade", /\bgrade\b|\bgrading\b/i],
  ["coaching", /\bcoaching\b|\bcoach\b/i],
  ["p/l", /\bp\/l\b|\bpnl\b/i],
  ["giveback", /\bgiveback\b/i],
  ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/i],
  ["good trade", /\bgood trade\b/i],
  ["bad trade", /\bbad trade\b/i],
  ["should have", /\bshould have\b/i],
  ["mistake", /\bmistake\b/i],
  ["discipline", /\bdiscipline\b/i],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is LevelQualityReviewCacheFingerprintProvider {
  return typeof value === "string" && PROVIDERS.includes(value as LevelQualityReviewCacheFingerprintProvider);
}

function isTimeframe(value: unknown): value is LevelQualityReviewCacheFingerprintTimeframe {
  return typeof value === "string" && TIMEFRAMES.includes(value as LevelQualityReviewCacheFingerprintTimeframe);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateKnownKeys(
  errors: string[],
  value: Record<string, unknown>,
  knownKeys: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) {
      errors.push(`${label}.${key} is not part of the compact cache fingerprint contract`);
    }
  }
}

function validateNoForbiddenPayloads(
  errors: string[],
  value: unknown,
  path = "fingerprint",
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (
        isRecord(item) &&
        "open" in item &&
        "high" in item &&
        "low" in item &&
        "close" in item &&
        "volume" in item
      ) {
        errors.push(`${path}[${index}] looks like a raw candle and is not allowed`);
      }
      validateNoForbiddenPayloads(errors, item, `${path}[${index}]`);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      errors.push(`${path}.${key} is a raw payload field and is not allowed`);
    }
    validateNoForbiddenPayloads(errors, child, `${path}.${key}`);
  }
}

function validateRelativePath(errors: string[], value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push("relativePath must be a non-empty string");
    return;
  }

  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    errors.push("relativePath must be a portable relative path using forward slashes");
  }
  if (value.split("/").some((segment) => segment === ".." || segment.trim() === "")) {
    errors.push("relativePath must not contain empty or parent-directory segments");
  }
}

function validateOptionalTimestamp(
  errors: string[],
  value: Record<string, unknown>,
  key: "firstCandleTimestamp" | "lastCandleTimestamp" | "asOfTimestamp",
): void {
  if (value[key] !== undefined && !isNonNegativeInteger(value[key])) {
    errors.push(`${key} must be a non-negative integer timestamp when present`);
  }
}

function validateSafety(errors: string[], value: unknown): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }

  validateKnownKeys(errors, value, SAFETY_KEYS, "safety");

  for (const key of SAFETY_KEYS) {
    if (value[key] !== false) {
      errors.push(`safety.${key} must be false`);
    }
  }
}

export function validateLevelQualityReviewCacheFingerprint(
  value: unknown,
): LevelQualityReviewCacheFingerprintValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["fingerprint must be an object"],
    };
  }

  validateKnownKeys(errors, value, FINGERPRINT_KEYS, "fingerprint");
  validateNoForbiddenPayloads(errors, value);

  if (value.schemaVersion !== FINGERPRINT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FINGERPRINT_SCHEMA_VERSION}`);
  }
  validateRelativePath(errors, value.relativePath);

  if (!isProvider(value.provider)) {
    errors.push("provider must be ibkr, stub, or twelve_data");
  }
  if (typeof value.symbol !== "string" || value.symbol.trim() === "") {
    errors.push("symbol must be a non-empty string");
  }
  if (!isTimeframe(value.timeframe)) {
    errors.push("timeframe must be 5m, 15m, 4h, or daily");
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    errors.push("sha256 must be a lowercase 64-character hexadecimal digest");
  }
  if (!isNonNegativeInteger(value.wrapperCandleCount)) {
    errors.push("wrapperCandleCount must be a non-negative integer");
  }
  if (!isPositiveInteger(value.requestLookbackBars)) {
    errors.push("requestLookbackBars must be a positive integer");
  }
  if (!isNonNegativeInteger(value.requestEndTimestamp)) {
    errors.push("requestEndTimestamp must be a non-negative integer timestamp");
  }
  if (!isNonNegativeInteger(value.actualBarsReturned)) {
    errors.push("actualBarsReturned must be a non-negative integer");
  }
  if (!isNonNegativeInteger(value.validationIssueCount)) {
    errors.push("validationIssueCount must be a non-negative integer");
  }

  validateOptionalTimestamp(errors, value, "firstCandleTimestamp");
  validateOptionalTimestamp(errors, value, "lastCandleTimestamp");
  validateOptionalTimestamp(errors, value, "asOfTimestamp");

  if (
    isNonNegativeInteger(value.firstCandleTimestamp) &&
    isNonNegativeInteger(value.lastCandleTimestamp) &&
    value.firstCandleTimestamp > value.lastCandleTimestamp
  ) {
    errors.push("firstCandleTimestamp must be less than or equal to lastCandleTimestamp");
  }

  if (
    isNonNegativeInteger(value.wrapperCandleCount) &&
    isNonNegativeInteger(value.actualBarsReturned) &&
    value.wrapperCandleCount !== value.actualBarsReturned
  ) {
    errors.push("wrapperCandleCount must equal actualBarsReturned");
  }

  if (value.includedInLevelEngine !== undefined && typeof value.includedInLevelEngine !== "boolean") {
    errors.push("includedInLevelEngine must be boolean when present");
  }
  if (value.contextOnly !== undefined && typeof value.contextOnly !== "boolean") {
    errors.push("contextOnly must be boolean when present");
  }
  if (value.includedInLevelEngine === true && value.contextOnly === true) {
    errors.push("includedInLevelEngine and contextOnly cannot both be true");
  }
  if (value.timeframe === "15m") {
    if (value.contextOnly !== true) {
      errors.push("15m fingerprints must be marked contextOnly true");
    }
    if (value.includedInLevelEngine !== false) {
      errors.push("15m fingerprints must be marked includedInLevelEngine false");
    }
  }

  validateSafety(errors, value.safety);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isLevelQualityReviewCacheFingerprint(
  value: unknown,
): value is LevelQualityReviewCacheFingerprint {
  return validateLevelQualityReviewCacheFingerprint(value).valid;
}

export function validateLevelQualityReviewCacheFingerprintSet(
  value: unknown,
): LevelQualityReviewCacheFingerprintValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["fingerprint set must be an object"],
    };
  }

  validateKnownKeys(errors, value, FINGERPRINT_SET_KEYS, "fingerprintSet");
  validateNoForbiddenPayloads(errors, value, "fingerprintSet");

  if (value.schemaVersion !== FINGERPRINT_SET_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FINGERPRINT_SET_SCHEMA_VERSION}`);
  }
  if (value.generatedAt !== undefined) {
    if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
      errors.push("generatedAt must be a valid ISO timestamp when present");
    }
  }
  if (value.provider !== undefined && !isProvider(value.provider)) {
    errors.push("provider must be ibkr, stub, or twelve_data when present");
  }
  if (!Array.isArray(value.fingerprints) || value.fingerprints.length === 0) {
    errors.push("fingerprints must be a non-empty array");
  } else {
    const seen = new Set<string>();
    for (const [index, fingerprint] of value.fingerprints.entries()) {
      const validation = validateLevelQualityReviewCacheFingerprint(fingerprint);
      for (const error of validation.errors) {
        errors.push(`fingerprints[${index}].${error}`);
      }

      if (isRecord(fingerprint)) {
        const key = `${String(fingerprint.provider)}|${String(fingerprint.symbol)}|${String(fingerprint.timeframe)}|${String(fingerprint.relativePath)}`;
        if (seen.has(key)) {
          errors.push(`fingerprints[${index}] duplicates provider symbol timeframe and relativePath`);
        }
        seen.add(key);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isLevelQualityReviewCacheFingerprintSet(
  value: unknown,
): value is LevelQualityReviewCacheFingerprintSet {
  return validateLevelQualityReviewCacheFingerprintSet(value).valid;
}

function fingerprintsFrom(
  value: LevelQualityReviewCacheFingerprint | LevelQualityReviewCacheFingerprint[] | LevelQualityReviewCacheFingerprintSet,
): LevelQualityReviewCacheFingerprint[] {
  if (Array.isArray(value)) {
    return value;
  }
  if ("fingerprints" in value) {
    return value.fingerprints;
  }

  return [value];
}

function countBy<T extends string>(
  values: readonly LevelQualityReviewCacheFingerprint[],
  keyFn: (value: LevelQualityReviewCacheFingerprint) => T,
): Partial<Record<T, number>> {
  const counts = new Map<T, number>();
  for (const value of values) {
    const key = keyFn(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) as Partial<Record<T, number>>;
}

export function summarizeLevelQualityReviewCacheFingerprints(
  value: LevelQualityReviewCacheFingerprint | LevelQualityReviewCacheFingerprint[] | LevelQualityReviewCacheFingerprintSet,
): LevelQualityReviewCacheFingerprintSummary {
  const fingerprints = fingerprintsFrom(value);
  const symbols = [...new Set(fingerprints.map((fingerprint) => fingerprint.symbol))].sort();
  const firstTimestamps = fingerprints
    .map((fingerprint) => fingerprint.firstCandleTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  const lastTimestamps = fingerprints
    .map((fingerprint) => fingerprint.lastCandleTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  const validationIssueCount = fingerprints.reduce(
    (sum, fingerprint) => sum + fingerprint.validationIssueCount,
    0,
  );
  const summary: LevelQualityReviewCacheFingerprintSummary = {
    totalFingerprints: fingerprints.length,
    symbolCount: symbols.length,
    symbols,
    providerCounts: countBy(fingerprints, (fingerprint) => fingerprint.provider),
    timeframeCounts: countBy(fingerprints, (fingerprint) => fingerprint.timeframe),
    levelEngineInputCount: fingerprints.filter((fingerprint) => fingerprint.includedInLevelEngine === true).length,
    contextOnlyCount: fingerprints.filter((fingerprint) => fingerprint.contextOnly === true).length,
    fifteenMinuteContextOnlyCount: fingerprints.filter(
      (fingerprint) =>
        fingerprint.timeframe === "15m" &&
        fingerprint.contextOnly === true &&
        fingerprint.includedInLevelEngine === false,
    ).length,
    validationIssueCount,
    wrapperCandleCount: fingerprints.reduce((sum, fingerprint) => sum + fingerprint.wrapperCandleCount, 0),
    actualBarsReturned: fingerprints.reduce((sum, fingerprint) => sum + fingerprint.actualBarsReturned, 0),
    hasValidationIssues: validationIssueCount > 0,
    ...(firstTimestamps.length > 0 ? { firstCandleTimestamp: Math.min(...firstTimestamps) } : {}),
    ...(lastTimestamps.length > 0 ? { lastCandleTimestamp: Math.max(...lastTimestamps) } : {}),
  };

  return summary;
}

export function assertLevelQualityReviewCacheFingerprintFactsOnly(
  value: unknown,
): asserts value is LevelQualityReviewCacheFingerprint | LevelQualityReviewCacheFingerprintSet {
  const fingerprintValidation = validateLevelQualityReviewCacheFingerprint(value);
  const setValidation = validateLevelQualityReviewCacheFingerprintSet(value);
  if (!fingerprintValidation.valid && !setValidation.valid) {
    throw new Error(
      `Invalid level quality review cache fingerprint: ${[
        ...fingerprintValidation.errors,
        ...setValidation.errors,
      ].join("; ")}`,
    );
  }

  const text = JSON.stringify(value);
  const hits = FACTUAL_ONLY_BLOCKED_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);

  if (hits.length > 0) {
    throw new Error(`Level quality review cache fingerprint contains non-factual wording: ${hits.join(", ")}`);
  }
}
