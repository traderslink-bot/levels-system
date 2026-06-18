import { IBApi } from "@stoqey/ib";

import type { CandleProviderName } from "./candle-types.js";
import { StubHistoricalCandleProvider } from "./candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "./ibkr-historical-candle-provider.js";
import type { HistoricalCandleProvider } from "./provider-types.js";
import { resolveProviderPriority } from "./provider-priority.js";

export type HistoricalProviderFactoryOptions = {
  provider?: CandleProviderName;
  ib?: IBApi;
  ibkrTimeoutMs?: number;
};

export function createHistoricalCandleProvider(
  options: HistoricalProviderFactoryOptions = {},
): HistoricalCandleProvider {
  const priority = resolveProviderPriority(options.provider);

  for (const providerName of priority) {
    if (providerName === "ibkr" && options.ib) {
      return new IbkrHistoricalCandleProvider(options.ib, options.ibkrTimeoutMs);
    }

    if (providerName === "stub") {
      return new StubHistoricalCandleProvider();
    }
  }

  throw new Error("Unable to create a historical candle provider from the supplied options.");
}
