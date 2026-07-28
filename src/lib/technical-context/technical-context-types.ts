export type TechnicalContextConfidence = "high" | "medium" | "low" | "unavailable";

export type TechnicalContext = {
  source: "levels_system_intraday";
  sourceTimeframe: "5m";
  provider: string | null;
  sessionDate: string | null;
  updatedAt: number | null;
  candleCount: number;
  currentPrice: number | null;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  priceVsVwapPct: number | null;
  priceVsEma9Pct: number | null;
  priceVsEma20Pct: number | null;
  aboveVwap: boolean | null;
  aboveEma9: boolean | null;
  aboveEma20: boolean | null;
  confidence: TechnicalContextConfidence;
  diagnostics: string[];
};
