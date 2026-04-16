// 2026-04-14 10:18 PM America/Toronto
// Formats intelligent alerts into terminal-friendly and future Discord-friendly text.

import type { IntelligentAlert } from "./alert-types.js";

export function formatIntelligentAlert(alert: IntelligentAlert): {
  title: string;
  body: string;
  meta: {
    severity: string;
    confidence: string;
    score: number;
    tags: string[];
    context: string[];
  };
} {
  const context: string[] = [
    `origin:${alert.event.eventContext.zoneOrigin}`,
    `ladder:${alert.event.eventContext.ladderPosition}`,
    `freshness:${alert.event.eventContext.zoneFreshness}`,
  ];

  if (alert.event.eventContext.remapStatus !== "new") {
    context.push(`remap:${alert.event.eventContext.remapStatus}`);
  }

  if (alert.event.eventContext.recentlyRefreshed) {
    context.push("recently_refreshed");
  }

  if (alert.event.eventContext.recentlyPromotedExtension) {
    context.push("recently_promoted_extension");
  }

  if (alert.event.eventContext.dataQualityDegraded) {
    context.push("data_quality_degraded");
  }

  return {
    title: alert.title,
    body: alert.body,
    meta: {
      severity: alert.severity,
      confidence: alert.confidence,
      score: alert.score,
      tags: alert.tags,
      context,
    },
  };
}
