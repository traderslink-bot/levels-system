import { IBApi } from "@stoqey/ib";

import { EodhdLivePriceProvider } from "./eodhd-live-price-provider.js";
import { IBKRLivePriceProvider } from "./ibkr-live-price-provider.js";
import { PlatformMoomooLivePriceProvider } from "./platform-moomoo-live-price-provider.js";
import type { LivePriceProvider } from "./live-price-types.js";

export type LivePriceProviderName = "ibkr" | "eodhd" | "moomoo";

export type LivePriceProviderFactoryOptions = {
  provider?: LivePriceProviderName;
  ib?: IBApi;
};

export function resolveLivePriceProviderName(raw: string | undefined): LivePriceProviderName {
  const provider = raw?.trim().toLowerCase();
  if (provider === "eodhd" || provider === "moomoo") {
    return provider;
  }
  return "ibkr";
}

export function createLivePriceProvider(options: LivePriceProviderFactoryOptions = {}): LivePriceProvider {
  const provider = options.provider ?? resolveLivePriceProviderName(process.env.LEVEL_LIVE_PRICE_PROVIDER);

  if (provider === "eodhd") {
    return new EodhdLivePriceProvider();
  }

  if (provider === "moomoo") {
    return new PlatformMoomooLivePriceProvider();
  }

  return options.ib ? new IBKRLivePriceProvider(options.ib) : new IBKRLivePriceProvider();
}
