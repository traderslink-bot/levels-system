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

function formatLargeCurrency(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (absolute >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  if (absolute >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }

  return `$${value.toFixed(2)}`;
}

function formatShares(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }

  return value.toFixed(0);
}

function formatPrice(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatPercentChange(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function hasNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
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

function truncateDescription(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (normalized === "n/a" || normalized.length <= 650) {
    return normalized;
  }

  return `${normalized.slice(0, 647).trim()}...`;
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
  const summary = yahoo.summary;
  const previousDay = yahoo.previousDay;
  if (!quote && !summary && !previousDay) {
    return [];
  }

  const lines = ["", "Yahoo context:"];

  if (quote) {
    const currentPrice = latestYahooPriceLabel(preview);
    if (currentPrice !== "n/a") {
      lines.push(`Current price (Yahoo): ${currentPrice}`);
    }
    if (
      hasNumber(quote.regularMarketPrice) ||
      hasNumber(quote.regularMarketDayHigh) ||
      hasNumber(quote.regularMarketDayLow) ||
      hasNumber(quote.regularMarketVolume)
    ) {
      lines.push(
        `Regular session (Yahoo): price ${formatPrice(quote.regularMarketPrice)} | high ${formatPrice(quote.regularMarketDayHigh)} | low ${formatPrice(quote.regularMarketDayLow)} | volume ${formatShares(quote.regularMarketVolume)}`,
      );
    }
    if (hasNumber(quote.preMarketPrice) || hasNumber(quote.preMarketChange) || hasNumber(quote.preMarketChangePercent)) {
      lines.push(
        `Premarket (Yahoo): ${formatPrice(quote.preMarketPrice)} | change ${formatPrice(quote.preMarketChange)} (${formatPercentChange(quote.preMarketChangePercent)})`,
      );
    }
    if (hasNumber(quote.postMarketPrice) || hasNumber(quote.postMarketChange) || hasNumber(quote.postMarketChangePercent)) {
      lines.push(
        `Postmarket (Yahoo): ${formatPrice(quote.postMarketPrice)} | change ${formatPrice(quote.postMarketChange)} (${formatPercentChange(quote.postMarketChangePercent)})`,
      );
    }
    if (hasNumber(quote.fiftyTwoWeekHigh) || hasNumber(quote.fiftyTwoWeekLow)) {
      lines.push(`52-week range (Yahoo): high ${formatPrice(quote.fiftyTwoWeekHigh)} | low ${formatPrice(quote.fiftyTwoWeekLow)}`);
    }
  }

  if (hasNumber(previousDay?.high) || hasNumber(previousDay?.low)) {
    lines.push(`Previous day range (Yahoo): high ${formatPrice(previousDay?.high)} | low ${formatPrice(previousDay?.low)}`);
  }

  const yahooMarketCap = summary?.marketCap ?? quote?.marketCap;
  if (hasNumber(yahooMarketCap)) {
    lines.push(`Market cap (Yahoo): ${formatLargeCurrency(yahooMarketCap)}`);
  }

  if (hasNumber(summary?.floatShares) || hasNumber(summary?.sharesOutstanding)) {
    lines.push(
      `Float / shares (Yahoo): float ${formatShares(summary?.floatShares)} | shares outstanding ${formatShares(summary?.sharesOutstanding)}`,
    );
  }
  if (hasNumber(summary?.shortPercentOfFloat) || hasNumber(summary?.sharesShort) || hasNumber(summary?.shortRatio)) {
    lines.push(
      `Short interest (Yahoo): ${formatPercent(summary?.shortPercentOfFloat)} of float | shares short ${formatShares(summary?.sharesShort)} | short ratio ${formatPrice(summary?.shortRatio)}`,
    );
  }
  if (hasNumber(summary?.profitMargins) || hasNumber(summary?.operatingMargins)) {
    lines.push(
      `Profitability (Yahoo): profit margin ${formatPercent(summary?.profitMargins)} | operating margin ${formatPercent(summary?.operatingMargins)}`,
    );
  }
  if (hasNumber(summary?.totalCash) || hasNumber(summary?.totalDebt)) {
    lines.push(`Cash / debt (Yahoo): cash ${formatLargeCurrency(summary?.totalCash)} | debt ${formatLargeCurrency(summary?.totalDebt)}`);
  }
  if (hasNumber(summary?.totalRevenue) || hasNumber(summary?.revenueGrowth)) {
    lines.push(`Revenue (Yahoo): revenue ${formatLargeCurrency(summary?.totalRevenue)} | revenue growth ${formatPercent(summary?.revenueGrowth)}`);
  }

  const description = truncateDescription(summary?.description);
  if (description !== "n/a") {
    lines.push(`Company description (Yahoo): ${description}`);
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
