import type {
  FinnhubCompanyProfile,
  FinnhubThreadPreview,
  FinnhubQuote,
} from "./finnhub-client.js";
import type { AlertPayload } from "../alerts/alert-types.js";

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatPrice(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  if (value >= 100) {
    return value.toFixed(2);
  }

  if (value >= 1) {
    return value.toFixed(3);
  }

  return value.toFixed(4);
}

function formatSignedPrice(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPrice(value)}`;
}

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
  const quote = preview.quote;

  return {
    title: "",
    body: [
      `COMPANY: ${normalizeText(profile.name, symbol)}`,
      `EXCHANGE: ${normalizeText(profile.exchange)}`,
      `INDUSTRY: ${normalizeText(profile.finnhubIndustry)}`,
      `COUNTRY: ${normalizeText(profile.country)}`,
      `WEBSITE: ${formatWebsite(profile.weburl)}`,
      `MARKET CAP: ${formatMarketCap(profile.marketCapitalization)}`,
      ``,
      `CURRENT PRICE: ${formatPrice(quote.c)}`,
      `PERCENT CHANGE: ${formatPercent(quote.dp)}`,
      `OPEN: ${formatPrice(quote.o)}`,
      `HIGH: ${formatPrice(quote.h)}`,
      `LOW: ${formatPrice(quote.l)}`,
      `PREVIOUS CLOSE: ${formatPrice(quote.pc)}`,
      ``,
      `Levels loading...`,
    ].join("\n"),
    symbol,
    timestamp: typeof quote.t === "number" && quote.t > 0 ? quote.t * 1000 : Date.now(),
    metadata: {
      messageKind: "stock_context",
    },
  };
}

export function formatFinnhubThreadPreview(preview: FinnhubThreadPreview): string {
  const payload = buildFinnhubThreadPreviewPayload(preview);
  return payload.title ? [payload.title, payload.body].join("\n") : payload.body;
}
