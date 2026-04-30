import type {
  MonitoringEventDiagnostic,
  MonitoringEventDiagnosticListener,
} from "./monitoring-types.js";

type MonitoringEventDiagnosticLoggerOptions = {
  suppressionCooldownMs?: number;
  maxSuppressedNearestDistancePct?: number;
  writer?: (line: string) => void;
};

type SuppressedDiagnosticSnapshot = {
  signature: string;
  loggedAt: number;
};

const DEFAULT_SUPPRESSION_COOLDOWN_MS = 15_000;
const DEFAULT_MAX_SUPPRESSED_NEAREST_DISTANCE_PCT = 0.01;

function buildDiagnosticKey(diagnostic: MonitoringEventDiagnostic): string {
  return [
    diagnostic.symbol,
    diagnostic.zoneId,
    diagnostic.eventType,
    diagnostic.decision,
  ].join("|");
}

function buildSuppressedSignature(diagnostic: MonitoringEventDiagnostic): string {
  return JSON.stringify({
    reasons: diagnostic.reasons,
    phaseBefore: diagnostic.phaseBefore,
    phaseAfter: diagnostic.phaseAfter,
    updatesNearZone: diagnostic.updatesNearZone,
    breakAttemptAgeMs: diagnostic.breakAttemptAgeMs,
  });
}

function hasMeaningfulContext(diagnostic: MonitoringEventDiagnostic): boolean {
  return (
    diagnostic.updatesNearZone > 0 ||
    diagnostic.phaseBefore !== "idle" ||
    diagnostic.phaseAfter !== "idle" ||
    diagnostic.breakAttemptAgeMs !== null
  );
}

function isNearDecisionBoundary(
  diagnostic: MonitoringEventDiagnostic,
  maxSuppressedNearestDistancePct: number,
): boolean {
  return diagnostic.nearestDistancePct <= maxSuppressedNearestDistancePct;
}

function shouldLogSuppressedDiagnostic(
  diagnostic: MonitoringEventDiagnostic,
  previous: SuppressedDiagnosticSnapshot | undefined,
  options: Required<Omit<MonitoringEventDiagnosticLoggerOptions, "writer">>,
): boolean {
  const interesting =
    hasMeaningfulContext(diagnostic) ||
    isNearDecisionBoundary(
      diagnostic,
      options.maxSuppressedNearestDistancePct,
    );

  if (!interesting) {
    return false;
  }

  const signature = buildSuppressedSignature(diagnostic);
  if (!previous) {
    return true;
  }

  if (previous.signature !== signature) {
    return true;
  }

  return (
    diagnostic.timestamp - previous.loggedAt >= options.suppressionCooldownMs
  );
}

export function createMonitoringEventDiagnosticListener(
  options: MonitoringEventDiagnosticLoggerOptions = {},
): MonitoringEventDiagnosticListener {
  const suppressedSnapshots = new Map<string, SuppressedDiagnosticSnapshot>();
  const writer = options.writer ?? ((line: string) => console.log(line));
  const normalizedOptions = {
    suppressionCooldownMs:
      options.suppressionCooldownMs ?? DEFAULT_SUPPRESSION_COOLDOWN_MS,
    maxSuppressedNearestDistancePct:
      options.maxSuppressedNearestDistancePct ??
      DEFAULT_MAX_SUPPRESSED_NEAREST_DISTANCE_PCT,
  };

  return (diagnostic) => {
    if (diagnostic.decision === "emitted") {
      writer(JSON.stringify(diagnostic));
      return;
    }

    const key = buildDiagnosticKey(diagnostic);
    const previous = suppressedSnapshots.get(key);
    if (
      !shouldLogSuppressedDiagnostic(
        diagnostic,
        previous,
        normalizedOptions,
      )
    ) {
      return;
    }

    suppressedSnapshots.set(key, {
      signature: buildSuppressedSignature(diagnostic),
      loggedAt: diagnostic.timestamp,
    });
    writer(JSON.stringify(diagnostic));
  };
}
