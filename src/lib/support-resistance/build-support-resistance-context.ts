// 2026-05-27 09:20 PM America/Toronto
// Public rescue-safe builder for shared support/resistance context.

import {
  buildSymbolSupportResistanceContext,
  type BuildSymbolSupportResistanceContextRequest,
  type SymbolSupportResistanceContext,
} from "./symbol-context.js";

export type BuildSupportResistanceContextRequest = BuildSymbolSupportResistanceContextRequest;
export type SupportResistanceContext = SymbolSupportResistanceContext;

export function buildSupportResistanceContext(
  request: BuildSupportResistanceContextRequest,
): SupportResistanceContext {
  return buildSymbolSupportResistanceContext(request);
}
