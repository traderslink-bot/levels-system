import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type AiReadAuditEvent = {
  generationId: string;
  requestId: string;
  symbol: string;
  phase: "request" | "response" | "transport_error" | "validation" | "prepared_payload";
  at: number;
  payload: unknown;
};

export type AiReadAuditResult = { saved: boolean; reason?: "oversize" | "capacity" | "storage_error" };

/** Diagnostic artifacts only. Owner revisions must use separate durable storage. */
export class TradersLinkAiReadAuditStore {
  private readonly directory: string;
  private readonly maxArtifactBytes: number;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;

  constructor(options: { directory: string; maxArtifactBytes?: number; maxTotalBytes?: number; retentionMs?: number }) {
    this.directory = resolve(options.directory);
    this.maxArtifactBytes = options.maxArtifactBytes ?? 2 * 1024 * 1024;
    this.maxTotalBytes = options.maxTotalBytes ?? 256 * 1024 * 1024;
    this.retentionMs = options.retentionMs ?? 14 * 24 * 60 * 60 * 1000;
  }

  private key(generationId: string): string {
    return createHash("sha256").update(generationId).digest("hex");
  }

  private files(): Array<{ name: string; bytes: number; modified: number }> {
    return readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}\.(json|complete)$/.test(name))
      .flatMap((name) => {
        const stat = lstatSync(join(this.directory, name));
        return stat.isFile() && !stat.isSymbolicLink()
          ? [{ name, bytes: stat.size, modified: stat.mtimeMs }] : [];
      });
  }

  private makeSpace(requiredBytes: number, currentKey: string, now: number): boolean {
    const files = this.files();
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    const completedKeys = new Set(files.filter((f) => f.name.endsWith(".complete")).map((f) => f.name.slice(0, 64)));
    const candidates = files.filter((f) => f.name.endsWith(".json") && completedKeys.has(f.name.slice(0, 64)) &&
      !f.name.startsWith(currentKey)).sort((a, b) => a.modified - b.modified);
    for (const file of candidates) {
      if (now - file.modified <= this.retentionMs && total + requiredBytes <= this.maxTotalBytes) continue;
      // Names come only from the strict generated-file allowlist above. Never
      // walk another directory or prune owner version/history records here.
      unlinkSync(join(this.directory, file.name));
      const marker = `${file.name.slice(0, 64)}.complete`;
      const markerFile = files.find((f) => f.name === marker);
      if (markerFile) unlinkSync(join(this.directory, marker));
      total -= file.bytes + (markerFile?.bytes ?? 0);
    }
    return total + requiredBytes <= this.maxTotalBytes;
  }

  save(event: AiReadAuditEvent): AiReadAuditResult {
    let temporaryPath: string | undefined;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      if (lstatSync(this.directory).isSymbolicLink()) return { saved: false, reason: "storage_error" };
      const key = this.key(event.generationId);
      const path = join(this.directory, `${key}.json`);
      let events: AiReadAuditEvent[] = [];
      let previousBytes = 0;
      if (existsSync(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxArtifactBytes) {
          return { saved: false, reason: "storage_error" };
        }
        const existing = JSON.parse(readFileSync(path, "utf8")) as { version: number; events: AiReadAuditEvent[] };
        if (existing.version !== 1 || !Array.isArray(existing.events) ||
          existing.events.some((item) => item.generationId !== event.generationId)) {
          return { saved: false, reason: "storage_error" };
        }
        events = existing.events;
        previousBytes = stat.size;
      }
      const serialized = JSON.stringify({ version: 1, events: [...events, event] });
      const bytes = Buffer.byteLength(serialized);
      if (bytes > this.maxArtifactBytes) return { saved: false, reason: "oversize" };
      if (!this.makeSpace(Math.max(0, bytes - previousBytes) + 1, key, event.at)) {
        return { saved: false, reason: "capacity" };
      }
      temporaryPath = join(this.directory, `${key}.${randomUUID()}.tmp`);
      const fd = openSync(temporaryPath, "wx", 0o600);
      try { writeFileSync(fd, serialized, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporaryPath, path);
      temporaryPath = undefined;
      if (event.phase === "transport_error" || event.phase === "validation" || event.phase === "prepared_payload") {
        const marker = join(this.directory, `${key}.complete`);
        if (!existsSync(marker)) writeFileSync(marker, "1", { flag: "wx", mode: 0o600 });
      }
      return { saved: true };
    } catch {
      // Do not expose filesystem details or retry OpenAI because capture failed.
      return { saved: false, reason: "storage_error" };
    } finally {
      if (temporaryPath) { try { unlinkSync(temporaryPath); } catch { /* best-effort own temp cleanup */ } }
    }
  }

  read(generationId: string): { version: 1; events: AiReadAuditEvent[] } | null {
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink()) throw new Error("Audit unavailable");
    const path = join(this.directory, `${this.key(generationId)}.json`);
    if (!existsSync(path)) return null;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxArtifactBytes) throw new Error("Audit unavailable");
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.version !== 1 || !Array.isArray(record.events) ||
      record.events.some((event: AiReadAuditEvent) => event.generationId !== generationId)) throw new Error("Audit unavailable");
    return record;
  }
}
