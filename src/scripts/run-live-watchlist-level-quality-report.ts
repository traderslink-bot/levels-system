import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE,
  LiveWatchlistAuditArchivePersistence,
  mergeLiveWatchlistPayloadWithArchive,
  payloadFromLiveWatchlistArchive,
} from "../lib/live-watchlist/live-watchlist-audit-archive.js";
import {
  writeLiveWatchlistLevelQualityReport,
  type WatchlistQualityStatePayload,
} from "../lib/review/live-watchlist-level-quality-report.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readRepeatedFlag(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1] as string);
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseHeaders(values: string[]): HeadersInit {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separatorIndex = value.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid --header value "${value}". Expected "Name: value".`);
    }
    const name = value.slice(0, separatorIndex).trim();
    const headerValue = value.slice(separatorIndex + 1).trim();
    if (!name || !headerValue) {
      throw new Error(`Invalid --header value "${value}". Expected "Name: value".`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

function parsePayload(raw: string, source: string): WatchlistQualityStatePayload {
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as WatchlistQualityStatePayload;
  if (!Array.isArray(parsed.symbols)) {
    throw new Error(`${source} is not a live watchlist payload; expected a symbols array.`);
  }
  return parsed;
}

async function readPayload(): Promise<{ payload: WatchlistQualityStatePayload; source: string }> {
  const inputPath = readFlag("--input") ?? process.argv[2];
  if (inputPath) {
    if (!existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    return {
      payload: parsePayload(readFileSync(inputPath, "utf8"), inputPath),
      source: inputPath,
    };
  }

  const url = readFlag("--url");
  if (url) {
    const response = await fetch(url, {
      headers: parseHeaders(readRepeatedFlag("--header")),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return {
      payload: parsePayload(await response.text(), url),
      source: url,
    };
  }

  throw new Error(
    "Provide --input <live-watchlist.json>, --url <api-url>, or --archive-only. Example: npm run audit:live-watchlist-levels -- --input artifacts/live-watchlist-current.json",
  );
}

const outputDirectory = readFlag("--out-dir") ?? join("artifacts", "live-watchlist-level-quality-report");
const archivePath = readFlag("--archive") ?? DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE;
const useArchive = !hasFlag("--current-only");
const archiveOnly = hasFlag("--archive-only");
const writeArchive = useArchive && !hasFlag("--no-archive-write") && !archiveOnly;
const maxFindings = Number(readFlag("--max-findings") ?? 80);
const archivePersistence = new LiveWatchlistAuditArchivePersistence(archivePath);
const input = archiveOnly
  ? {
      payload: payloadFromLiveWatchlistArchive(archivePersistence.load()) as WatchlistQualityStatePayload,
      source: `archive:${archivePersistence.getFilePath()}`,
    }
  : await readPayload();
let payload = input.payload;
let source = input.source;

if (useArchive && !archiveOnly) {
  const archive = writeArchive
    ? archivePersistence.recordPayload(payload)
    : archivePersistence.load();
  payload = mergeLiveWatchlistPayloadWithArchive(payload, archive) as WatchlistQualityStatePayload;
  source = `${source} + archive:${archivePersistence.getFilePath()}`;
}

const report = writeLiveWatchlistLevelQualityReport({
  payload,
  source,
  outputDirectory,
  maxFindings,
});

console.log(
  `Live watchlist level QA: ${report.totals.symbols} symbols, ${report.totals.findings} findings (${report.totals.majorFindings} major, ${report.totals.watchFindings} watch).`,
);
console.log(`Wrote ${join(outputDirectory, "live-watchlist-level-quality-report.json")}`);
console.log(`Wrote ${join(outputDirectory, "live-watchlist-level-quality-report.md")}`);
