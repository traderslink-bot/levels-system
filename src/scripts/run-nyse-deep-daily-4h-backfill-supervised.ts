import "dotenv/config";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ChildPlan = {
  totals: {
    selectedRequests: number;
    selectedForFetch: number;
  };
  selectedTasks: Array<{ symbol: string; fetchTimeframes: string[] }>;
};

type ChildResult = {
  symbol: string;
  timeframe: "daily" | "4h";
  status: string;
  timestamp: number;
};

type AttemptSummary = {
  attempt: number;
  outDir: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  rows: number;
  selectedRequests?: number;
  lastResult?: ChildResult;
  nextStartAfterSymbol?: string;
  completed: boolean;
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string, fallback: number): number {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function compactTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function safeSymbol(symbol: string | undefined): string {
  return symbol && symbol.length > 0 ? symbol.replace(/[^A-Z0-9.-]/gi, "_") : "START";
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readResults(path: string): ChildResult[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChildResult);
}

function latestMtime(paths: string[]): number {
  return paths
    .filter((path) => existsSync(path))
    .map((path) => statSync(path).mtimeMs)
    .reduce((latest, mtime) => Math.max(latest, mtime), 0);
}

function resolveNextStartAfter(plan: ChildPlan | null, results: ChildResult[], fallback: string | undefined): string | undefined {
  const last = results.at(-1);
  if (!last || !plan) {
    return fallback;
  }
  const index = plan.selectedTasks.findIndex((task) => task.symbol === last.symbol);
  if (index < 0) {
    return last.symbol;
  }
  if (last.timeframe === "4h") {
    return last.symbol;
  }
  return index > 0 ? plan.selectedTasks[index - 1]!.symbol : fallback;
}

function writeSummary(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runAttempt(params: {
  attempt: number;
  outDir: string;
  startAfterSymbol: string | undefined;
  universePath: string;
  warehousePath: string;
  throttleMs: number;
  ibkrTimeoutMs: number;
  stallTimeoutMs: number;
  childClientId: number | undefined;
  extraArgs: string[];
}): Promise<AttemptSummary> {
  mkdirSync(params.outDir, { recursive: true });
  const stdoutPath = join(params.outDir, "supervisor-child-stdout.log");
  const stderrPath = join(params.outDir, "supervisor-child-stderr.log");
  const planPath = join(params.outDir, "nyse-deep-daily-4h-backfill-plan.json");
  const resultsPath = join(params.outDir, "nyse-deep-daily-4h-backfill-results.jsonl");
  const heartbeatPath = join(params.outDir, "nyse-deep-daily-4h-backfill-heartbeat.json");
  const statePath = join(params.outDir, "nyse-deep-daily-4h-backfill-state.json");
  const startedAt = new Date().toISOString();

  const args = [
    "run",
    "nyse:deep:backfill",
    "--",
    "--execute",
    "--universe",
    params.universePath,
    "--warehouse",
    params.warehousePath,
    "--throttle-ms",
    String(params.throttleMs),
    "--ibkr-timeout-ms",
    String(params.ibkrTimeoutMs),
    "--out-dir",
    params.outDir,
    ...params.extraArgs,
  ];
  if (params.startAfterSymbol) {
    args.push("--start-after-symbol", params.startAfterSymbol);
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  if (params.childClientId !== undefined) {
    env.LEVEL_BACKFILL_IBKR_CLIENT_ID = String(params.childClientId);
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(
    `[NyseDeepDaily4hSupervisor] attempt=${params.attempt} startAfter=${params.startAfterSymbol ?? "(none)"} outDir=${params.outDir}`,
  );
  const child = spawn(npmCommand, args, { cwd: process.cwd(), env, shell: process.platform === "win32" });
  const stdout = createWriteStream(stdoutPath, { flags: "a" });
  const stderr = createWriteStream(stderrPath, { flags: "a" });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  let timedOut = false;
  const watchdog = setInterval(() => {
    const latest = latestMtime([resultsPath, heartbeatPath, statePath, stdoutPath, stderrPath]);
    if (latest > 0 && Date.now() - latest > params.stallTimeoutMs) {
      timedOut = true;
      console.log(
        `[NyseDeepDaily4hSupervisor] attempt=${params.attempt} stalled for ${params.stallTimeoutMs}ms; terminating child pid=${child.pid}`,
      );
      terminateChild(child);
    }
  }, 30_000);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearInterval(watchdog);
  stdout.end();
  stderr.end();

  const plan = readJson<ChildPlan>(planPath);
  const results = readResults(resultsPath);
  const lastResult = results.at(-1);
  const completed = plan !== null && results.length >= plan.totals.selectedRequests;
  const nextStartAfterSymbol = completed ? undefined : resolveNextStartAfter(plan, results, params.startAfterSymbol);
  return {
    attempt: params.attempt,
    outDir: params.outDir,
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: exit.code,
    signal: exit.signal,
    timedOut,
    rows: results.length,
    selectedRequests: plan?.totals.selectedRequests,
    lastResult,
    nextStartAfterSymbol,
    completed,
  };
}

function terminateChild(child: ChildProcessWithoutNullStreams): void {
  if (child.killed) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

const initialStartAfterSymbol = argValue("--start-after-symbol")?.trim().toUpperCase();
const universePath = argValue("--universe") ?? "data/nyse-universe/nyse-current-universe.json";
const warehousePath = argValue("--warehouse") ?? "data/candles";
const throttleMs = numberArg("--throttle-ms", 10_500);
const ibkrTimeoutMs = numberArg("--ibkr-timeout-ms", 600_000);
const restartDelayMs = numberArg("--restart-delay-ms", 30_000);
const stallTimeoutMs = numberArg("--stall-timeout-ms", 1_200_000);
const maxAttempts = numberArg("--max-attempts", 50);
const clientIdStart = argValue("--client-id-start") ? numberArg("--client-id-start", 204) : undefined;
const outRoot =
  argValue("--out-root") ??
  join(
    "artifacts",
    "nyse-marketcap-universe",
    new Date().toISOString().slice(0, 10),
    `nyse-deep-daily-4h-backfill-supervised-${compactTimestamp()}`,
  );
const dryRun = hasFlag("--dry-run");
const passthroughFlags = new Set([
  "--start-after-symbol",
  "--universe",
  "--warehouse",
  "--throttle-ms",
  "--ibkr-timeout-ms",
  "--restart-delay-ms",
  "--stall-timeout-ms",
  "--max-attempts",
  "--client-id-start",
  "--out-root",
]);
const extraArgs: string[] = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]!;
  if (arg === "--dry-run") {
    continue;
  }
  if (passthroughFlags.has(arg)) {
    index += 1;
    continue;
  }
  extraArgs.push(arg);
}

mkdirSync(outRoot, { recursive: true });
const supervisorStatePath = join(outRoot, "supervisor-state.json");
const supervisorSummaryPath = join(outRoot, "supervisor-summary.json");
const attempts: AttemptSummary[] = [];
let startAfterSymbol = initialStartAfterSymbol;

writeSummary(supervisorStatePath, {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  outRoot,
  startAfterSymbol,
  maxAttempts,
  restartDelayMs,
  stallTimeoutMs,
  status: dryRun ? "dry_run" : "running",
});

if (dryRun) {
  console.log(`[NyseDeepDaily4hSupervisor] dry-run outRoot=${outRoot} startAfter=${startAfterSymbol ?? "(none)"}`);
  process.exit(0);
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const attemptOutDir = join(outRoot, `attempt-${String(attempt).padStart(3, "0")}-after-${safeSymbol(startAfterSymbol)}`);
  const summary = await runAttempt({
    attempt,
    outDir: attemptOutDir,
    startAfterSymbol,
    universePath,
    warehousePath,
    throttleMs,
    ibkrTimeoutMs,
    stallTimeoutMs,
    childClientId: clientIdStart === undefined ? undefined : clientIdStart + attempt - 1,
    extraArgs,
  });
  attempts.push(summary);
  writeSummary(supervisorSummaryPath, { status: summary.completed ? "completed" : "running", attempts });
  writeSummary(supervisorStatePath, {
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    outRoot,
    status: summary.completed ? "completed" : "restarting",
    lastAttempt: summary,
    attempts: attempts.length,
  });

  if (summary.completed) {
    console.log(`[NyseDeepDaily4hSupervisor] completed after ${attempt} attempt(s).`);
    process.exit(0);
  }

  if (!summary.nextStartAfterSymbol) {
    console.error("[NyseDeepDaily4hSupervisor] child exited before any resumable result; stopping to avoid a restart loop.");
    process.exit(1);
  }

  startAfterSymbol = summary.nextStartAfterSymbol;
  console.log(
    `[NyseDeepDaily4hSupervisor] child exited before completion; restarting after ${restartDelayMs}ms from ${startAfterSymbol}`,
  );
  await new Promise((resolve) => setTimeout(resolve, restartDelayMs));
}

writeSummary(supervisorStatePath, {
  pid: process.pid,
  updatedAt: new Date().toISOString(),
  outRoot,
  status: "max_attempts_exhausted",
  attempts: attempts.length,
});
console.error(`[NyseDeepDaily4hSupervisor] max attempts exhausted (${maxAttempts}).`);
process.exit(1);
