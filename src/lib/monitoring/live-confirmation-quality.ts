export type LiveConfirmationQualityInput = {
  currentPrice: number;
  latestRangePct: number;
  priorRangePct: number;
  closeExtensionPct: number;
  latestTimestamp: number;
};

export type LiveConfirmationQualityResult = {
  passed: boolean;
  rejectReasons: string[];
};

export const LIVE_VOLUME_EXPANSION_CONFIRMATION_QUALITY = {
  minCurrentPrice: 0.05,
  minPriorRangePct: 3,
  maxPriorRangePct: 30,
  minLatestRangePct: 4,
  maxLatestRangePct: 15,
  maxCloseExtensionPct: 8,
  lateSessionCutoffMinutesEt: 15 * 60 + 30,
} as const;

const NEW_YORK_TIMEZONE = "America/New_York";
const newYorkTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function newYorkMinutesIntoDay(timestamp: number): number | null {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const parts = newYorkTimeFormatter.formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(byType.hour);
  const minute = Number(byType.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

export function evaluateLiveVolumeExpansionConfirmationQuality(
  input: LiveConfirmationQualityInput,
): LiveConfirmationQualityResult {
  const rejectReasons: string[] = [];
  const quality = LIVE_VOLUME_EXPANSION_CONFIRMATION_QUALITY;

  if (input.currentPrice < quality.minCurrentPrice) {
    rejectReasons.push(`price below ${quality.minCurrentPrice.toFixed(2)}`);
  }

  if (input.priorRangePct < quality.minPriorRangePct || input.priorRangePct > quality.maxPriorRangePct) {
    rejectReasons.push(
      `prior 5m range outside ${quality.minPriorRangePct.toFixed(0)}%-${quality.maxPriorRangePct.toFixed(0)}%`,
    );
  }

  if (input.latestRangePct < quality.minLatestRangePct || input.latestRangePct > quality.maxLatestRangePct) {
    rejectReasons.push(
      `latest 5m range outside ${quality.minLatestRangePct.toFixed(0)}%-${quality.maxLatestRangePct.toFixed(0)}%`,
    );
  }

  if (input.closeExtensionPct > quality.maxCloseExtensionPct) {
    rejectReasons.push(`close more than ${quality.maxCloseExtensionPct.toFixed(0)}% above trigger`);
  }

  const minutesIntoDay = newYorkMinutesIntoDay(input.latestTimestamp);
  if (minutesIntoDay !== null && minutesIntoDay >= quality.lateSessionCutoffMinutesEt) {
    rejectReasons.push("confirmation after 3:30pm ET");
  }

  return {
    passed: rejectReasons.length === 0,
    rejectReasons,
  };
}

export function describeLiveVolumeExpansionConfirmationQuality(): string {
  const quality = LIVE_VOLUME_EXPANSION_CONFIRMATION_QUALITY;
  return [
    `price >= ${quality.minCurrentPrice.toFixed(2)}`,
    `prior 5m range ${quality.minPriorRangePct.toFixed(0)}%-${quality.maxPriorRangePct.toFixed(0)}%`,
    `latest 5m range ${quality.minLatestRangePct.toFixed(0)}%-${quality.maxLatestRangePct.toFixed(0)}%`,
    `close extension <= ${quality.maxCloseExtensionPct.toFixed(0)}% above trigger`,
    "before 3:30pm ET",
  ].join(", ");
}
