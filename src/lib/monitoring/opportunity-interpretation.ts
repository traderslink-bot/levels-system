import type { AdaptedOpportunity } from "./adaptive-scoring.js";

export type InterpretationType =
  | "pre_zone"
  | "in_zone"
  | "confirmation"
  | "weakening"
  | "breakout_context"
  | "neutral";

export type OpportunityInterpretationContext = {
  opportunity: AdaptedOpportunity;
  levels: {
    referenceLevel: number;
    zoneLabel: "support" | "resistance" | "level";
  };
  structure: {
    type: string | null;
    strength: number;
  };
  adaptiveState: {
    adaptiveMultiplier: number;
    weakStreak: number;
  };
};

export type OpportunityInterpretation = {
  symbol: string;
  message: string;
  type: InterpretationType;
  confidence: number;
  tags: string[];
  timestamp: number;
};

type InterpretationProgressState = {
  stageRank: number;
};

export const APPROVED_INTERPRETATION_MESSAGE_TEMPLATES: Record<InterpretationType, string> = {
  pre_zone: "watching pullback into support near {level}",
  in_zone: "price testing support near {level} - watching reaction",
  confirmation: "buyers reacting at support near {level}",
  weakening: "support weakening near {level}",
  breakout_context: "holding above breakout level near {level}",
  neutral: "potential buy zone below near {level}",
};

