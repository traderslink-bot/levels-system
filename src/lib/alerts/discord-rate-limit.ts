import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DiscordRateLimit } from "./discord-confirmed-rejection.js";

/** Shared bot cooldown; stores no credentials, URLs or message contents. */
export class DiscordCooldown {
  private value: DiscordRateLimit | undefined;
  constructor(private readonly file?: string, private readonly now = Date.now) {
    if (file && existsSync(file)) {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (!Number.isSafeInteger(value.retryAt) || typeof value.scope !== "string" || typeof value.reason !== "string") throw new Error("Invalid Discord cooldown record.");
      this.value = value;
    }
  }
  current(): DiscordRateLimit | undefined { return this.value && this.value.retryAt > this.now() ? this.value : undefined; }
  record(value: DiscordRateLimit): void {
    if (!Number.isSafeInteger(value.retryAt)) throw new Error("Invalid Discord cooldown time.");
    this.value = this.current() && this.value!.retryAt > value.retryAt ? this.value : value;
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + ".tmp", JSON.stringify(this.value), { mode: 0o600 });
      renameSync(this.file + ".tmp", this.file);
    }
  }
}
