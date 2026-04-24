import type {
  FinnhubCompanyProfile,
  FinnhubQuote,
  FinnhubThreadPreview,
} from "./finnhub-client.js";

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

function formatShareCount(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}B`;
  }

  return `${value.toFixed(2)}M`;
}

function formatIdentityLine(symbol: string, profile: FinnhubCompanyProfile): string {
  const name = profile.name?.trim() || symbol;
  const exchange = profile.exchange?.trim() || "n/a";
  const industry = profile.finnhubIndustry?.trim() || "n/a";
  return `${symbol} | ${name} | ${exchange} | ${industry}`;
}

function formatQuoteLine(quote: FinnhubQuote): string {
  return [
    `price ${formatPrice(quote.c)}`,
    `change ${formatSignedPrice(quote.d)}`,
    `move ${formatPercent(quote.dp)}`,
    `high ${formatPrice(quote.h)}`,
    `low ${formatPrice(quote.l)}`,
    `prev ${formatPrice(quote.pc)}`,
  ].join(" | ");
}

export function formatFinnhubThreadPreview(preview: FinnhubThreadPreview): string {
  const profile = preview.profile;

  return [
    `FIRST THREAD POST PREVIEW`,
    formatIdentityLine(preview.symbol, profile),
    ``,
    `Quote`,
    formatQuoteLine(preview.quote),
    ``,
    `Company`,
    `market cap ${formatMarketCap(profile.marketCapitalization)} | shares out ${formatShareCount(profile.shareOutstanding)} | ipo ${profile.ipo?.trim() || "n/a"} | country ${profile.country?.trim() || "n/a"}`,
    `website ${profile.weburl?.trim() || "n/a"}`,
    ``,
    `Levels loading...`,
  ].join("\n");
}
