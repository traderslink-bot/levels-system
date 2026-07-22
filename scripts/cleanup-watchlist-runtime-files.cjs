const { readdirSync, statSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");

const retentionDays = Number.parseFloat(process.env.WATCHLIST_RUNTIME_LOG_RETENTION_DAYS || "3");
const retentionMs = Math.max(0, Number.isFinite(retentionDays) ? retentionDays : 3) * 24 * 60 * 60 * 1000;
const cutoff = Date.now() - retentionMs;
const root = process.cwd();
const runtimeLogPattern = /^manual-watchlist.*\.log$/i;
let deleted = 0;
let reclaimedBytes = 0;

for (const name of readdirSync(root)) {
  if (!runtimeLogPattern.test(name)) continue;
  const path = join(root, name);
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.mtimeMs >= cutoff) continue;
    unlinkSync(path);
    deleted += 1;
    reclaimedBytes += stats.size;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[WatchlistHousekeeping] Could not remove ${name}: ${message}`);
  }
}

if (deleted > 0) {
  console.log(
    `[WatchlistHousekeeping] Removed ${deleted} runtime logs older than ${retentionDays} days (${reclaimedBytes} bytes).`,
  );
}
