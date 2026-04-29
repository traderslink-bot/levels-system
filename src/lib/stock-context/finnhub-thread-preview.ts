import type { FinnhubThreadPreview } from "./finnhub-client.js";
import type { StockContextPreview } from "./stock-context-types.js";
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

function formatPrice(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
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

function buildYahooLines(preview: StockContextPreview): string[] {
  const yahoo = preview.yahoo;
  if (!yahoo) {
    return [];
  }

  const quote = yahoo.quote;
  if (!quote) {
    return [];
  }

  const lines = ["", "Yahoo context:"];

  const currentPrice = latestYahooPriceLabel(preview);
  if (currentPrice !== "n/a") {
    lines.push(`Current price (Yahoo): ${currentPrice}`);
  }

  return lines.length > 2 ? lines : [];
}

export function buildFinnhubThreadPreviewPayload(preview: FinnhubThreadPreview | StockContextPreview): AlertPayload {
  const profile = preview.profile;
  const symbol = preview.symbol;
  const stockContextPreview = preview as StockContextPreview;

  return {
    title: "",
    body: [
      `Company: ${normalizeText(profile.name, symbol)}`,
      `Exchange (Finnhub): ${normalizeText(profile.exchange)}`,
      `Industry (Finnhub): ${normalizeText(profile.finnhubIndustry)}`,
      `Country (Finnhub): ${normalizeText(profile.country)}`,
      `Website (Finnhub): ${formatWebsite(profile.weburl)}`,
      `Market cap (Finnhub): ${formatMarketCap(profile.marketCapitalization)}`,
      `Shares outstanding (Finnhub): ${formatMarketCap(profile.shareOutstanding)}`,
      ...buildYahooLines(stockContextPreview),
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
