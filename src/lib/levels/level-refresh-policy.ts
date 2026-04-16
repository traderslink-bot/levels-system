import type { LevelEngineOutput } from "./level-types.js";

export type LevelRefreshReason =
  | "missing_levels"
  | "stale_output"
  | "aging_output"
  | "new_session";

export type LevelRefreshDecision = {
  shouldRefresh: boolean;
  reasons: LevelRefreshReason[];
};

function getTradingDateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function decideLevelRefresh(params: {
  output?: LevelEngineOutput;
  referenceTimestamp: number;
}): LevelRefreshDecision {
  if (!params.output) {
    return {
      shouldRefresh: true,
      reasons: ["missing_levels"],
    };
  }

  const reasons: LevelRefreshReason[] = [];
  const ageMs = params.referenceTimestamp - params.output.generatedAt;

  if (params.output.metadata.freshness === "stale") {
    reasons.push("stale_output");
  } else if (params.output.metadata.freshness === "aging" || ageMs > 6 * 60 * 60 * 1000) {
    reasons.push("aging_output");
  }

  if (getTradingDateKey(params.referenceTimestamp) !== getTradingDateKey(params.output.generatedAt)) {
    reasons.push("new_session");
  }

  return {
    shouldRefresh: reasons.length > 0,
    reasons,
  };
}
