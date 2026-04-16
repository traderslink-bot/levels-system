import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AdaptiveStabilityLayer,
  type AdaptiveTargetState,
} from "../lib/monitoring/adaptive-stability.js";

function makeTargetState(overrides?: Partial<AdaptiveTargetState>): AdaptiveTargetState {
  return {
    targetGlobalMultiplier: 1,
    globalSampleSize: 20,
    driftDeclining: false,
    driftDelta: 0,
    eventTypeTargets: {
      breakout: {
        eventType: "breakout",
        targetMultiplier: 1.2,
        disableIntent: false,
        disableReason: null,
        expectancy: 0.4,
        sampleSize: 20,
      },
    },
    ...overrides,
  };
}

describe("adaptive stability", () => {
  it("moves much less on low sample sizes than high sample sizes", () => {
    const lowSampleLayer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });
    const highSampleLayer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });

    const lowSample = lowSampleLayer.applyTargets(makeTargetState({
      eventTypeTargets: {
        breakout: {
          eventType: "breakout",
          targetMultiplier: 1.2,
          disableIntent: false,
          disableReason: null,
          expectancy: 0.4,
          sampleSize: 1,
        },
      },
    }));
    const highSample = highSampleLayer.applyTargets(makeTargetState());

    assert.ok(highSample.appliedEventTypeMultipliers.breakout > lowSample.appliedEventTypeMultipliers.breakout);
    assert.ok(highSample.appliedGlobalMultiplier >= lowSample.appliedGlobalMultiplier);
  });

  it("caps downward movement more tightly than upward movement", () => {
    const layer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });

    const up = layer.applyTargets(makeTargetState({
      eventTypeTargets: {
        breakout: {
          eventType: "breakout",
          targetMultiplier: 1.4,
          disableIntent: false,
          disableReason: null,
          expectancy: 0.8,
          sampleSize: 20,
        },
      },
    }));
    const down = layer.applyTargets(makeTargetState({
      eventTypeTargets: {
        breakout: {
          eventType: "breakout",
          targetMultiplier: 0.4,
          disableIntent: false,
          disableReason: null,
          expectancy: -0.8,
          sampleSize: 20,
        },
      },
    }));

    assert.ok(up.diagnostics.eventTypeDiagnostics.breakout!.deltaApplied > 0);
    assert.ok(Math.abs(down.diagnostics.eventTypeDiagnostics.breakout!.deltaApplied) <= 0.05);
  });

  it("protects weak signals from immediate disable and enforces a floor", () => {
    const layer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });

    const result = layer.applyTargets(makeTargetState({
      eventTypeTargets: {
        breakout: {
          eventType: "breakout",
          targetMultiplier: 0.4,
          disableIntent: true,
          disableReason: "negative_expectancy",
          expectancy: -0.4,
          sampleSize: 20,
        },
      },
    }));

    assert.equal(result.disabledEventTypes.breakout?.disabled, false);
    assert.ok(result.appliedEventTypeMultipliers.breakout >= 0.72);
    assert.equal(result.diagnostics.eventTypeDiagnostics.breakout?.disableProtected, true);
  });

  it("disables only after sustained weak updates with enough samples and can recover later", () => {
    const layer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });
    let result = makeTargetState({
      eventTypeTargets: {
        breakout: {
          eventType: "breakout",
          targetMultiplier: 0.4,
          disableIntent: true,
          disableReason: "negative_expectancy",
          expectancy: -0.5,
          sampleSize: 20,
        },
      },
    });

    layer.applyTargets(result);
    layer.applyTargets(result);
    const disabled = layer.applyTargets(result);
    const recovered = layer.applyTargets(makeTargetState({
      eventTypeTargets: {
        breakout: {
          eventType: "breakout",
          targetMultiplier: 1.1,
          disableIntent: false,
          disableReason: null,
          expectancy: 0.2,
          sampleSize: 20,
        },
      },
    }));

    assert.equal(disabled.disabledEventTypes.breakout?.disabled, true);
    assert.equal(recovered.disabledEventTypes.breakout?.disabled, false);
    assert.equal(recovered.state.eventTypes.breakout?.weakUpdateStreak, 0);
  });

  it("dampens movement when drift is declining", () => {
    const calmLayer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });
    const driftLayer = new AdaptiveStabilityLayer({ minMultiplier: 0.4, maxMultiplier: 1.4 });

    const calm = calmLayer.applyTargets(makeTargetState({
      targetGlobalMultiplier: 1.2,
    }));
    const drift = driftLayer.applyTargets(makeTargetState({
      targetGlobalMultiplier: 1.2,
      driftDeclining: true,
      driftDelta: -0.2,
    }));

    assert.ok(calm.appliedGlobalMultiplier > drift.appliedGlobalMultiplier);
    assert.equal(drift.diagnostics.driftDampeningActive, true);
  });
});
