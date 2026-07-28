import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";

type AuditEntry = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  snapshotAudit?: {
    referencePrice?: number;
    omittedSupportLevels?: SnapshotAuditLevel[];
    omittedResistanceLevels?: SnapshotAuditLevel[];
  };
};

type SnapshotAuditLevel = {
  side?: "support" | "resistance";
  representativePrice?: number;
  zoneLow?: number;
  zoneHigh?: number;
  strengthLabel?: string;
  sourceLabel?: string;
  omittedReason?: string;
};

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type LadderLevel = {
  line: string;
  low: number;
  high: number;
  representativePrice: number;
};

type SnapshotPost = {
  session: string;
  auditPath: string;
  symbol: string;
  price: number;
  timestamp?: number;
  resistance: LadderLevel[];
  support: LadderLevel[];
};

export type LadderGapLevelAuditOptions = {
  inputPath: string;
  warehouseDirectoryPath?: string;
  provider?: string;
  outputDirectory: string;
  allSessions?: boolean;
  minGapPct?: number;
  maxGapDistancePct?: number;
  maxFindings?: number;
};

export type LadderGapLevelFinding = {
  kind: "hidden_gap_zone" | "near_wrong_side_level";
  session: string;
  symbol: string;
  side: "support" | "resistance";
  price: number;
  severity: "major" | "watch";
  score: number;
  summary: string;
  evidence: string[];
  postedGap?: {
    from: string;
    to: string;
    gapPct: number;
  };
  candidateZone?: {
    low: number;
    high: number;
    center: number;
    relativePct: number;
  };
};

export type LadderGapLevelAuditReport = {
  generatedAt: string;
  inputPath: string;
  warehouseDirectoryPath: string;
  totals: {
    auditFiles: number;
    snapshots: number;
    symbols: number;
    hiddenGapZones: number;
    nearWrongSideLevels: number;
  };
  findings: LadderGapLevelFinding[];
};

type OhlcTouch = {
  value: number;
  timeframe: "daily" | "4h";
  kind: "high" | "low" | "bodyHigh" | "bodyLow";
  timestamp: number;
};

type OhlcCluster = {
  low: number;
  high: number;
  center: number;
  spanPct: number;
  touches: number;
  uniqueCandles: number;
  dailyTouches: number;
  fourHourTouches: number;
  score: number;
};

function parseJsonLine(line: string): AuditEntry | undefined {
  try {
    return JSON.parse(line) as AuditEntry;
  } catch {
    return undefined;
  }
}

function walkDiscordAuditFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkDiscordAuditFiles(fullPath));
    } else if (entry.isFile() && entry.name === "discord-delivery-audit.jsonl") {
      output.push(fullPath);
    }
  }
  return output.sort();
}

function resolveAuditFiles(inputPath: string, allSessions: boolean): string[] {
  if (inputPath.endsWith(".jsonl")) {
    return [inputPath];
  }
  if (allSessions) {
    return walkDiscordAuditFiles(inputPath);
  }
  return [join(inputPath, "discord-delivery-audit.jsonl")];
}

function parseReferencePrice(body: string): number | undefined {
  const match = body.match(/Price:\s*([0-9]*\.?[0-9]+)/i);
  return match ? Number(match[1]) : undefined;
}

function parseLadderLevels(body: string, side: "Support" | "Resistance"): LadderLevel[] {
  const lines = body.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === `${side.toLowerCase()}:`);
  if (startIndex < 0) {
    return [];
  }

  const levels: LadderLevel[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      break;
    }
    if (/^(support|resistance|what|key levels|more support|triggered near)/i.test(line)) {
      break;
    }
    if (/^none$/i.test(line)) {
      continue;
    }

    const zoneMatch = line.match(/([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)\s*(?:zone|area)?/i);
    if (zoneMatch) {
      const low = Math.min(Number(zoneMatch[1]), Number(zoneMatch[2]));
      const high = Math.max(Number(zoneMatch[1]), Number(zoneMatch[2]));
      if (Number.isFinite(low) && Number.isFinite(high)) {
        levels.push({ line, low, high, representativePrice: (low + high) / 2 });
      }
      continue;
    }

    const priceMatch = line.match(/[0-9]*\.?[0-9]+/);
    if (!priceMatch) {
      continue;
    }
    const price = Number(priceMatch[0]);
    if (Number.isFinite(price)) {
      levels.push({ line, low: price, high: price, representativePrice: price });
    }
  }

  return levels;
}

