import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveManualWatchlistDurableDirectory } from "../monitoring/manual-watchlist-durable-storage.js";

export type WatchlistDiscordMentions = { everyone: boolean; roles: { id: string; label: string; enabled: boolean }[] };
export type WatchlistDiscordAudience = { everyone: boolean; roles: string[] };
const roleId = /^\d{17,20}$/;
const settingsPath = () => join(resolveManualWatchlistDurableDirectory(), "watchlist-discord-mentions.json");
export function validateDiscordMentions(value: unknown): WatchlistDiscordMentions {
  const v = value as WatchlistDiscordMentions;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["everyone", "roles"].includes(k)) ||
    typeof v.everyone !== "boolean" || !Array.isArray(v.roles) || v.roles.length > 20) throw new Error("Choose valid Discord mention settings (up to 20 roles).");
  const seen = new Set<string>();
  const roles = v.roles.map(r => {
    if (!r || typeof r !== "object" || Object.keys(r).some(k => !["id", "label", "enabled"].includes(k)) ||
      typeof r.id !== "string" || !roleId.test(r.id) || seen.has(r.id) || typeof r.enabled !== "boolean" ||
      typeof r.label !== "string" || !r.label.trim() || r.label.trim().length > 80 || /[\r\n]/.test(r.label)) throw new Error("Each role needs a unique Discord role ID, a label and an on/off choice.");
    seen.add(r.id); return { id: r.id, label: r.label.trim(), enabled: r.enabled };
  });
  return { everyone: v.everyone, roles };
}
export function loadDiscordMentions(path = settingsPath(), premiumRoleId = process.env.DISCORD_PREMIUM_ROLE_ID): WatchlistDiscordMentions {
  if (!existsSync(path)) return { everyone: true, roles: premiumRoleId && roleId.test(premiumRoleId.trim()) ? [{ id: premiumRoleId.trim(), label: "Premium Members", enabled: true }] : [] };
  return validateDiscordMentions(JSON.parse(readFileSync(path, "utf8")));
}
export function saveDiscordMentions(value: unknown, path = settingsPath()): WatchlistDiscordMentions {
  const settings = validateDiscordMentions(value);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
  renameSync(temporary, path);
  return settings;
}
export function discordAudience(settings: WatchlistDiscordMentions): WatchlistDiscordAudience {
  return { everyone: settings.everyone, roles: settings.roles.filter(r => r.enabled).map(r => r.id) };
}
export function currentDiscordAudience(): WatchlistDiscordAudience {
  try { return discordAudience(loadDiscordMentions()); }
  catch { console.warn("Watchlist Discord mention settings unavailable; sending without audience mentions."); return { everyone: false, roles: [] }; }
}
export function appendDiscordMentions(content: string, audience: WatchlistDiscordAudience): string {
  const suffix = [...(audience.everyone ? ["@everyone"] : []), ...audience.roles.map(id => `<@&${id}>`)].join(" ");
  return suffix ? `${content}\n\n${suffix}` : content;
}
export function allowedDiscordMentions(audience?: WatchlistDiscordAudience) {
  return { parse: audience?.everyone ? ["everyone"] : [], roles: audience?.roles.filter(id => roleId.test(id)) ?? [], users: [], replied_user: false };
}
