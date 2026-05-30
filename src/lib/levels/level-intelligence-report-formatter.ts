import type { LevelIntelligenceProfile } from "./level-intelligence-profile.js";
import type { LevelIntelligenceReport } from "./level-intelligence-report.js";

export type FormattedLevelIntelligenceReportSection = {
  title: string;
  lines: string[];
};

export type FormattedLevelIntelligenceReport = {
  symbol: string;
  generatedAt: number;
  summary: string;
  sections: FormattedLevelIntelligenceReportSection[];
  diagnostics: string[];
  safety: LevelIntelligenceReport["safety"];
};

type BucketSpec = {
  title: string;
  profiles: LevelIntelligenceProfile[];
};

const FORBIDDEN_PATTERNS = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bgood trade\b/i,
  /\bbad trade\b/i,
  /\bmistake\b/i,
  /\bcoaching\b/i,
  /\bentry\b/i,
  /\bexit\b/i,
  /\bstop loss\b/i,
  /\btarget\b/i,
  /\btake profit\b/i,
  /\badd\b/i,
  /\btrim\b/i,
  /\bsize\b/i,
];

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : Number(value.toFixed(4)).toString();
}

function formatLabel(value: string): string {
  if (value === "not_historical_support_resistance") {
    return "not historical support/resistance";
  }

  return value.replaceAll("_", " ");
}

function isAllowedLine(line: string): boolean {
  return !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(line));
}

function pushAllowed(lines: string[], line: string): void {
  if (isAllowedLine(line)) {
    lines.push(line);
  }
}

function joinAllowed(values: string[]): string {
  return values.filter(isAllowedLine).join(" | ");
}

function addValueGroup(lines: string[], label: string, values: string[]): void {
  const joined = joinAllowed(values);
  if (joined.length > 0) {
    lines.push(`${label}: ${joined}`);
  }
}

function formatCountSummary(report: LevelIntelligenceReport): string {
  const counts = report.counts;

  return [
    `major support ${counts.majorSupport}`,
    `major resistance ${counts.majorResistance}`,
    `intermediate support ${counts.intermediateSupport}`,
    `intermediate resistance ${counts.intermediateResistance}`,
    `intraday support ${counts.intradaySupport}`,
    `intraday resistance ${counts.intradayResistance}`,
    `extension support ${counts.extensionSupport}`,
    `extension resistance ${counts.extensionResistance}`,
  ].join(", ");
}

function bucketSpecs(report: LevelIntelligenceReport): BucketSpec[] {
  return [
    { title: "Major Support", profiles: report.buckets.majorSupport },
    { title: "Major Resistance", profiles: report.buckets.majorResistance },
    { title: "Intermediate Support", profiles: report.buckets.intermediateSupport },
    { title: "Intermediate Resistance", profiles: report.buckets.intermediateResistance },
    { title: "Intraday Support", profiles: report.buckets.intradaySupport },
    { title: "Intraday Resistance", profiles: report.buckets.intradayResistance },
    { title: "Extension Support", profiles: report.buckets.extensionSupport },
    { title: "Extension Resistance", profiles: report.buckets.extensionResistance },
  ];
}

