/** Private server-selected workflow; never selected by the ordinary browser body. */
export const SCANNER_LEVELS_EVIDENCE_PROFILE = "scanner-regular-4h-v1" as const;
export const SCANNER_LEVELS_REGULAR_DATASET = "alpaca-sip:regular-et-0930-4h:v1";
export const SCANNER_LEVELS_DAILY_DATASET = "alpaca-sip:native-et-day:v1";
export type StockLevelsEvidenceProfile = typeof SCANNER_LEVELS_EVIDENCE_PROFILE;
