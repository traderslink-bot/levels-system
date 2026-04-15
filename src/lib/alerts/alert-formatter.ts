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
  };
} {
  return {
    title: alert.title,
    body: alert.body,
    meta: {
      severity: alert.severity,
      confidence: alert.confidence,
      score: alert.score,
      tags: alert.tags,
    },
  };
}