function formatProfile(profile: LevelIntelligenceProfile): string[] {
  const lines: string[] = [];
  const extension = profile.extension ??
    (profile.origin.isExtension
      ? {
          isSyntheticContinuationMap: false,
          generationMethod: undefined,
          evidenceLimitations: [],
        }
      : undefined);

  pushAllowed(
    lines,
    `${profile.kind} zone ${formatNumber(profile.representativePrice)} (${profile.levelId})`,
  );
  pushAllowed(lines, `Zone: ${formatNumber(profile.zoneLow)}-${formatNumber(profile.zoneHigh)} (${formatNumber(profile.zoneWidthPercent)}% wide)`);
  pushAllowed(
    lines,
    `Origin: ${profile.origin.primaryTimeframe}; sources ${profile.origin.timeframeSources.join(", ") || "unknown"}; types ${profile.origin.sourceTypes.join(", ") || "unknown"}; extension ${profile.origin.isExtension}`,
  );
  if (extension) {
    if (extension.isSyntheticContinuationMap) {
      pushAllowed(
        lines,
        "Extension source: Synthetic continuation map; forward-planning extension; not historical support/resistance; limited evidence/no historical touches.",
      );
    } else {
      pushAllowed(lines, "Extension source: Historical candidate extension.");
    }
    if (extension.generationMethod) {
      pushAllowed(lines, `Extension generation: ${formatLabel(extension.generationMethod)}`);
    }
    if (extension.evidenceLimitations.length > 0) {
      pushAllowed(
        lines,
        `Extension evidence limits: ${extension.evidenceLimitations.map(formatLabel).join("; ")}`,
      );
    }
  }
  pushAllowed(
    lines,
    `Freshness: ${profile.freshness.label}${profile.freshness.state ? `; state ${profile.freshness.state}` : ""}`,
  );
  pushAllowed(
    lines,
    `Reaction: touches ${profile.reaction.touchCount}; quality ${formatNumber(profile.reaction.reactionQualityScore)}; rejection ${formatNumber(profile.reaction.rejectionScore)}; displacement ${formatNumber(profile.reaction.displacementScore)}; follow-through ${formatNumber(profile.reaction.followThroughScore)}`,
  );

  if (profile.reaction.meaningfulTouchCount !== undefined) {
    pushAllowed(lines, `Meaningful touches: ${profile.reaction.meaningfulTouchCount}`);
  }
  if (profile.reaction.averageReactionMovePct !== undefined || profile.reaction.strongestReactionMovePct !== undefined) {
    const average = profile.reaction.averageReactionMovePct ?? 0;
    const strongest = profile.reaction.strongestReactionMovePct ?? 0;
    pushAllowed(lines, `Reaction movement facts: average ${formatNumber(average)}%; strongest ${formatNumber(strongest)}%`);
  }
  if (profile.distance) {
    pushAllowed(
      lines,
      `Distance: ${formatNumber(profile.distance.distanceFromReferencePct)}% from reference ${formatNumber(profile.distance.referencePrice)} (${profile.distance.category})`,
    );
  }
  if (profile.volume) {
    pushAllowed(
      lines,
      `Volume facts: state ${profile.volume.volumeState}; relative ${profile.volume.relativeVolume ?? "unknown"}; dollar ${profile.volume.dollarVolume ?? "unknown"}; liquidity ${profile.volume.liquidityQuality}; acceleration ${profile.volume.accelerationState}`,
    );
    pushAllowed(
      lines,
      `Volume behavior facts: pullback ${profile.volume.pullbackVolumeState}; breakout ${profile.volume.breakoutVolumeState}; nearby shelf ids ${profile.volume.nearbyShelfIds.join(", ") || "none"}`,
    );
  }
  if (profile.confluence.nearRoundNumber) {
    pushAllowed(
      lines,
      `Round number fact: ${formatNumber(profile.confluence.nearRoundNumber.value)} (${profile.confluence.nearRoundNumber.type}, ${formatNumber(profile.confluence.nearRoundNumber.distancePct)}% away)`,
    );
  }
  if (profile.marketContext) {
    pushAllowed(
      lines,
      `Market context facts: ${profile.marketContext.primaryContext}; runner phase ${profile.marketContext.runnerPhase}; confidence ${formatNumber(profile.marketContext.confidence)}`,
    );
  }
  if (profile.confidence !== undefined) {
    pushAllowed(lines, `Profile confidence fact: ${formatNumber(profile.confidence)}`);
  }

  addValueGroup(lines, "Session facts", profile.confluence.nearSessionFacts);
  addValueGroup(lines, "Volume facts nearby", profile.confluence.nearVolumeFacts);
  addValueGroup(lines, "Shelf facts", profile.confluence.nearShelfFacts);
  addValueGroup(lines, "Context tags", profile.confluence.contextTags);
  addValueGroup(lines, "Diagnostics", profile.diagnostics);
  pushAllowed(lines, `Reason: ${profile.reason}`);

  return lines;
}

function formatDiagnosticsSection(report: LevelIntelligenceReport): FormattedLevelIntelligenceReportSection {
  return {
    title: "Diagnostics",
    lines: report.diagnostics.length > 0 ? report.diagnostics.filter(isAllowedLine) : ["none"],
  };
}

function formatSafetySection(report: LevelIntelligenceReport): FormattedLevelIntelligenceReportSection {
  return {
    title: "Safety",
    lines: [
      `Level output unchanged: ${report.safety.levelOutputUnchanged}`,
      `Facts-only report: ${report.safety.factsOnly}`,
      `VWAP facts-only: ${report.safety.vwapFactsOnly}`,
      `Volume shelves facts-only: ${report.safety.shelvesAreFactsOnly}`,
      `No runtime behavior change: ${report.safety.noRuntimeBehaviorChange}`,
    ],
  };
}

export function formatLevelIntelligenceReport(
  report: LevelIntelligenceReport,
): FormattedLevelIntelligenceReport {
  const sections: FormattedLevelIntelligenceReportSection[] = [
    {
      title: "Summary",
      lines: [
        `Symbol: ${report.symbol}`,
        `Generated at: ${report.generatedAt}`,
        `Profiled levels: ${report.counts.total}`,
        `Counts: ${formatCountSummary(report)}`,
      ],
    },
  ];

  for (const spec of bucketSpecs(report)) {
    if (spec.profiles.length === 0) {
      continue;
    }

    sections.push({
      title: spec.title,
      lines: spec.profiles.flatMap(formatProfile),
    });
  }

  sections.push(formatDiagnosticsSection(report));
  sections.push(formatSafetySection(report));

  return {
    symbol: report.symbol,
    generatedAt: report.generatedAt,
    summary: `${report.symbol} facts-only level intelligence: ${report.counts.total} profiled level(s).`,
    sections,
    diagnostics: report.diagnostics.filter(isAllowedLine),
    safety: report.safety,
  };
}
