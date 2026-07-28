import {
  SIGNAL_CATEGORY_KEYS,
  type SignalCategoryKey,
  type SignalSurfaceKey,
} from "./signal-category-config.js";

export type SignalCategoryLayer =
  | "level_map"
  | "structure"
  | "activity"
  | "interpretation"
  | "operator";

export type SignalCategoryLiveBehavior =
  | "standalone_allowed"
  | "enrichment_only"
  | "operator_only";

export type SignalCategoryRolloutPosture =
  | "active"
  | "quiet_first"
  | "audit_only";

export type SignalCategoryContract = {
  key: SignalCategoryKey;
  label: string;
  layer: SignalCategoryLayer;
  description: string;
  primaryTimeframes: string[];
  liveBehavior: SignalCategoryLiveBehavior;
  defaultSurfaces: SignalSurfaceKey[];
  standaloneDiscordAllowed: boolean;
  quietPersistenceRequired: boolean;
  rolloutPosture: SignalCategoryRolloutPosture;
};

export const SIGNAL_CATEGORY_CONTRACTS: Record<SignalCategoryKey, SignalCategoryContract> = {
  support_resistance: {
    key: "support_resistance",
    label: "Support / Resistance",
    layer: "level_map",
    description: "Saved level ladders, level snapshots, and direct support/resistance map context.",
    primaryTimeframes: ["daily", "4h", "5m"],
    liveBehavior: "standalone_allowed",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: true,
    quietPersistenceRequired: true,
    rolloutPosture: "active",
  },
  pivots: {
    key: "pivots",
    label: "Pivots",
    layer: "structure",
    description: "Higher-low, lower-high, reclaim, and failure context once candle-backed pivots are explicit.",
    primaryTimeframes: ["5m", "4h"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  market_structure: {
    key: "market_structure",
    label: "Market Structure",
    layer: "structure",
    description: "Compression, breakout setup, rejection setup, and repaired/damaged structure context.",
    primaryTimeframes: ["5m", "4h"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  range_compression: {
    key: "range_compression",
    label: "Range Compression",
    layer: "structure",
    description: "Tightening near a level before a decision move.",
    primaryTimeframes: ["5m"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  breakout_reclaim_quality: {
    key: "breakout_reclaim_quality",
    label: "Breakout / Reclaim Quality",
    layer: "structure",
    description: "Breakouts, breakdown risk, reclaims, failed breaks, and role-flip quality.",
    primaryTimeframes: ["5m", "4h", "daily"],
    liveBehavior: "standalone_allowed",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: true,
    quietPersistenceRequired: true,
    rolloutPosture: "active",
  },
  reaction_quality: {
    key: "reaction_quality",
    label: "Reaction Quality",
    layer: "structure",
    description: "Support and resistance touch quality, rejection, stabilization, and weakening reads.",
    primaryTimeframes: ["5m", "4h"],
    liveBehavior: "standalone_allowed",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: true,
    quietPersistenceRequired: true,
    rolloutPosture: "active",
  },
  volume_activity: {
    key: "volume_activity",
    label: "Volume / Activity",
    layer: "activity",
    description: "Reliable relative activity context used as supporting evidence inside existing alerts.",
    primaryTimeframes: ["5m"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  liquidity_tradability: {
    key: "liquidity_tradability",
    label: "Liquidity / Tradability",
    layer: "activity",
    description: "Spread, dollar-volume, and print-quality context used to judge whether level reactions are readable.",
    primaryTimeframes: ["5m", "live_quote"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  volatility_context: {
    key: "volatility_context",
    label: "Small-Cap Volatility Context",
    layer: "activity",
    description: "Small-cap noise floor and meaningful-move context so one-cent wiggles do not become trader stories.",
    primaryTimeframes: ["5m", "live_quote"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  catalyst_context: {
    key: "catalyst_context",
    label: "Catalyst / Profile Context",
    layer: "interpretation",
    description: "Company profile, float, market-cap, short-interest, and known-catalyst context for small-cap risk.",
    primaryTimeframes: ["profile"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  session_context: {
    key: "session_context",
    label: "Session / Gap Context",
    layer: "structure",
    description: "Prior-day, premarket, opening-range, and gap context used as supporting structure around levels.",
    primaryTimeframes: ["daily", "5m"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  opening_range: {
    key: "opening_range",
    label: "Opening Range",
    layer: "structure",
    description: "Opening-range high/low context used to keep morning runners framed around real 5m structure.",
    primaryTimeframes: ["5m"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  halt_awareness: {
    key: "halt_awareness",
    label: "Halt / Pause Awareness",
    layer: "operator",
    description: "Possible halt, pause, or stale-candle context used to prevent stale deterministic reads from sounding current.",
    primaryTimeframes: ["5m", "runtime"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  candle_meaning: {
    key: "candle_meaning",
    label: "Candle Meaning",
    layer: "activity",
    description: "Candle behavior context reserved for operator review until reliability is proven.",
    primaryTimeframes: ["5m", "daily"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  move_extension: {
    key: "move_extension",
    label: "Move Extension / Exhaustion",
    layer: "activity",
    description: "Distance from intraday low/high, VWAP, EMA, and candle streak context for stretched or pulling-back moves.",
    primaryTimeframes: ["5m"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  level_calibration: {
    key: "level_calibration",
    label: "Level Quality Calibration",
    layer: "level_map",
    description: "Forward ladder completeness, thin-ladder, and wide-gap context for support/resistance confidence.",
    primaryTimeframes: ["daily", "4h", "5m"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  data_quality: {
    key: "data_quality",
    label: "Data Quality Gate",
    layer: "operator",
    description: "Cross-layer data quality gate that tells the app when a trader-facing read should be softened or withheld.",
    primaryTimeframes: ["daily", "4h", "5m", "live_quote"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  trade_idea_summary: {
    key: "trade_idea_summary",
    label: "Trade Idea Summary",
    layer: "interpretation",
    description: "Deterministic first-post read that summarizes the practical long-biased setup without execution instructions.",
    primaryTimeframes: ["daily", "4h", "5m"],
    liveBehavior: "enrichment_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  pattern_context: {
    key: "pattern_context",
    label: "Pattern Context",
    layer: "interpretation",
    description: "Chart-pattern context kept out of live Discord until it can be tested without overfitting.",
    primaryTimeframes: ["5m", "4h", "daily"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  follow_through: {
    key: "follow_through",
    label: "Follow Through",
    layer: "structure",
    description: "Meaningful continuation, stalling, and failure updates after a posted setup.",
    primaryTimeframes: ["5m"],
    liveBehavior: "standalone_allowed",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: true,
    quietPersistenceRequired: true,
    rolloutPosture: "active",
  },
  trader_commentary: {
    key: "trader_commentary",
    label: "Trader Commentary",
    layer: "interpretation",
    description: "AI or deterministic trader-facing summaries that remain observational and non-advisory.",
    primaryTimeframes: ["5m", "4h", "daily"],
    liveBehavior: "standalone_allowed",
    defaultSurfaces: ["liveDiscord", "operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: true,
    quietPersistenceRequired: true,
    rolloutPosture: "quiet_first",
  },
  no_post_explainer: {
    key: "no_post_explainer",
    label: "No-Post Explainer",
    layer: "operator",
    description: "Operator-side explanation for why a repeated or low-value story was not sent to Discord.",
    primaryTimeframes: ["runtime"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  story_memory: {
    key: "story_memory",
    label: "Thread Story Memory",
    layer: "operator",
    description: "Operator-side memory of what the thread already told the trader, used to suppress repeated same-story posts.",
    primaryTimeframes: ["runtime"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: true,
    rolloutPosture: "audit_only",
  },
  operator_review: {
    key: "operator_review",
    label: "Operator Review",
    layer: "operator",
    description: "Diagnostics, audit evidence, and testing-only information that must stay out of Discord.",
    primaryTimeframes: ["runtime"],
    liveBehavior: "operator_only",
    defaultSurfaces: ["operatorArtifacts", "internalScoring"],
    standaloneDiscordAllowed: false,
    quietPersistenceRequired: false,
    rolloutPosture: "audit_only",
  },
};

export function getSignalCategoryContract(category: SignalCategoryKey): SignalCategoryContract {
  return SIGNAL_CATEGORY_CONTRACTS[category];
}

export function validateSignalCategoryContracts(): string[] {
  const issues: string[] = [];
  for (const key of SIGNAL_CATEGORY_KEYS) {
    const contract = SIGNAL_CATEGORY_CONTRACTS[key];
    if (!contract) {
      issues.push(`${key} is missing a category contract`);
      continue;
    }
    if (contract.key !== key) {
      issues.push(`${key} contract has mismatched key ${contract.key}`);
    }
    if (contract.liveBehavior !== "standalone_allowed" && contract.standaloneDiscordAllowed) {
      issues.push(`${key} allows standalone Discord despite ${contract.liveBehavior} behavior`);
    }
    if (contract.primaryTimeframes.length === 0) {
      issues.push(`${key} has no timeframe ownership`);
    }
  }
  return issues;
}
