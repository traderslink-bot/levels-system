import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

export type LevelQualityAuditFindingSeverity = "info" | "watch" | "action";

export type LevelQualityAuditFinding = {
  severity: LevelQualityAuditFindingSeverity;
  side: "support" | "resistance";
  code:
    | "no_forward_levels"
    | "wide_first_gap"
    | "wide_internal_gap"
    | "thin_forward_ladder"
    | "extension_only_forward_ladder"
    | "healthy_forward_ladder";
  message: string;
  evidence: Record<string, unknown>;
};

export type LevelQualityAuditReport = {
  symbol: string;
  referencePrice: number | null;
  generatedAt: number;
  dataQualityFlags: string[];
  support: {
    displayedCount: number;
    extensionCount: number;
    nearestLevel: number | null;
    nearestDistancePct: number | null;
  };
  resistance: {
    displayedCount: number;
    extensionCount: number;
    nearestLevel: number | null;
    nearestDistancePct: number | null;
  };
  findings: LevelQualityAuditFinding[];
};

function allSupportZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
  ];
}

function allResistanceZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
  ];
}

function uniqueSortedZones(zones: FinalLevelZone[], direction: "asc" | "desc"): FinalLevelZone[] {
  const seen = new Set<string>();
  const unique: FinalLevelZone[] = [];
  for (const zone of zones) {
    const key = zone.representativePrice.toFixed(zone.representativePrice >= 1 ? 2 : 4);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(zone);
  }
  return unique.sort((left, right) =>
    direction === "asc"
      ? left.representativePrice - right.representativePrice
      : right.representativePrice - left.representativePrice,
  );
}

function pctDistance(from: number, to: number): number {
  return (Math.abs(to - from) / from) * 100;
}

