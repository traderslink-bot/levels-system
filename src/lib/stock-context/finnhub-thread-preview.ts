import type {
  FinnhubCompanyProfile,
  FinnhubThreadPreview,
} from "./finnhub-client.js";
import type { AlertPayload } from "../alerts/alert-types.js";

function formatMarketCap(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}B`;
  }

  if (value >= 1) {
    return `${value.toFixed(2)}M`;
  }

  return `${(value * 1_000).toFixed(2)}K`;
}

function normalizeText(value: string | undefined, fallback = "n/a"): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function formatWebsite(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (normalized === "n/a") {
    return normalized;
  }

  const trimmed = normalized.replace(/\/+$/g, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function buildFinnhubThreadPreviewPayload(preview: FinnhubThreadPreview): AlertPayload {
  const profile = preview.profile;
  const symbol = preview.symbol;

  return {
    title: "",
    body: [
      `Company: ${normalizeText(profile.name, symbol)}`,
      `Exchange: ${normalizeText(profile.exchange)}`,
      `Industry: ${normalizeText(profile.finnhubIndustry)}`,
      `Country: ${normalizeText(profile.country)}`,
      `Website: ${formatWebsite(profile.weburl)}`,
      `Market cap: ${formatMarketCap(profile.marketCapitalization)}`,
      ``,
      `Levels are loading.`,
    ].join("\n"),
    symbol,
    timestamp:
      typeof preview.quote.t === "number" && preview.quote.t > 0
        ? preview.quote.t * 1000
        : Date.now(),
    metadata: {
      messageKind: "stock_context",
      suppressEmbeds: true,
    },
  };
}

export function formatFinnhubThreadPreview(preview: FinnhubThreadPreview): string {
  const payload = buildFinnhubThreadPreviewPayload(preview);
  return payload.title ? [payload.title, payload.body].join("\n") : payload.body;
}
