export type LevelQualityDiagnosticCategory =
  | "coverage"
  | "density"
  | "enrichment"
  | "synthetic"
  | "freshness"
  | "context"
  | "safety";

export type LevelQualityDiagnosticSeverity = "info" | "watch" | "review";

export type LevelQualityDiagnosticDescription = {
  code: string;
  category: LevelQualityDiagnosticCategory;
  severity: LevelQualityDiagnosticSeverity;
  label: string;
  description: string;
  factualOnly: true;
};

export const LEVEL_QUALITY_AUDIT_DIAGNOSTIC_LABELS = {
  level_intelligence_report_missing: {
    category: "context",
    severity: "review",
    label: "Level intelligence report missing",
    description: "The audit did not receive LevelIntelligenceReport context for enriched level explanations.",
  },
  reference_price_missing: {
    category: "context",
    severity: "review",
    label: "Reference price missing",
    description: "The audit could not compute nearest-level distances because no reference price was supplied.",
  },
  no_support_below_reference: {
    category: "coverage",
    severity: "review",
    label: "No support below reference",
    description: "The audited level map has no support level below the supplied reference price.",
  },
  no_resistance_above_reference: {
    category: "coverage",
    severity: "review",
    label: "No resistance above reference",
    description: "The audited level map has no resistance level above the supplied reference price.",
  },
  wide_downside_support_gap: {
    category: "coverage",
    severity: "watch",
    label: "Wide nearest support gap",
    description: "The nearest support below reference is outside the configured nearby coverage threshold.",
  },
  wide_overhead_resistance_gap: {
    category: "coverage",
    severity: "watch",
    label: "Wide nearest resistance gap",
    description: "The nearest resistance above reference is outside the configured nearby coverage threshold.",
  },
  no_support_extension_coverage: {
    category: "coverage",
    severity: "review",
    label: "No support extension coverage",
    description: "The extension ladder contains no support extension rows for the audited snapshot.",
  },
  no_resistance_extension_coverage: {
    category: "coverage",
    severity: "review",
    label: "No resistance extension coverage",
    description: "The extension ladder contains no resistance extension rows for the audited snapshot.",
  },
  limited_downside_extension_coverage: {
    category: "coverage",
    severity: "watch",
    label: "Limited downside extension coverage",
    description: "The lowest support extension does not reach the configured downside coverage threshold.",
  },
  limited_upside_extension_coverage: {
    category: "coverage",
    severity: "watch",
    label: "Limited upside extension coverage",
    description: "The highest resistance extension does not reach the configured upside coverage threshold.",
  },
  clustered_level_areas_present: {
    category: "density",
    severity: "watch",
    label: "Clustered level areas present",
    description: "Multiple audited levels sit within the configured cluster distance threshold.",
  },
  levels_without_context_present: {
    category: "context",
    severity: "watch",
    label: "Levels without nearby context present",
    description: "At least one audited level has no attached session, volume, shelf, or market context facts.",
  },
  unenriched_levels_present: {
    category: "enrichment",
    severity: "watch",
    label: "General enrichment coverage gap present",
    description: "At least one audited level is missing enrichedAnalysis metadata; this broad diagnostic remains for compatibility.",
  },
  unenriched_historical_levels_present: {
    category: "enrichment",
    severity: "watch",
    label: "Historical enrichment coverage gap present",
    description: "At least one historical support or resistance level is missing enrichedAnalysis metadata.",
  },
  unenriched_extension_levels_present: {
    category: "enrichment",
    severity: "watch",
    label: "Extension enrichment coverage gap present",
    description: "At least one extension row is missing enrichedAnalysis metadata.",
  },
  unenriched_synthetic_levels_present: {
    category: "synthetic",
    severity: "info",
    label: "Synthetic continuation-map enrichment gap present",
    description: "At least one marked synthetic continuation-map row is missing enrichedAnalysis metadata; it remains forward-planning context, not historical evidence.",
  },
  session_facts_missing: {
    category: "context",
    severity: "info",
    label: "Session facts missing",
    description: "No session facts were supplied for this level context profile.",
  },
  volume_facts_missing: {
    category: "context",
    severity: "info",
    label: "Volume facts missing",
    description: "No volume facts were supplied for this level context profile.",
  },
  enriched_analysis_missing: {
    category: "enrichment",
    severity: "watch",
    label: "Enriched analysis missing",
    description: "The level does not include enrichedAnalysis metadata.",
  },
  no_nearby_volume_shelf: {
    category: "context",
    severity: "info",
    label: "No nearby volume shelf",
    description: "No supplied volume shelf overlaps or sits near this level.",
  },
} as const satisfies Record<string, Omit<LevelQualityDiagnosticDescription, "code" | "factualOnly">>;

export function describeLevelQualityDiagnostic(code: string): LevelQualityDiagnosticDescription {
  const known = LEVEL_QUALITY_AUDIT_DIAGNOSTIC_LABELS[code as keyof typeof LEVEL_QUALITY_AUDIT_DIAGNOSTIC_LABELS];

  if (known) {
    return {
      code,
      ...known,
      factualOnly: true,
    };
  }

  return {
    code,
    category: "context",
    severity: "info",
    label: "Uncataloged audit diagnostic",
    description: `Diagnostic code ${code} is not in the normalized wording catalog; treat it as factual audit context only.`,
    factualOnly: true,
  };
}

export function classifyLevelQualityDiagnostic(code: string): LevelQualityDiagnosticCategory {
  return describeLevelQualityDiagnostic(code).category;
}

export function isLevelQualityDiagnosticFactualOnly(code: string): boolean {
  return describeLevelQualityDiagnostic(code).factualOnly;
}
