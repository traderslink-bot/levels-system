import assert from "node:assert/strict";
import test from "node:test";

import { createMonitoringEventDiagnosticListener } from "../lib/monitoring/monitoring-event-diagnostic-logger.js";
import type { MonitoringEventDiagnostic } from "../lib/monitoring/monitoring-types.js";

function buildDiagnostic(
  overrides: Partial<MonitoringEventDiagnostic> = {},
): MonitoringEventDiagnostic {
  return {
    type: "monitoring_event_diagnostic",
    symbol: "ASBP",
    zoneId: "ASBP-resistance-monitored-1",
    zoneKind: "resistance",
    eventType: "breakout",
    decision: "suppressed",
    reasons: ["missing_prior_interaction_backfill"],
    timestamp: 1_000,
    triggerPrice: 0.2253,
    previousPrice: 0.2253,
    phaseBefore: "idle",
    phaseAfter: "idle",
    updatesNearZone: 0,
    nearestDistancePct: 0.02,
    breakAttemptAgeMs: null,
    metrics: {
      breakoutDistancePct: 0.0029,
      forcefulBreakout: false,
    },
    ...overrides,
  };
}

test("monitoring event diagnostic logger always logs emitted events", () => {
  const lines: string[] = [];
  const listener = createMonitoringEventDiagnosticListener({
    writer: (line) => lines.push(line),
  });

  listener(buildDiagnostic({
    decision: "emitted",
    reasons: ["confirmed_breakout_emitted"],
  }));

  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /"decision":"emitted"/);
});

test("monitoring event diagnostic logger suppresses far idle repeats", () => {
  const lines: string[] = [];
  const listener = createMonitoringEventDiagnosticListener({
    writer: (line) => lines.push(line),
  });

  listener(buildDiagnostic({
    nearestDistancePct: 0.04,
    reasons: ["price_not_above_zone", "missing_prior_interaction_backfill"],
  }));
  listener(buildDiagnostic({
    timestamp: 2_000,
    nearestDistancePct: 0.04,
    reasons: ["price_not_above_zone", "missing_prior_interaction_backfill"],
  }));

  assert.equal(lines.length, 0);
});

test("monitoring event diagnostic logger logs near-boundary suppressions and dedupes repeats", () => {
  const lines: string[] = [];
  const listener = createMonitoringEventDiagnosticListener({
    writer: (line) => lines.push(line),
    suppressionCooldownMs: 15_000,
  });

  listener(buildDiagnostic({
    nearestDistancePct: 0.004,
    reasons: ["missing_prior_interaction_backfill"],
  }));
  listener(buildDiagnostic({
    timestamp: 2_000,
    nearestDistancePct: 0.004,
    reasons: ["missing_prior_interaction_backfill"],
  }));
  listener(buildDiagnostic({
    timestamp: 3_000,
    nearestDistancePct: 0.004,
    reasons: ["filtered_by_event_relevance_rules"],
  }));

  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /missing_prior_interaction_backfill/);
  assert.match(lines[1] ?? "", /filtered_by_event_relevance_rules/);
});

test("monitoring event diagnostic logger logs repeated suppressions again after cooldown", () => {
  const lines: string[] = [];
  const listener = createMonitoringEventDiagnosticListener({
    writer: (line) => lines.push(line),
    suppressionCooldownMs: 5_000,
  });

  listener(buildDiagnostic({
    nearestDistancePct: 0.004,
    reasons: ["missing_prior_interaction_backfill"],
    timestamp: 1_000,
  }));
  listener(buildDiagnostic({
    nearestDistancePct: 0.004,
    reasons: ["missing_prior_interaction_backfill"],
    timestamp: 7_000,
  }));

  assert.equal(lines.length, 2);
});
