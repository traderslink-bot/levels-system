import type { AlertPayload, IntelligentAlert } from "../alerts/alert-types.js";
import type { MonitoringEventType } from "../monitoring/monitoring-types.js";
import { isSignalCategoryEnabledForSurface, type SignalCategoryKey } from "./signal-category-config.js";
import { getSignalCategoryContract } from "./signal-category-contracts.js";

export type SignalCategoryRoute = {
  primaryCategory: SignalCategoryKey;
  supportingCategories: SignalCategoryKey[];
};

export function routeMonitoringEventToSignalCategory(
  eventType: MonitoringEventType,
): SignalCategoryRoute {
  switch (eventType) {
    case "level_touch":
      return {
        primaryCategory: "reaction_quality",
        supportingCategories: [
          "support_resistance",
          "market_structure",
          "volume_activity",
          "liquidity_tradability",
          "volatility_context",
          "session_context",
          "opening_range",
          "candle_meaning",
          "move_extension",
          "level_calibration",
          "data_quality",
          "trade_idea_summary",
          "no_post_explainer",
          "story_memory",
        ],
      };
    case "breakout":
    case "breakdown":
    case "fake_breakout":
    case "fake_breakdown":
    case "reclaim":
      return {
        primaryCategory: "breakout_reclaim_quality",
        supportingCategories: [
          "support_resistance",
          "market_structure",
          "volume_activity",
          "liquidity_tradability",
          "volatility_context",
          "session_context",
          "opening_range",
          "halt_awareness",
          "candle_meaning",
          "move_extension",
          "level_calibration",
          "data_quality",
          "trade_idea_summary",
          "no_post_explainer",
          "story_memory",
        ],
      };
    case "rejection":
      return {
        primaryCategory: "reaction_quality",
        supportingCategories: [
          "support_resistance",
          "market_structure",
          "volume_activity",
          "liquidity_tradability",
          "volatility_context",
          "session_context",
          "opening_range",
          "candle_meaning",
          "move_extension",
          "level_calibration",
          "data_quality",
          "trade_idea_summary",
          "no_post_explainer",
          "story_memory",
        ],
      };
    case "compression":
      return {
        primaryCategory: "range_compression",
        supportingCategories: [
          "support_resistance",
          "market_structure",
          "volume_activity",
          "liquidity_tradability",
          "volatility_context",
          "session_context",
          "opening_range",
          "move_extension",
          "level_calibration",
          "data_quality",
          "trade_idea_summary",
          "no_post_explainer",
          "story_memory",
        ],
      };
  }
}

export function routeMessageKindToSignalCategory(params: {
  messageKind?: NonNullable<NonNullable<AlertPayload["metadata"]>["messageKind"]>;
  eventType?: MonitoringEventType;
}): SignalCategoryRoute {
  if (params.eventType) {
    return routeMonitoringEventToSignalCategory(params.eventType);
  }

  switch (params.messageKind) {
    case "stock_context":
      return {
        primaryCategory: "support_resistance",
        supportingCategories: ["catalyst_context", "liquidity_tradability", "data_quality", "operator_review"],
      };
    case "level_clear_update":
      return {
        primaryCategory: "breakout_reclaim_quality",
        supportingCategories: ["support_resistance"],
      };
    case "follow_through_update":
    case "follow_through_state_update":
      return {
        primaryCategory: "follow_through",
        supportingCategories: [
          "support_resistance",
          "market_structure",
          "move_extension",
          "volatility_context",
          "data_quality",
          "story_memory",
          "no_post_explainer",
        ],
      };
    case "market_structure_update":
      return {
        primaryCategory: "market_structure",
        supportingCategories: [
          "support_resistance",
          "volume_activity",
          "data_quality",
          "story_memory",
          "no_post_explainer",
        ],
      };
    case "continuity_update":
    case "symbol_recap":
    case "ai_signal_commentary":
      return {
        primaryCategory: "trader_commentary",
        supportingCategories: [
          "support_resistance",
          "market_structure",
          "volume_activity",
          "trade_idea_summary",
          "data_quality",
          "story_memory",
        ],
      };
    case "intelligent_alert":
    case undefined:
      return {
        primaryCategory: "support_resistance",
        supportingCategories: [],
      };
  }
}

export function routeThreadMessageKindToSignalCategory(params: {
  messageKind?: string;
  eventType?: string;
}): SignalCategoryRoute {
  const eventType = isMonitoringEventType(params.eventType) ? params.eventType : undefined;
  const messageKind = isAlertPayloadMessageKind(params.messageKind)
    ? params.messageKind
    : undefined;
  if (params.messageKind === "level_snapshot" || params.messageKind === "level_extension") {
    return {
      primaryCategory: "support_resistance",
      supportingCategories: [],
    };
  }
  return routeMessageKindToSignalCategory({ messageKind, eventType });
}

export function resolvePrimarySignalCategoryForAlert(alert: IntelligentAlert): SignalCategoryKey {
  return routeMonitoringEventToSignalCategory(alert.event.eventType).primaryCategory;
}

export function resolveSupportingSignalCategoriesForAlert(alert: IntelligentAlert): SignalCategoryKey[] {
  return routeMonitoringEventToSignalCategory(alert.event.eventType).supportingCategories;
}

export function isAlertPrimaryCategoryLiveEnabled(alert: IntelligentAlert): boolean {
  return isSignalCategoryLiveEnabled(resolvePrimarySignalCategoryForAlert(alert));
}

export function isSignalCategoryLiveEnabled(category: SignalCategoryKey): boolean {
  return isSignalCategoryEnabledForSurface(category, "liveDiscord");
}

export function explainSignalCategoryLiveSuppression(alert: IntelligentAlert): string | null {
  const category = resolvePrimarySignalCategoryForAlert(alert);
  if (isSignalCategoryLiveEnabled(category)) {
    return null;
  }

  const contract = getSignalCategoryContract(category);
  if (contract.liveBehavior === "operator_only") {
    return `${category} is operator/internal by profile`;
  }
  return `${category} is enrichment-only by profile`;
}

function isMonitoringEventType(value: string | undefined): value is MonitoringEventType {
  return (
    value === "level_touch" ||
    value === "breakout" ||
    value === "breakdown" ||
    value === "rejection" ||
    value === "fake_breakout" ||
    value === "fake_breakdown" ||
    value === "reclaim" ||
    value === "compression"
  );
}

function isAlertPayloadMessageKind(
  value: string | undefined,
): value is NonNullable<NonNullable<AlertPayload["metadata"]>["messageKind"]> {
  return (
    value === "intelligent_alert" ||
    value === "stock_context" ||
    value === "level_clear_update" ||
    value === "follow_through_update" ||
    value === "follow_through_state_update" ||
    value === "continuity_update" ||
    value === "symbol_recap" ||
    value === "ai_signal_commentary" ||
    value === "market_structure_update"
  );
}