function rounded(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function summarizeSide(params: {
  side: "support" | "resistance";
  referencePrice: number | null;
  displayedZones: FinalLevelZone[];
  extensionZones: FinalLevelZone[];
}): LevelQualityAuditReport["support"] {
  if (params.referencePrice === null || params.referencePrice <= 0) {
    return {
      displayedCount: params.displayedZones.length,
      extensionCount: params.extensionZones.length,
      nearestLevel: null,
      nearestDistancePct: null,
    };
  }

  const referencePrice = params.referencePrice;
  const forwardZones = params.side === "resistance"
    ? params.displayedZones.filter((zone) => zone.representativePrice > referencePrice)
    : params.displayedZones.filter((zone) => zone.representativePrice < referencePrice);
  const sorted = uniqueSortedZones(forwardZones, params.side === "resistance" ? "asc" : "desc");
  const nearest = sorted[0]?.representativePrice ?? null;
  return {
    displayedCount: params.displayedZones.length,
    extensionCount: params.extensionZones.length,
    nearestLevel: nearest,
    nearestDistancePct: nearest === null ? null : rounded(pctDistance(referencePrice, nearest)),
  };
}

function buildSideFindings(params: {
  side: "support" | "resistance";
  referencePrice: number | null;
  displayedZones: FinalLevelZone[];
  extensionZones: FinalLevelZone[];
}): LevelQualityAuditFinding[] {
  if (params.referencePrice === null || params.referencePrice <= 0) {
    return [];
  }

  const referencePrice = params.referencePrice;
  const forwardDisplayed = params.side === "resistance"
    ? params.displayedZones.filter((zone) => zone.representativePrice > referencePrice)
    : params.displayedZones.filter((zone) => zone.representativePrice < referencePrice);
  const forwardExtensions = params.side === "resistance"
    ? params.extensionZones.filter((zone) => zone.representativePrice > referencePrice)
    : params.extensionZones.filter((zone) => zone.representativePrice < referencePrice);
  const sortedForward = uniqueSortedZones(
    [...forwardDisplayed, ...forwardExtensions],
    params.side === "resistance" ? "asc" : "desc",
  );
  const first = sortedForward[0] ?? null;
  const firstDistance = first ? pctDistance(referencePrice, first.representativePrice) : null;
  const sideLabel = params.side === "resistance" ? "overhead resistance" : "downside support";

  if (!first) {
    return [{
      severity: "action",
      side: params.side,
      code: "no_forward_levels",
      message: `No ${sideLabel} is available beyond the reference price.`,
      evidence: {
        referencePrice: params.referencePrice,
        displayedCount: params.displayedZones.length,
        extensionCount: params.extensionZones.length,
      },
    }];
  }

  const findings: LevelQualityAuditFinding[] = [];
  if (firstDistance !== null && firstDistance >= 25) {
    findings.push({
      severity: "action",
      side: params.side,
      code: "wide_first_gap",
      message: `Nearest ${sideLabel} is ${rounded(firstDistance)}% away; verify older daily levels were not missed.`,
      evidence: {
        referencePrice: params.referencePrice,
        nearestLevel: first.representativePrice,
        nearestDistancePct: rounded(firstDistance),
        timeframeSources: first.timeframeSources,
        sourceTypes: first.sourceTypes,
      },
    });
  } else if (firstDistance !== null && firstDistance >= 15) {
    findings.push({
      severity: "watch",
      side: params.side,
      code: "wide_first_gap",
      message: `Nearest ${sideLabel} is ${rounded(firstDistance)}% away; review if the chart has obvious intermediate pivots.`,
      evidence: {
        referencePrice: params.referencePrice,
        nearestLevel: first.representativePrice,
        nearestDistancePct: rounded(firstDistance),
      },
    });
  }

  if (sortedForward.length < 3) {
    findings.push({
      severity: "watch",
      side: params.side,
      code: "thin_forward_ladder",
      message: `Only ${sortedForward.length} forward ${params.side} level(s) are available.`,
      evidence: {
        referencePrice: params.referencePrice,
        forwardLevels: sortedForward.map((zone) => zone.representativePrice),
      },
    });
  }

  const internalGaps = sortedForward
    .slice(1)
    .map((zone, index) => {
      const previous = sortedForward[index]!;
      return {
        fromLevel: previous.representativePrice,
        toLevel: zone.representativePrice,
        gapPct: pctDistance(previous.representativePrice, zone.representativePrice),
      };
    })
    .filter((gap) => gap.gapPct >= 18);

  if (internalGaps.length > 0) {
    const widestGap = [...internalGaps].sort((left, right) => right.gapPct - left.gapPct)[0]!;
    findings.push({
      severity: widestGap.gapPct >= 25 ? "action" : "watch",
      side: params.side,
      code: "wide_internal_gap",
      message: `Forward ${params.side} ladder has a ${rounded(widestGap.gapPct)}% gap between visible levels; verify intermediate daily or 4h structure was not missed.`,
      evidence: {
        referencePrice: params.referencePrice,
        forwardLevels: sortedForward.map((zone) => zone.representativePrice),
        gaps: internalGaps.map((gap) => ({
          fromLevel: gap.fromLevel,
          toLevel: gap.toLevel,
          gapPct: rounded(gap.gapPct),
        })),
      },
    });
  }

  if (forwardDisplayed.length === 0 && forwardExtensions.length > 0) {
    findings.push({
      severity: "watch",
      side: params.side,
      code: "extension_only_forward_ladder",
      message: `Forward ${params.side} ladder is coming only from extension levels.`,
      evidence: {
        extensionLevels: forwardExtensions.map((zone) => zone.representativePrice),
      },
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      side: params.side,
      code: "healthy_forward_ladder",
      message: `Forward ${params.side} ladder has nearby structure and enough levels for review.`,
      evidence: {
        referencePrice: params.referencePrice,
        forwardLevels: sortedForward.slice(0, 5).map((zone) => zone.representativePrice),
      },
    });
  }

  return findings;
}

export function buildLevelQualityAuditReport(output: LevelEngineOutput): LevelQualityAuditReport {
  const referencePrice = output.metadata.referencePrice ?? null;
  const displayedSupport = allSupportZones(output);
  const displayedResistance = allResistanceZones(output);
  const extensionSupport = output.extensionLevels.support;
  const extensionResistance = output.extensionLevels.resistance;

  return {
    symbol: output.symbol,
    referencePrice,
    generatedAt: output.generatedAt,
    dataQualityFlags: output.metadata.dataQualityFlags,
    support: summarizeSide({
      side: "support",
      referencePrice,
      displayedZones: displayedSupport,
      extensionZones: extensionSupport,
    }),
    resistance: summarizeSide({
      side: "resistance",
      referencePrice,
      displayedZones: displayedResistance,
      extensionZones: extensionResistance,
    }),
    findings: [
      ...buildSideFindings({
        side: "support",
        referencePrice,
        displayedZones: displayedSupport,
        extensionZones: extensionSupport,
      }),
      ...buildSideFindings({
        side: "resistance",
        referencePrice,
        displayedZones: displayedResistance,
        extensionZones: extensionResistance,
      }),
    ],
  };
}

export function formatLevelQualityAuditReport(report: LevelQualityAuditReport): string {
  const lines = [
    `LEVEL QUALITY AUDIT: ${report.symbol}`,
    `reference price: ${report.referencePrice ?? "n/a"}`,
    `data quality: ${report.dataQualityFlags.length > 0 ? report.dataQualityFlags.join(", ") : "ok"}`,
    "",
    `support: displayed ${report.support.displayedCount}, extensions ${report.support.extensionCount}, nearest ${report.support.nearestLevel ?? "n/a"} (${report.support.nearestDistancePct ?? "n/a"}%)`,
    `resistance: displayed ${report.resistance.displayedCount}, extensions ${report.resistance.extensionCount}, nearest ${report.resistance.nearestLevel ?? "n/a"} (${report.resistance.nearestDistancePct ?? "n/a"}%)`,
    "",
    "findings:",
    ...report.findings.flatMap((finding) => [
      `- ${finding.severity.toUpperCase()} ${finding.side} ${finding.code}: ${finding.message}`,
      `  evidence: ${JSON.stringify(finding.evidence)}`,
    ]),
  ];
  return lines.join("\n");
}