const SAME_LEVEL_COOLDOWN_MS = 5 * 60 * 1000;
const SYMBOL_TYPE_COOLDOWN_MS = 90 * 1000;

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatInterpretationLevel(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatTemplate(
  template: string,
  level: number,
): string {
  return template.replace("{level}", formatInterpretationLevel(level));
}

function stageRank(type: InterpretationType): number {
  switch (type) {
    case "pre_zone":
      return 1;
    case "in_zone":
      return 2;
    case "confirmation":
      return 3;
    default:
      return 0;
  }
}

function resolveZoneLabel(opportunity: AdaptedOpportunity): "support" | "resistance" | "level" {
  if (
    opportunity.type === "breakdown" ||
    opportunity.type === "rejection" ||
    opportunity.type === "fake_breakout" ||
    opportunity.bias === "bearish"
  ) {
    return "resistance";
  }

  if (
    opportunity.type === "breakout" ||
    opportunity.type === "reclaim" ||
    opportunity.type === "fake_breakdown" ||
    opportunity.type === "level_touch" ||
    opportunity.type === "compression" ||
    opportunity.bias !== "bearish"
  ) {
    return "support";
  }

  return "level";
}

function resolveBaseType(context: OpportunityInterpretationContext): InterpretationType {
  const { opportunity, adaptiveState, structure } = context;

  if (adaptiveState.weakStreak > 0 && adaptiveState.adaptiveMultiplier < 1) {
    return "weakening";
  }

  if (opportunity.type === "breakout" && structure.type === "breakout_setup") {
    return "breakout_context";
  }

  if (
    opportunity.type === "breakout" ||
    (opportunity.type === "compression" && opportunity.bias !== "bearish")
  ) {
    return "pre_zone";
  }

  if (opportunity.type === "level_touch") {
    return "in_zone";
  }

  if (opportunity.type === "rejection" || opportunity.type === "reclaim") {
    return "confirmation";
  }

  return "neutral";
}

function applyProgression(
  candidateType: InterpretationType,
  previous: InterpretationProgressState | undefined,
): InterpretationType {
  const candidateRank = stageRank(candidateType);
  if (candidateRank === 0) {
    return candidateType;
  }

  const previousRank = previous?.stageRank ?? 0;

  if (candidateRank <= previousRank + 1) {
    return candidateType;
  }

  return previousRank <= 0 ? "in_zone" : "confirmation";
}

function buildMessage(type: InterpretationType, context: OpportunityInterpretationContext): string {
  return formatTemplate(
    APPROVED_INTERPRETATION_MESSAGE_TEMPLATES[type],
    context.levels.referenceLevel,
  );
}

function buildTags(
  type: InterpretationType,
  context: OpportunityInterpretationContext,
): string[] {
  return [
    type,
    context.opportunity.type,
    context.levels.zoneLabel,
    context.structure.type ?? "no_structure",
  ];
}

export function interpretOpportunity(
  context: OpportunityInterpretationContext,
  previous?: InterpretationProgressState,
): OpportunityInterpretation {
  const candidateType = resolveBaseType(context);
  const resolvedType = applyProgression(candidateType, previous);
  const weaknessAdjustment = clamp(1 - context.adaptiveState.weakStreak * 0.18, 0.4, 1);
  const confidence = round(clamp(
    context.opportunity.strength *
      context.adaptiveState.adaptiveMultiplier *
      weaknessAdjustment,
  ));

  return {
    symbol: context.opportunity.symbol,
    message: buildMessage(resolvedType, context),
    type: resolvedType,
    confidence,
    tags: buildTags(resolvedType, context),
    timestamp: context.opportunity.timestamp,
  };
}

export class OpportunityInterpretationLayer {
  private readonly progressByOpportunity = new Map<string, InterpretationProgressState>();
  private readonly lastBySignature = new Map<string, number>();
  private readonly lastBySymbolType = new Map<string, number>();

  private buildOpportunityKey(opportunity: AdaptedOpportunity): string {
    return `${opportunity.symbol}|${opportunity.type}|${round(opportunity.level, 4)}`;
  }

  private buildContext(opportunity: AdaptedOpportunity, weakStreak: number): OpportunityInterpretationContext {
    return {
      opportunity,
      levels: {
        referenceLevel: opportunity.level,
        zoneLabel: resolveZoneLabel(opportunity),
      },
      structure: {
        type: opportunity.structureType,
        strength: opportunity.structureStrength,
      },
      adaptiveState: {
        adaptiveMultiplier: opportunity.adaptiveMultiplier,
        weakStreak,
      },
    };
  }

  private shouldEmit(opportunity: AdaptedOpportunity, interpretation: OpportunityInterpretation): boolean {
    const roundedLevel = round(opportunity.level, 4);
    const signatureKey = `${interpretation.symbol}|${interpretation.type}|${roundedLevel}`;
    const symbolTypeKey = `${interpretation.symbol}|${interpretation.type}`;
    const lastSignatureAt = this.lastBySignature.get(signatureKey);
    const lastSymbolTypeAt = this.lastBySymbolType.get(symbolTypeKey);

    if (
      typeof lastSignatureAt === "number" &&
      interpretation.timestamp - lastSignatureAt < SAME_LEVEL_COOLDOWN_MS
    ) {
      return false;
    }

    if (
      typeof lastSymbolTypeAt === "number" &&
      interpretation.timestamp - lastSymbolTypeAt < SYMBOL_TYPE_COOLDOWN_MS
    ) {
      return false;
    }

    this.lastBySignature.set(signatureKey, interpretation.timestamp);
    this.lastBySymbolType.set(symbolTypeKey, interpretation.timestamp);
    return true;
  }

  interpret(opportunity: AdaptedOpportunity, weakStreak: number): OpportunityInterpretation | null {
    const opportunityKey = this.buildOpportunityKey(opportunity);
    const previous = this.progressByOpportunity.get(opportunityKey);
    const interpretation = interpretOpportunity(this.buildContext(opportunity, weakStreak), previous);

    this.progressByOpportunity.set(opportunityKey, {
      stageRank: Math.max(previous?.stageRank ?? 0, stageRank(interpretation.type)),
    });

    if (!this.shouldEmit(opportunity, interpretation)) {
      return null;
    }

    return interpretation;
  }

  formatForConsole(interpretation: OpportunityInterpretation): string {
    return [
      `SYMBOL: ${interpretation.symbol}`,
      `TYPE: ${interpretation.type}`,
      `MESSAGE: ${interpretation.message}`,
      `CONFIDENCE: ${interpretation.confidence.toFixed(2)}`,
    ].join("\n");
  }
}
