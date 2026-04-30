import type { FinnhubThreadPreview } from "./finnhub-client.js";
import type { StockContextPreview } from "./stock-context-types.js";
import type { AlertPayload } from "../alerts/alert-types.js";

function formatMarketCap(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}B`;
  }

  if (value >= 1) {
    return `${value.toFixed(2)}M`;
  }

  return `${(value * 1_000).toFixed(2)}K`;
}

function formatPrice(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function optionalTextLine(label: string, value: string | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized === "n/a" ? null : `${label}: ${normalized}`;
}

function optionalFormattedLine(label: string, value: string | null): string | null {
  return value && value !== "n/a" ? `${label}: ${value}` : null;
}

function currentPriceLabel(preview: StockContextPreview): string | null {
  const yahooPrice = latestYahooPriceLabel(preview);
  if (yahooPrice !== "n/a") {
    return yahooPrice;
  }

  const finnhubQuote = preview.quote;
  if (typeof finnhubQuote.c === "number" && Number.isFinite(finnhubQuote.c) && finnhubQuote.c > 0) {
    return formatPrice(finnhubQuote.c);
  }

  return null;
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

function formatExchange(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (normalized === "n/a") {
    return normalized;
  }

  const upper = normalized.toUpperCase();
  if (upper.includes("NASDAQ")) {
    return "Nasdaq";
  }
  if (upper.includes("NYSE AMERICAN")) {
    return "NYSE American";
  }
  if (upper.includes("NYSE ARCA")) {
    return "NYSE Arca";
  }
  if (upper.includes("NEW YORK STOCK EXCHANGE") || upper === "NYSE") {
    return "NYSE";
  }

  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function latestYahooPriceLabel(preview: StockContextPreview): string {
  const quote = preview.yahoo?.quote;
  if (!quote) {
    return "n/a";
  }

  const candidates = [
    { label: "postmarket", price: quote.postMarketPrice, time: quote.postMarketTime },
    { label: "premarket", price: quote.preMarketPrice, time: quote.preMarketTime },
    { label: "regular", price: quote.regularMarketPrice, time: quote.regularMarketTime },
  ].filter((candidate) => typeof candidate.price === "number" && Number.isFinite(candidate.price));

  candidates.sort((left, right) => (right.time ?? 0) - (left.time ?? 0));
  const latest = candidates[0];
  return latest ? `${formatPrice(latest.price)} (${latest.label})` : "n/a";
}

export function buildFinnhubThreadPreviewPayload(preview: FinnhubThreadPreview | StockContextPreview): AlertPayload {
  const profile = preview.profile;
  const symbol = preview.symbol;
  const stockContextPreview = preview as StockContextPreview;
  const currentPrice = currentPriceLabel(stockContextPreview);
  const profileLines = [
    `Company: ${normalizeText(profile.name, symbol)}`,
    optionalFormattedLine("Exchange", formatExchange(profile.exchange)),
    optionalTextLine("Industry", profile.finnhubIndustry),
    optionalTextLine("Country", profile.country),
    optionalFormattedLine("Website", formatWebsite(profile.weburl)),
    optionalFormattedLine("Market cap", formatMarketCap(profile.marketCapitalization)),
    optionalFormattedLine("Shares outstanding", formatMarketCap(profile.shareOutstanding)),
  ].filter((line): line is string => Boolean(line));

  return {
    title: "",
    body: [
      ...(currentPrice ? [`Current price: ${currentPrice}`, ""] : []),
      ...profileLines,
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

export function formatFinnhubThreadPreview(preview: FinnhubThreadPreview | StockContextPreview): string {
  const payload = buildFinnhubThreadPreviewPayload(preview);
  return payload.title ? [payload.title, payload.body].join("\n") : payload.body;
}