function readSnapshots(auditPath: string): SnapshotPost[] {
  if (!existsSync(auditPath)) {
    return [];
  }
  const session = basename(dirname(auditPath));
  const snapshots: SnapshotPost[] = [];
  for (const line of readFileSync(auditPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const entry = parseJsonLine(line);
    if (
      entry?.operation !== "post_level_snapshot" ||
      entry.status !== "posted" ||
      !entry.symbol ||
      !entry.body
    ) {
      continue;
    }
    const price = entry.snapshotAudit?.referencePrice ?? parseReferencePrice(entry.body);
    if (!Number.isFinite(price)) {
      continue;
    }
    snapshots.push({
      session,
      auditPath,
      symbol: entry.symbol.toUpperCase(),
      price: price as number,
      timestamp: entry.sourceTimestamp ?? entry.timestamp,
      resistance: parseLadderLevels(entry.body, "Resistance").sort((left, right) => left.low - right.low),
      support: parseLadderLevels(entry.body, "Support").sort((left, right) => right.high - left.high),
    });
  }
  return snapshots;
}

function readAuditEntries(auditPath: string): AuditEntry[] {
  if (!existsSync(auditPath)) {
    return [];
  }
  return readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseJsonLine)
    .filter((entry): entry is AuditEntry => entry !== undefined);
}

const candleCache = new Map<string, Candle[]>();

function readCandles(params: {
  warehouseDirectoryPath: string;
  provider: string;
  symbol: string;
  timeframe: "daily" | "4h";
  untilTimestamp?: number;
}): Candle[] {
  const cacheKey = `${params.warehouseDirectoryPath}|${params.provider}|${params.symbol}|${params.timeframe}`;
  let candles = candleCache.get(cacheKey);
  if (!candles) {
    candles = [];
    const directory = join(params.warehouseDirectoryPath, params.provider, params.symbol, params.timeframe);
    if (existsSync(directory)) {
      for (const file of readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort()) {
        for (const line of readFileSync(join(directory, file), "utf8").split(/\r?\n/)) {
          if (!line.trim()) {
            continue;
          }
          const parsed = parseJsonLine(line) as Partial<Candle> | undefined;
          if (
            parsed &&
            Number.isFinite(parsed.timestamp) &&
            Number.isFinite(parsed.open) &&
            Number.isFinite(parsed.high) &&
            Number.isFinite(parsed.low) &&
            Number.isFinite(parsed.close)
          ) {
            candles.push(parsed as Candle);
          }
        }
      }
    }
    candles.sort((left, right) => left.timestamp - right.timestamp);
    candleCache.set(cacheKey, candles);
  }

  return candles
    .filter((candle) => params.untilTimestamp === undefined || candle.timestamp <= params.untilTimestamp)
    .slice(-520);
}

function clusterOhlcTouches(touches: OhlcTouch[]): OhlcCluster[] {
  const sorted = [...touches].sort((left, right) => left.value - right.value);
  const clusters: Array<{ touches: OhlcTouch[]; sum: number; low: number; high: number }> = [];

  for (const touch of sorted) {
    const target = clusters.find((cluster) => {
      const center = cluster.sum / cluster.touches.length;
      const tolerance = Math.max(0.015, center * 0.035);
      return Math.abs(touch.value - center) <= tolerance;
    });
    if (target) {
      target.touches.push(touch);
      target.sum += touch.value;
      target.low = Math.min(target.low, touch.value);
      target.high = Math.max(target.high, touch.value);
    } else {
      clusters.push({ touches: [touch], sum: touch.value, low: touch.value, high: touch.value });
    }
  }

  return clusters
    .map((cluster) => {
      const center = cluster.sum / cluster.touches.length;
      const uniqueCandles = new Set(cluster.touches.map((touch) => `${touch.timeframe}:${touch.timestamp}`)).size;
      const dailyTouches = cluster.touches.filter((touch) => touch.timeframe === "daily").length;
      const fourHourTouches = cluster.touches.filter((touch) => touch.timeframe === "4h").length;
      const spanPct = ((cluster.high - cluster.low) / center) * 100;
      let score = uniqueCandles + Math.min(cluster.touches.length / 2, 20);
      if (dailyTouches > 0) {
        score += 4;
      }
      if (fourHourTouches > 0) {
        score += 2;
      }
      if (spanPct <= 2.5) {
        score += 4;
      }
      if (cluster.touches.length > 90) {
        score -= 8;
      }
      if (uniqueCandles > 70) {
        score -= 6;
      }
      return {
        low: cluster.low,
        high: cluster.high,
        center,
        spanPct,
        touches: cluster.touches.length,
        uniqueCandles,
        dailyTouches,
        fourHourTouches,
        score,
      };
    })
    .filter((cluster) => (
      cluster.uniqueCandles >= 4 &&
      cluster.touches >= 6 &&
      cluster.spanPct <= 5.5 &&
      cluster.touches <= 90
    ))
    .sort((left, right) => right.score - left.score);
}

