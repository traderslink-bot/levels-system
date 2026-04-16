import type { CandleProviderName } from "./candle-types.js";

export const DEFAULT_PROVIDER_PRIORITY: CandleProviderName[] = [
  "twelve_data",
  "ibkr",
  "stub",
];

export function resolveProviderPriority(
  preferredProvider?: CandleProviderName,
): CandleProviderName[] {
  if (!preferredProvider) {
    return [...DEFAULT_PROVIDER_PRIORITY];
  }

  return [
    preferredProvider,
    ...DEFAULT_PROVIDER_PRIORITY.filter((provider) => provider !== preferredProvider),
  ];
}
