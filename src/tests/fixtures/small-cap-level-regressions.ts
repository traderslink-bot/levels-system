import type { LevelSnapshotDisplayZone, LevelSnapshotPayload } from "../../lib/alerts/alert-types.js";

export type SmallCapLevelRegressionFixture = {
  symbol: "JLHL" | "VRAX" | "CHSN" | "FTRK" | "GFUZ" | "PMA";
  currentPrice: number;
  supportZones: LevelSnapshotDisplayZone[];
  resistanceZones: LevelSnapshotDisplayZone[];
  roleFlipContext?: LevelSnapshotPayload["roleFlipContext"];
  specialLevels?: LevelSnapshotPayload["specialLevels"];
  levelDataQuality: NonNullable<LevelSnapshotPayload["levelDataQuality"]>;
  expected: "testing_flip" | "confirmed_flip" | "catalyst_references" | "dense_ladder" | "unavailable" | "intraday_only";
};

const zone = (
  representativePrice: number,
  strengthLabel: LevelSnapshotDisplayZone["strengthLabel"],
  sourceLabel: string,
): LevelSnapshotDisplayZone => ({
  representativePrice,
  lowPrice: representativePrice * 0.9975,
  highPrice: representativePrice * 1.0025,
  strengthLabel,
  freshness: "fresh",
  sourceLabel,
});

export const SMALL_CAP_LEVEL_REGRESSION_FIXTURES: SmallCapLevelRegressionFixture[] = [
  {
    symbol: "JLHL",
    currentPrice: 1.051,
    supportZones: [zone(1.01, "strong", "4h structure")],
    resistanceZones: [zone(1.05, "strong", "premarket high"), zone(1.12, "major", "daily structure")],
    roleFlipContext: { bidPrice: 1.048, askPrice: 1.054, atrPct: 0.08, tickSize: 0.01 },
    levelDataQuality: { status: "full", availableTimeframes: ["daily", "4h", "5m"], flags: [] },
    expected: "testing_flip",
  },
  {
    symbol: "VRAX",
    currentPrice: 6.5,
    supportZones: [zone(5.8, "strong", "4h structure")],
    resistanceZones: [zone(6, "major", "daily structure"), zone(13.35, "strong", "daily structure")],
    roleFlipContext: { atrPct: 0.025, tickSize: 0.01 },
    levelDataQuality: { status: "full", availableTimeframes: ["daily", "4h", "5m"], flags: [] },
    expected: "confirmed_flip",
  },
  {
    symbol: "CHSN",
    currentPrice: 3.2,
    supportZones: [zone(3.05, "strong", "opening range low")],
    resistanceZones: [zone(3.35, "strong", "opening range high"), zone(3.8, "major", "daily structure")],
    specialLevels: {
      premarketHigh: 3.42,
      premarketLow: 2.81,
      openingRangeHigh: 3.35,
      openingRangeLow: 3.05,
      currentSessionHigh: 3.51,
      currentSessionLow: 2.96,
      previousDayHigh: 2.74,
      previousDayLow: 2.31,
      previousDayClose: 2.55,
    },
    levelDataQuality: { status: "full", availableTimeframes: ["daily", "4h", "5m"], flags: [] },
    expected: "catalyst_references",
  },
  {
    symbol: "FTRK",
    currentPrice: 0.65,
    supportZones: [zone(0.62, "strong", "4h structure"), zone(0.58, "moderate", "fresh intraday")],
    resistanceZones: [
      zone(0.66, "moderate", "fresh intraday"),
      zone(0.7, "major", "daily structure"),
      zone(0.75, "moderate", "4h structure"),
      zone(0.8, "weak", "fresh intraday"),
      zone(0.92, "strong", "daily structure"),
    ],
    levelDataQuality: { status: "full", availableTimeframes: ["daily", "4h", "5m"], flags: [] },
    expected: "dense_ladder",
  },
  {
    symbol: "GFUZ",
    currentPrice: 2.4,
    supportZones: [],
    resistanceZones: [],
    levelDataQuality: { status: "unavailable", availableTimeframes: [], flags: ["daily:zero_results", "4h:zero_results", "5m:zero_results"] },
    expected: "unavailable",
  },
  {
    symbol: "PMA",
    currentPrice: 0.44,
    supportZones: [zone(0.41, "moderate", "fresh intraday")],
    resistanceZones: [zone(0.48, "moderate", "fresh intraday"), zone(0.55, "strong", "opening range high")],
    specialLevels: { openingRangeHigh: 0.55, openingRangeLow: 0.41, currentSessionHigh: 0.52, currentSessionLow: 0.39 },
    levelDataQuality: { status: "limited", availableTimeframes: ["5m"], flags: ["daily:unavailable", "4h:unavailable"] },
    expected: "intraday_only",
  },
];
