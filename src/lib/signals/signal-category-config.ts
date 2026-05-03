export const SIGNAL_CATEGORY_KEYS = [
  "support_resistance",
  "pivots",
  "market_structure",
  "range_compression",
  "breakout_reclaim_quality",
  "reaction_quality",
  "volume_activity",
  "liquidity_tradability",
  "volatility_context",
  "catalyst_context",
  "session_context",
  "opening_range",
  "halt_awareness",
  "candle_meaning",
  "move_extension",
  "level_calibration",
  "data_quality",
  "trade_idea_summary",
  "pattern_context",
  "follow_through",
  "trader_commentary",
  "no_post_explainer",
  "story_memory",
  "operator_review",
] as const;

export type SignalCategoryKey = (typeof SIGNAL_CATEGORY_KEYS)[number];

export type SignalSurfaceKey =
  | "liveDiscord"
  | "operatorArtifacts"
  | "internalScoring";

export type SignalCategoryProfile =
  | "minimal"
  | "levels_only"
  | "levels_plus_structure"
  | "trader_balanced"
  | "operator_full";

export type SignalSurfaceConfig = Record<SignalSurfaceKey, boolean>;

export type SignalSurfaceMatrix = Record<SignalCategoryKey, SignalSurfaceConfig>;

function surface(
  liveDiscord: boolean,
  operatorArtifacts: boolean = true,
  internalScoring: boolean = true,
): SignalSurfaceConfig {
  return {
    liveDiscord,
    operatorArtifacts,
    internalScoring,
  };
}

function matrix(
  entries: Partial<Record<SignalCategoryKey, SignalSurfaceConfig>>,
): SignalSurfaceMatrix {
  const disabled = surface(false, false, false);
  return SIGNAL_CATEGORY_KEYS.reduce((result, key) => {
    result[key] = entries[key] ?? disabled;
    return result;
  }, {} as SignalSurfaceMatrix);
}

const PROFILE_MATRICES: Record<SignalCategoryProfile, SignalSurfaceMatrix> = {
  minimal: matrix({
    support_resistance: surface(true),
    operator_review: surface(false, true, true),
  }),
  levels_only: matrix({
    support_resistance: surface(true),
    operator_review: surface(false, true, true),
  }),
  levels_plus_structure: matrix({
    support_resistance: surface(true),
    pivots: surface(true),
    market_structure: surface(true),
    range_compression: surface(false, true, true),
    breakout_reclaim_quality: surface(true),
    reaction_quality: surface(true),
    volume_activity: surface(false, true, true),
    liquidity_tradability: surface(false, true, true),
    volatility_context: surface(false, true, true),
    catalyst_context: surface(false, true, true),
    session_context: surface(false, true, true),
    opening_range: surface(false, true, true),
    halt_awareness: surface(false, true, true),
    candle_meaning: surface(false, true, true),
    move_extension: surface(false, true, true),
    level_calibration: surface(false, true, true),
    data_quality: surface(false, true, true),
    trade_idea_summary: surface(false, true, true),
    follow_through: surface(true),
    no_post_explainer: surface(false, true, true),
    operator_review: surface(false, true, true),
  }),
  trader_balanced: matrix({
    support_resistance: surface(true),
    pivots: surface(true),
    market_structure: surface(true),
    range_compression: surface(false, true, true),
    breakout_reclaim_quality: surface(true),
    reaction_quality: surface(true),
    volume_activity: surface(false, true, true),
    liquidity_tradability: surface(false, true, true),
    volatility_context: surface(false, true, true),
    catalyst_context: surface(false, true, true),
    session_context: surface(false, true, true),
    opening_range: surface(false, true, true),
    halt_awareness: surface(false, true, true),
    candle_meaning: surface(false, true, true),
    move_extension: surface(false, true, true),
    level_calibration: surface(false, true, true),
    data_quality: surface(false, true, true),
    trade_idea_summary: surface(false, true, true),
    follow_through: surface(true),
    trader_commentary: surface(true),
    no_post_explainer: surface(false, true, true),
    story_memory: surface(false, true, true),
    operator_review: surface(false, true, true),
  }),
  operator_full: matrix(
    SIGNAL_CATEGORY_KEYS.reduce((entries, key) => {
      entries[key] =
        key === "operator_review"
          ? surface(false, true, true)
          : surface(
              [
                "support_resistance",
                "pivots",
                "market_structure",
                "breakout_reclaim_quality",
                "reaction_quality",
                "follow_through",
                "trader_commentary",
              ].includes(key),
              true,
              true,
            );
      return entries;
    }, {} as Partial<Record<SignalCategoryKey, SignalSurfaceConfig>>),
  ),
};

function normalizeProfile(value: string | undefined): SignalCategoryProfile {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "minimal" ||
    normalized === "levels_only" ||
    normalized === "levels_plus_structure" ||
    normalized === "trader_balanced" ||
    normalized === "operator_full"
  ) {
    return normalized;
  }

  return "trader_balanced";
}

export function resolveSignalSurfaceMatrix(
  profileValue: string | undefined = process.env.SIGNAL_CATEGORY_PROFILE,
): SignalSurfaceMatrix {
  const profile = normalizeProfile(profileValue);
  return PROFILE_MATRICES[profile];
}

function envOverrideForCategorySurface(
  category: SignalCategoryKey,
  surfaceName: SignalSurfaceKey,
): boolean | null {
  const envName = `SIGNAL_CATEGORY_${category}_${surfaceName}`
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();
  const raw = process.env[envName]?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  return null;
}

export function isSignalCategoryEnabledForSurface(
  category: SignalCategoryKey,
  surfaceName: SignalSurfaceKey,
  profileValue: string | undefined = process.env.SIGNAL_CATEGORY_PROFILE,
): boolean {
  const override = envOverrideForCategorySurface(category, surfaceName);
  if (override !== null) {
    return override;
  }

  return resolveSignalSurfaceMatrix(profileValue)[category][surfaceName];
}
