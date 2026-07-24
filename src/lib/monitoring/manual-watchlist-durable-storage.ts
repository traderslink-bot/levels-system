import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DURABLE_DIRECTORY_ENV = "TRADERSLINK_MANUAL_WATCHLIST_DATA_DIR";

export function resolveManualWatchlistDurableDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[DURABLE_DIRECTORY_ENV]?.trim();
  if (override) return override;
  const localAppData = env.LOCALAPPDATA?.trim();
  return localAppData
    ? join(localAppData, "TradersLink", "levels-system-v2")
    : join(homedir(), ".traderslink", "levels-system-v2");
}

export function resolveDurableManualWatchlistFile(fileName: string): string {
  return join(resolveManualWatchlistDurableDirectory(), fileName);
}

export function migrateLegacyManualWatchlistFile(
  durablePath: string,
  legacyPath: string,
): void {
  if (existsSync(durablePath) || !existsSync(legacyPath)) return;
  mkdirSync(resolveManualWatchlistDurableDirectory(), { recursive: true });
  copyFileSync(legacyPath, durablePath);
  console.log(
    `[ManualWatchlistRuntime] Migrated persistent data from ${legacyPath} to ${durablePath}.`,
  );
}
