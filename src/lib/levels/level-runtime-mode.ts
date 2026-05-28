// 2026-04-18 08:40 AM America/Toronto
// Runtime surfaced-output mode resolution for safe old/new/compare exploration.

export type LevelRuntimeMode = "old" | "new" | "compare";
export type LevelRuntimeCompareActivePath = "old" | "new";

export type ResolvedLevelRuntimeSettings = {
  mode: LevelRuntimeMode;
  compareActivePath: LevelRuntimeCompareActivePath;
  compareLoggingEnabled: boolean;
  rawMode: string | null;
  rawCompareActivePath: string | null;
};

export const LEVEL_RUNTIME_MODE_ENV = "LEVEL_RUNTIME_MODE";
export const LEVEL_RUNTIME_COMPARE_ACTIVE_PATH_ENV = "LEVEL_RUNTIME_COMPARE_ACTIVE_PATH";

function normalizeEnvValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function resolveLevelRuntimeMode(
  value?: string | null,
): LevelRuntimeMode {
  const normalized = normalizeEnvValue(value);

  if (normalized === "new" || normalized === "compare") {
    return normalized;
  }

  return "old";
}

export function resolveLevelRuntimeCompareActivePath(
  value?: string | null,
): LevelRuntimeCompareActivePath {
  return normalizeEnvValue(value) === "new" ? "new" : "old";
}

export function resolveLevelRuntimeSettings(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLevelRuntimeSettings {
  const rawMode = env[LEVEL_RUNTIME_MODE_ENV] ?? null;
  const rawCompareActivePath = env[LEVEL_RUNTIME_COMPARE_ACTIVE_PATH_ENV] ?? null;
  const mode = resolveLevelRuntimeMode(rawMode);
  const compareActivePath = resolveLevelRuntimeCompareActivePath(rawCompareActivePath);

  return {
    mode,
    compareActivePath,
    compareLoggingEnabled: mode === "compare",
    rawMode,
    rawCompareActivePath,
  };
}
