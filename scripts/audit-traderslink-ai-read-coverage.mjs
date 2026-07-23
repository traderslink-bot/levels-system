import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const archivePath = resolve(process.argv[2] ?? "data/traderslink-ai-reads/archive.json");
const outputDirectory = resolve(process.argv[3] ?? "artifacts");
const archive = JSON.parse(readFileSync(archivePath, "utf8"));
const records = Array.isArray(archive) ? archive : archive.records;
if (!Array.isArray(records)) throw new Error("Archive must contain a records array.");

function text(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function price(value) {
  if (value && typeof value === "object" && Number.isFinite(value.price)) return Number(value.price);
  const match = text(value).match(/(?:^|[;{\s])price=([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

function targetPrices(value) {
  if (Array.isArray(value)) return value.map(price).filter(Number.isFinite);
  const raw = text(value);
  return [...raw.matchAll(/(?:^|[;{\s])price=([0-9]+(?:\.[0-9]+)?)/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

function realizedExpansionPct(read) {
  const combined = [read.currentRead, read.riskSummary, read.needsToHold, read.mustClear]
    .map(text)
    .join(" ");
  const candidates = [...combined.matchAll(/([0-9]+(?:\.[0-9]+)?)%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 10 && value <= 2_000);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function observedUpsideType(read) {
  const combined = `${text(read.mustClear)} ${text(read.breakoutContinuation)} ${text(read.currentRead)}`.toLowerCase();
  if (/current[- ]session high|session high|after-hours high|premarket high/.test(combined)) return "current_session";
  if (/prior[- ]session|prior regular|prior after-hours/.test(combined)) return "prior_session";
  if (/daily high|daily recovery|recent daily/.test(combined)) return "recent_daily";
  return "not_documented";
}

function auditRecord(record, index) {
  const read = record.read ?? record;
  const currentPrice = Number(read.currentPrice);
  const continuation = price(read.breakoutContinuation);
  const targets = targetPrices(read.targets);
  const explicit = read.forwardPlan && typeof read.forwardPlan === "object";
  const explicitPrices = explicit
    ? ["nearestRealistic", "continuedMomentum", "strongExpansion", "extremeMomentum"]
        .map((name) => read.forwardPlan[name])
        .map((horizon) => horizon?.available ? Number(horizon.price) : null)
    : null;
  const horizonPrices = explicitPrices ?? [continuation, targets[0] ?? null, targets[1] ?? null, targets[2] ?? null];
  const outer = horizonPrices.filter(Number.isFinite).at(-1) ?? null;
  const forwardCoveragePct = Number.isFinite(currentPrice) && currentPrice > 0 && outer !== null
    ? Number(((outer - currentPrice) / currentPrice * 100).toFixed(2))
    : null;
  const realized = realizedExpansionPct(read);
  const ratio = forwardCoveragePct !== null && realized
    ? Number((forwardCoveragePct / realized).toFixed(3))
    : null;
  const missing = horizonPrices
    .map((value, horizonIndex) => value === null ? ["nearestRealistic", "continuedMomentum", "strongExpansion", "extremeMomentum"][horizonIndex] : null)
    .filter(Boolean);
  const unavailableReasons = explicit
    ? ["nearestRealistic", "continuedMomentum", "strongExpansion", "extremeMomentum"]
        .flatMap((name) => read.forwardPlan[name]?.available === false
          ? [`${name}:${read.forwardPlan[name]?.unavailableReasonCode ?? "reason_missing"}`]
          : [])
    : [];
  const compressed = ratio !== null
    ? ratio < 0.35
    : realized !== null && realized >= 30 && (forwardCoveragePct === null || forwardCoveragePct < 10);
  const failureCodes = [];
  if (!explicit) failureCodes.push("FORWARD_PLAN_MISSING");
  if (missing.length > 0) failureCodes.push("FORWARD_HORIZONS_MISSING");
  if (compressed) failureCodes.push("LEGACY_FORWARD_MAP_COMPRESSED");
  if (horizonPrices.every((value) => value === null)) failureCodes.push("FORWARD_MAP_EMPTY");
  return {
    index: index + 1,
    symbol: record.symbol ?? read.symbol ?? "UNKNOWN",
    version: read.version ?? null,
    generationId: record.generationId ?? read.generationId ?? null,
    generatedAtIso: record.generatedAtIso ?? (read.generatedAt ? new Date(read.generatedAt).toISOString() : null),
    referencePrice: Number.isFinite(currentPrice) ? currentPrice : null,
    highestObservedUpsideType: observedUpsideType(read),
    horizons: {
      nearestRealistic: horizonPrices[0] !== null ? "present" : "missing",
      continuedMomentum: horizonPrices[1] !== null ? "present" : "missing",
      strongExpansion: horizonPrices[2] !== null ? "present" : "missing",
      extremeMomentum: horizonPrices[3] !== null ? "present" : "missing",
    },
    horizonPrices,
    missingHorizons: missing,
    unavailableReasons,
    realizedExpansionPct: realized,
    forwardCoveragePct,
    coverageToRealizedExpansionRatio: ratio,
    compressionFlag: compressed,
    outerDocumentedAsFarScenarioOrUnavailable: horizonPrices[3] !== null || unavailableReasons.some((item) => item.startsWith("extremeMomentum:")),
    newValidatorResult: failureCodes.length === 0 ? "pass" : "fail",
    failureCodes,
  };
}

const audits = records.map(auditRecord);
const namedCases = ["PN", "BIYA", "STKH", "MTEN"];
const report = {
  schemaVersion: 1,
  archivePath,
  archiveRecordCount: records.length,
  auditedRecordCount: audits.length,
  deterministic: true,
  liveApiCalls: 0,
  summary: {
    explicitForwardPlanCount: audits.filter((item) => !item.failureCodes.includes("FORWARD_PLAN_MISSING")).length,
    emptyForwardMapCount: audits.filter((item) => item.failureCodes.includes("FORWARD_MAP_EMPTY")).length,
    missingStrongExpansionCount: audits.filter((item) => item.horizons.strongExpansion === "missing").length,
    missingExtremeMomentumCount: audits.filter((item) => item.horizons.extremeMomentum === "missing").length,
    compressedCount: audits.filter((item) => item.compressionFlag).length,
    newValidatorFailureCount: audits.filter((item) => item.newValidatorResult === "fail").length,
  },
  namedCases: Object.fromEntries(namedCases.map((symbol) => [symbol, audits.filter((item) => item.symbol === symbol)])),
  records: audits,
};

const markdown = [
  "# TradersLink AI Read complete-wide archive audit",
  "",
  `- Archived reads audited: ${report.auditedRecordCount}`,
  `- Live API calls: ${report.liveApiCalls}`,
  `- Reads with an explicit complete-wide forward plan: ${report.summary.explicitForwardPlanCount}`,
  `- Empty legacy forward maps: ${report.summary.emptyForwardMapCount}`,
  `- Reads missing strong-expansion coverage: ${report.summary.missingStrongExpansionCount}`,
  `- Reads missing extreme-momentum coverage: ${report.summary.missingExtremeMomentumCount}`,
  `- Compression flags: ${report.summary.compressedCount}`,
  `- Reads rejected by the new explicit contract: ${report.summary.newValidatorFailureCount}`,
  "",
  "## Named cases",
  "",
  "| Symbol | Reads | Nearest | Continued | Strong | Extreme | Compression | New validator |",
  "| --- | ---: | --- | --- | --- | --- | --- | --- |",
  ...namedCases.map((symbol) => {
    const cases = report.namedCases[symbol];
    const last = cases.at(-1);
    if (!last) return `| ${symbol} | 0 | missing | missing | missing | missing | n/a | no archived case |`;
    return `| ${symbol} | ${cases.length} | ${last.horizons.nearestRealistic} | ${last.horizons.continuedMomentum} | ${last.horizons.strongExpansion} | ${last.horizons.extremeMomentum} | ${last.compressionFlag ? "flagged" : "not flagged"} | ${last.newValidatorResult}: ${last.failureCodes.join(", ")} |`;
  }),
  "",
  "## Per-read audit",
  "",
  "| # | Symbol | v | Reference | Realized % | Forward % | Ratio | Missing horizons | Compression | Validator |",
  "| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
  ...audits.map((item) => `| ${item.index} | ${item.symbol} | ${item.version ?? "?"} | ${item.referencePrice ?? "n/a"} | ${item.realizedExpansionPct ?? "n/a"} | ${item.forwardCoveragePct ?? "n/a"} | ${item.coverageToRealizedExpansionRatio ?? "n/a"} | ${item.missingHorizons.join(", ") || "none"} | ${item.compressionFlag ? "flagged" : "no"} | ${item.newValidatorResult}: ${item.failureCodes.join(", ") || "none"} |`),
  "",
  "Legacy v2/v3 records do not contain the authoritative input packets, so realized expansion is extracted only when the archived read explicitly states a percentage. Missing values are reported as unavailable, never fabricated.",
  "",
].join("\n");

mkdirSync(outputDirectory, { recursive: true });
const jsonPath = resolve(outputDirectory, "traderslink-ai-read-complete-wide-archive-audit.json");
const markdownPath = resolve(outputDirectory, "traderslink-ai-read-complete-wide-archive-audit.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, markdown, "utf8");
console.log(JSON.stringify({ jsonPath, markdownPath, summary: report.summary }, null, 2));
