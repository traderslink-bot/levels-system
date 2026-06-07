export type JournalTradeContextOneMinuteExecutionWindowRequest = {
  symbol: string;
  timeframe: "1m";
  lookbackBars: number;
  startTimeMs: number;
  endTimeMs: number;
};

export type JournalTradeContextOneMinuteExecutionWindowPolicy = {
  symbol: string;
  timeframe: "1m";
  firstExecutionTimestamp: number;
  finalExecutionTimestamp: number;
  request: JournalTradeContextOneMinuteExecutionWindowRequest;
  window: {
    preExecutionBufferMinutes: number;
    postExecutionBufferMinutes: number;
    startTimestamp: number;
    endTimestamp: number;
    expectedBarCount: number;
  };
  cacheIdentity: {
    scope: "symbol_execution_window";
    key: string;
  };
  priority: "optional_execution_detail";
  safety: {
    optionalExecutionReplayOnly: true;
    fiveMinuteDayContextRemainsPrimary: true;
    notFullDayByDefault: true;
    notLevelEngineEligible: true;
    noLevelEngineBehaviorChange: true;
    noTradeAdvice: true;
  };
};

export type BuildJournalTradeContextOneMinuteExecutionWindowPolicyInput = {
  symbol: string;
  firstExecutionTimestamp: number;
  finalExecutionTimestamp?: number;
  preExecutionBufferMinutes?: number;
  postExecutionBufferMinutes?: number;
};

const ONE_MINUTE_MS = 60 * 1000;
const DEFAULT_PRE_EXECUTION_BUFFER_MINUTES = 30;
const DEFAULT_POST_EXECUTION_BUFFER_MINUTES = 30;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;

function assertFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive epoch-millisecond timestamp.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new Error(`Invalid symbol "${symbol}". Symbols must be explicit ticker-like values.`);
  }

  return normalized;
}

function floorToMinute(timestamp: number): number {
  return Math.floor(timestamp / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

function ceilToMinute(timestamp: number): number {
  return Math.ceil(timestamp / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

function buildCacheKey(input: {
  symbol: string;
  startTimestamp: number;
  endTimestamp: number;
  preExecutionBufferMinutes: number;
  postExecutionBufferMinutes: number;
}): string {
  return [
    input.symbol,
    "1m",
    input.startTimestamp,
    input.endTimestamp,
    `pre${input.preExecutionBufferMinutes}`,
    `post${input.postExecutionBufferMinutes}`,
  ].join("|");
}

export function buildJournalTradeContextOneMinuteExecutionWindowPolicy(
  input: BuildJournalTradeContextOneMinuteExecutionWindowPolicyInput,
): JournalTradeContextOneMinuteExecutionWindowPolicy {
  assertFiniteTimestamp(input.firstExecutionTimestamp, "firstExecutionTimestamp");

  const symbol = normalizeSymbol(input.symbol);
  const finalExecutionTimestamp = input.finalExecutionTimestamp ?? input.firstExecutionTimestamp;
  assertFiniteTimestamp(finalExecutionTimestamp, "finalExecutionTimestamp");
  if (finalExecutionTimestamp < input.firstExecutionTimestamp) {
    throw new Error("finalExecutionTimestamp must be greater than or equal to firstExecutionTimestamp.");
  }

  const preExecutionBufferMinutes =
    input.preExecutionBufferMinutes ?? DEFAULT_PRE_EXECUTION_BUFFER_MINUTES;
  const postExecutionBufferMinutes =
    input.postExecutionBufferMinutes ?? DEFAULT_POST_EXECUTION_BUFFER_MINUTES;
  assertNonNegativeInteger(preExecutionBufferMinutes, "preExecutionBufferMinutes");
  assertNonNegativeInteger(postExecutionBufferMinutes, "postExecutionBufferMinutes");

  const startTimestamp = floorToMinute(
    input.firstExecutionTimestamp - preExecutionBufferMinutes * ONE_MINUTE_MS,
  );
  const endTimestamp = ceilToMinute(
    finalExecutionTimestamp + postExecutionBufferMinutes * ONE_MINUTE_MS,
  );
  const expectedBarCount = Math.ceil((endTimestamp - startTimestamp) / ONE_MINUTE_MS);

  return {
    symbol,
    timeframe: "1m",
    firstExecutionTimestamp: input.firstExecutionTimestamp,
    finalExecutionTimestamp,
    request: {
      symbol,
      timeframe: "1m",
      lookbackBars: expectedBarCount,
      startTimeMs: startTimestamp,
      endTimeMs: endTimestamp,
    },
    window: {
      preExecutionBufferMinutes,
      postExecutionBufferMinutes,
      startTimestamp,
      endTimestamp,
      expectedBarCount,
    },
    cacheIdentity: {
      scope: "symbol_execution_window",
      key: buildCacheKey({
        symbol,
        startTimestamp,
        endTimestamp,
        preExecutionBufferMinutes,
        postExecutionBufferMinutes,
      }),
    },
    priority: "optional_execution_detail",
    safety: {
      optionalExecutionReplayOnly: true,
      fiveMinuteDayContextRemainsPrimary: true,
      notFullDayByDefault: true,
      notLevelEngineEligible: true,
      noLevelEngineBehaviorChange: true,
      noTradeAdvice: true,
    },
  };
}
