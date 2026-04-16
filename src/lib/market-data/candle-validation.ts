import type {
  BaseCandleProviderResponse,
  Candle,
  CandleFetchCompletenessStatus,
  CandleValidationIssue,
} from "./candle-types.js";

function pushIssue(
  issues: CandleValidationIssue[],
  issue: CandleValidationIssue,
): void {
  issues.push(issue);
}

function hasInvalidOhlc(candle: Candle): boolean {
  return !(
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.volume >= 0
  );
}

export function validateCandleResponse(
  response: BaseCandleProviderResponse,
): {
  validationIssues: CandleValidationIssue[];
  completenessStatus: CandleFetchCompletenessStatus;
  stale: boolean;
} {
  const issues: CandleValidationIssue[] = [];
  const { candles, requestedLookbackBars } = response;

  if (candles.length === 0) {
    pushIssue(issues, {
      code: "zero_results",
      severity: "error",
      message: `Provider ${response.provider} returned zero candles for ${response.symbol} ${response.timeframe}.`,
    });
  }

  if (candles.length > 0 && candles.length < requestedLookbackBars) {
    pushIssue(issues, {
      code: "insufficient_bars",
      severity: "warning",
      message: `Requested ${requestedLookbackBars} bars but received ${candles.length} for ${response.symbol} ${response.timeframe}.`,
    });
  }

  const seenTimestamps = new Set<number>();
  let previousTimestamp: number | undefined;
  const expectedIntervalMs =
    response.candles.length >= 2
      ? Math.max(1, response.candles[1]!.timestamp - response.candles[0]!.timestamp)
      : response.requestedEndTimestamp - response.requestedStartTimestamp;

  for (const candle of candles) {
    if (previousTimestamp !== undefined && candle.timestamp < previousTimestamp) {
      pushIssue(issues, {
        code: "out_of_order_timestamps",
        severity: "error",
        message: `Candles are out of order for ${response.symbol} ${response.timeframe}.`,
      });
      break;
    }

    if (seenTimestamps.has(candle.timestamp)) {
      pushIssue(issues, {
        code: "duplicate_timestamps",
        severity: "error",
        message: `Duplicate candle timestamp ${candle.timestamp} detected for ${response.symbol} ${response.timeframe}.`,
      });
      break;
    }

    if (hasInvalidOhlc(candle)) {
      pushIssue(issues, {
        code: "invalid_ohlc",
        severity: "error",
        message: `Invalid OHLC values detected for ${response.symbol} ${response.timeframe} at ${candle.timestamp}.`,
      });
      break;
    }

    if (
      previousTimestamp !== undefined &&
      candle.timestamp - previousTimestamp > expectedIntervalMs * 2.5
    ) {
      pushIssue(issues, {
        code: "suspicious_gap",
        severity: "warning",
        message: `Suspicious candle gap detected for ${response.symbol} ${response.timeframe}.`,
      });
      break;
    }

    seenTimestamps.add(candle.timestamp);
    previousTimestamp = candle.timestamp;
  }

  const lastCandle = candles.at(-1);
  let stale = false;
  if (lastCandle) {
    const staleThresholdMs = expectedIntervalMs * 3;
    stale = response.requestedEndTimestamp - lastCandle.timestamp > staleThresholdMs;

    if (stale) {
      pushIssue(issues, {
        code: "stale_final_candle",
        severity: "warning",
        message: `Final candle appears stale for ${response.symbol} ${response.timeframe}.`,
      });
    }

    if (response.requestedEndTimestamp - lastCandle.timestamp > expectedIntervalMs * 1.5) {
      pushIssue(issues, {
        code: "missing_recent_candles",
        severity: "warning",
        message: `Recent candles may be missing for ${response.symbol} ${response.timeframe}.`,
      });
    }
  }

  if (
    response.sessionMetadataAvailable &&
    response.timeframe === "5m" &&
    lastCandle &&
    response.requestedEndTimestamp - lastCandle.timestamp > expectedIntervalMs
  ) {
    pushIssue(issues, {
      code: "incomplete_current_session_data",
      severity: "warning",
      message: `Current intraday session may be incomplete for ${response.symbol}.`,
    });
  }

  const completenessStatus: CandleFetchCompletenessStatus =
    candles.length === 0
      ? "empty"
      : candles.length >= requestedLookbackBars
        ? "complete"
        : "partial";

  return {
    validationIssues: issues,
    completenessStatus,
    stale,
  };
}