function findOhlcClustersInGap(params: {
  warehouseDirectoryPath: string;
  provider: string;
  symbol: string;
  low: number;
  high: number;
  untilTimestamp?: number;
}): OhlcCluster[] {
  const touches: OhlcTouch[] = [];
  for (const timeframe of ["daily", "4h"] as const) {
    for (const candle of readCandles({
      warehouseDirectoryPath: params.warehouseDirectoryPath,
      provider: params.provider,
      symbol: params.symbol,
      timeframe,
      untilTimestamp: params.untilTimestamp,
    })) {
      const bodyHigh = Math.max(candle.open, candle.close);
      const bodyLow = Math.min(candle.open, candle.close);
      for (const [kind, value] of [
        ["high", candle.high],
        ["low", candle.low],
        ["bodyHigh", bodyHigh],
        ["bodyLow", bodyLow],
      ] as const) {
        if (value > params.low && value < params.high) {
          touches.push({ value, timeframe, kind, timestamp: candle.timestamp });
        }
      }
    }
  }

  return clusterOhlcTouches(touches);
}

function formatPrice(value: number): string {
  if (value >= 10) {
    return value.toFixed(2).replace(/\.00$/, "");
  }
  if (value >= 1) {
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function severityForScore(score: number, gapPct: number, relativePct: number): "major" | "watch" {
  if (score >= 32 && gapPct >= 10 && Math.abs(relativePct) <= 35) {
    return "major";
  }
  return "watch";
}

function hiddenGapFindingsForSnapshot(params: {
  snapshot: SnapshotPost;
  warehouseDirectoryPath: string;
  provider: string;
  minGapPct: number;
  maxGapDistancePct: number;
}): LadderGapLevelFinding[] {
  const findings: LadderGapLevelFinding[] = [];
  for (const side of ["resistance", "support"] as const) {
    const levels = params.snapshot[side];
    for (let index = 0; index < Math.min(levels.length - 1, 8); index += 1) {
      const near = levels[index];
      const far = levels[index + 1];
      if (!near || !far) {
        continue;
      }
      const gapLow = side === "resistance" ? near.high : far.high;
      const gapHigh = side === "resistance" ? far.low : near.low;
      if (gapHigh <= gapLow) {
        continue;
      }
      const gapPct = ((gapHigh - gapLow) / params.snapshot.price) * 100;
      if (gapPct < params.minGapPct) {
        continue;
      }
      const distancePct = (Math.min(
        Math.abs(gapLow - params.snapshot.price),
        Math.abs(gapHigh - params.snapshot.price),
      ) / params.snapshot.price) * 100;
      if (distancePct > params.maxGapDistancePct) {
        continue;
      }

      const clusters = findOhlcClustersInGap({
        warehouseDirectoryPath: params.warehouseDirectoryPath,
        provider: params.provider,
        symbol: params.snapshot.symbol,
        low: gapLow,
        high: gapHigh,
        untilTimestamp: params.snapshot.timestamp,
      });
      for (const cluster of clusters.slice(0, 2)) {
        const boundaryTolerance = Math.max(params.snapshot.price * 0.012, cluster.center * 0.012, 0.01);
        if (cluster.low <= gapLow + boundaryTolerance || cluster.high >= gapHigh - boundaryTolerance) {
          continue;
        }
        const relativePct = ((cluster.center - params.snapshot.price) / params.snapshot.price) * 100;
        const score = cluster.score + Math.min(gapPct / 3, 8);
        findings.push({
          kind: "hidden_gap_zone",
          session: params.snapshot.session,
          symbol: params.snapshot.symbol,
          side,
          price: params.snapshot.price,
          severity: severityForScore(score, gapPct, relativePct),
          score,
          summary: `${params.snapshot.symbol} ${side} ladder may hide a practical ${formatPrice(cluster.low)}-${formatPrice(cluster.high)} zone inside the posted ${formatPrice(gapLow)} to ${formatPrice(gapHigh)} gap.`,
          evidence: [
            `Posted gap: ${near.line} -> ${far.line}`,
            `Candidate zone: ${formatPrice(cluster.low)}-${formatPrice(cluster.high)} (${pct(relativePct)} from price).`,
            `Warehouse evidence: ${cluster.uniqueCandles} candles / ${cluster.touches} OHLC touches; daily ${cluster.dailyTouches}, 4h ${cluster.fourHourTouches}; span ${cluster.spanPct.toFixed(1)}%.`,
          ],
          postedGap: {
            from: near.line,
            to: far.line,
            gapPct,
          },
          candidateZone: {
            low: cluster.low,
            high: cluster.high,
            center: cluster.center,
            relativePct,
          },
        });
      }
    }
  }
  return findings;
}

function wrongSideFindingsForAudit(auditPath: string): LadderGapLevelFinding[] {
  const session = basename(dirname(auditPath));
  const findings: LadderGapLevelFinding[] = [];
  for (const entry of readAuditEntries(auditPath)) {
    if (
      entry.operation !== "post_level_snapshot" ||
      entry.status !== "posted" ||
      !entry.symbol ||
      !entry.body
    ) {
      continue;
    }
    const price = entry.snapshotAudit?.referencePrice ?? parseReferencePrice(entry.body);
    if (!Number.isFinite(price)) {
      continue;
    }
    const omitted = [
      ...(entry.snapshotAudit?.omittedSupportLevels ?? []),
      ...(entry.snapshotAudit?.omittedResistanceLevels ?? []),
    ];
    for (const level of omitted) {
      if (
        level.omittedReason !== "wrong_side" ||
        !level.side ||
        !Number.isFinite(level.representativePrice)
      ) {
        continue;
      }
      const levelPrice = level.representativePrice as number;
      const distancePct = (Math.abs(levelPrice - (price as number)) / (price as number)) * 100;
      if (distancePct > 12) {
        continue;
      }
      if (!["moderate", "strong", "heavy", "major"].includes(level.strengthLabel ?? "")) {
        continue;
      }
      const score = 30 - distancePct + (level.strengthLabel === "major" ? 6 : 0) + (level.strengthLabel === "heavy" ? 4 : 0);
      findings.push({
        kind: "near_wrong_side_level",
        session,
        symbol: entry.symbol.toUpperCase(),
        side: level.side,
        price: price as number,
        severity: distancePct <= 3 ? "major" : "watch",
        score,
        summary: `${entry.symbol.toUpperCase()} had ${level.strengthLabel} ${level.side} ${formatPrice(levelPrice)} omitted as wrong-side while only ${distancePct.toFixed(1)}% from price.`,
        evidence: [
          `Reference price: ${formatPrice(price as number)}.`,
          `Omitted level: ${formatPrice(levelPrice)} ${level.strengthLabel ?? "unknown"} ${level.side}; source ${level.sourceLabel ?? "unknown"}.`,
          "Trader-story read: this should usually be shown as reclaim resistance or hold support instead of disappearing.",
        ],
        candidateZone: {
          low: level.zoneLow ?? levelPrice,
          high: level.zoneHigh ?? levelPrice,
          center: levelPrice,
          relativePct: ((levelPrice - (price as number)) / (price as number)) * 100,
        },
      });
    }
  }
  return findings;
}

function dedupeFindings(findings: LadderGapLevelFinding[]): LadderGapLevelFinding[] {
  const best = new Map<string, LadderGapLevelFinding>();
  for (const finding of findings) {
    const center = finding.candidateZone?.center ?? finding.price;
    const bucket = Math.round(center / Math.max(center * 0.035, 0.01));
    const key = `${finding.kind}|${finding.symbol}|${finding.side}|${bucket}`;
    const previous = best.get(key);
    if (!previous || finding.score > previous.score) {
      best.set(key, finding);
    }
  }
  return [...best.values()].sort((left, right) => right.score - left.score);
}

function renderMarkdown(report: LadderGapLevelAuditReport): string {
  const lines: string[] = [];
  lines.push("# Ladder Gap Level Audit");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Audit files: ${report.totals.auditFiles}`);
  lines.push(`- Snapshot posts: ${report.totals.snapshots}`);
  lines.push(`- Symbols: ${report.totals.symbols}`);
  lines.push(`- Hidden gap zones: ${report.totals.hiddenGapZones}`);
  lines.push(`- Near wrong-side levels: ${report.totals.nearWrongSideLevels}`);
  lines.push("");
  lines.push("## How To Use This");
  lines.push("");
  lines.push("Use this as tuning evidence, not as an automatic verdict. The useful cases are the ones where the posted ladder made the trade path look cleaner than the warehouse candles suggest.");
  lines.push("");
  lines.push("Prioritize:");
  lines.push("");
  lines.push("- `hidden_gap_zone` findings where the missing area would become the next breakout target, reclaim line, or failure zone.");
  lines.push("- `near_wrong_side_level` findings where a good level disappeared even though it should have flipped roles.");
  lines.push("- Repeated examples across multiple symbols before changing global level-detection thresholds.");
  lines.push("");
  lines.push("## Top Findings");
  lines.push("");
  for (const finding of report.findings) {
    lines.push(`### ${finding.severity.toUpperCase()} ${finding.symbol} ${finding.kind}`);
    lines.push("");
    lines.push(`- Session: ${finding.session}`);
    lines.push(`- Side: ${finding.side}`);
    lines.push(`- Price: ${formatPrice(finding.price)}`);
    lines.push(`- Score: ${finding.score.toFixed(1)}`);
    lines.push(`- Summary: ${finding.summary}`);
    for (const evidence of finding.evidence) {
      lines.push(`- Evidence: ${evidence}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function writeLadderGapLevelAudit(options: LadderGapLevelAuditOptions): LadderGapLevelAuditReport {
  const provider = options.provider ?? "ibkr";
  const warehouseDirectoryPath = options.warehouseDirectoryPath ?? "data/candles";
  const auditFiles = resolveAuditFiles(options.inputPath, options.allSessions ?? false).filter(existsSync);
  const snapshots = auditFiles.flatMap(readSnapshots);
  const hiddenGapFindings = snapshots.flatMap((snapshot) => hiddenGapFindingsForSnapshot({
    snapshot,
    warehouseDirectoryPath,
    provider,
    minGapPct: options.minGapPct ?? 8,
    maxGapDistancePct: options.maxGapDistancePct ?? 45,
  }));
  const wrongSideFindings = auditFiles.flatMap(wrongSideFindingsForAudit);
  const findings = dedupeFindings([...hiddenGapFindings, ...wrongSideFindings]).slice(0, options.maxFindings ?? 60);
  const report: LadderGapLevelAuditReport = {
    generatedAt: new Date().toISOString(),
    inputPath: options.inputPath,
    warehouseDirectoryPath,
    totals: {
      auditFiles: auditFiles.length,
      snapshots: snapshots.length,
      symbols: new Set(snapshots.map((snapshot) => snapshot.symbol)).size,
      hiddenGapZones: hiddenGapFindings.length,
      nearWrongSideLevels: wrongSideFindings.length,
    },
    findings,
  };

  mkdirSync(options.outputDirectory, { recursive: true });
  const jsonPath = join(options.outputDirectory, "ladder-gap-level-audit.json");
  const markdownPath = join(options.outputDirectory, "ladder-gap-level-audit.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
  return report;
}
