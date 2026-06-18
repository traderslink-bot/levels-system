const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");

const DEFAULT_MAX_AGE_MINUTES = 30;
const LIST_PROCESSES_TIMEOUT_MS = 5_000;
const STOP_PROCESS_TIMEOUT_MS = 5_000;
const MAX_LOGGED_COMMAND_LENGTH = 320;
const WMIC_FIELDS = "ProcessId,ParentProcessId,Name,CreationDate,CommandLine";

function parseArgs(argv) {
  let dryRun = false;
  let maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run" || arg === "-DryRun") {
      dryRun = true;
      continue;
    }

    const inlineMaxAge = arg.match(/^--max-age-minutes=(\d+)$/);
    if (inlineMaxAge) {
      maxAgeMinutes = Math.max(1, Number(inlineMaxAge[1]));
      continue;
    }

    if (arg === "-MaxAgeMinutes" || arg === "--max-age-minutes") {
      const next = Number(argv[index + 1]);
      if (Number.isFinite(next)) {
        maxAgeMinutes = Math.max(1, next);
        index += 1;
      }
    }
  }

  return { dryRun, maxAgeMinutes };
}

function workspaceRoot() {
  return resolve(__dirname, "..");
}

function normalizeForMatch(value) {
  return String(value ?? "").replaceAll("/", "\\").toLowerCase();
}

function processAgeMinutes(row, now) {
  const createdAt = Date.parse(row.CreationDateUtc);
  return Number.isFinite(createdAt) ? (now - createdAt) / 60_000 : 0;
}

function describeCommandLine(row) {
  const value = String(row.CommandLine ?? "").replace(/\s+/g, " ").trim();
  return value.length > MAX_LOGGED_COMMAND_LENGTH
    ? `${value.slice(0, MAX_LOGGED_COMMAND_LENGTH)}...`
    : value;
}

function matchesLevelsSystemTestRunner(row, root) {
  const command = normalizeForMatch(row.CommandLine);
  if (!command.includes(normalizeForMatch(root))) {
    return false;
  }
  if (command.includes("cleanup-stale-test-runners")) {
    return false;
  }

  const isNodeTestChild = command.includes("--test") && command.includes("src\\tests");
  const isTsxTestParent = command.includes("tsx\\dist\\cli.mjs") && command.includes("--test");
  const isNpmTestParent = command.includes("npm-cli.js") && /(?:^|\s)test(?:\s|$)/.test(command);
  return isNodeTestChild || isTsxTestParent || isNpmTestParent;
}

function isTestRunnerAncestor(row) {
  const command = normalizeForMatch(row.CommandLine);
  if (!command) {
    return false;
  }

  const isTsxTestParent = command.includes("tsx\\dist\\cli.mjs") && command.includes("--test");
  const isNpmTestParent = command.includes("npm-cli.js") && /(?:^|\s)test(?:\s|$)/.test(command);
  return isTsxTestParent || isNpmTestParent;
}

function processDepth(row, byPid) {
  let depth = 0;
  let current = row;
  const seen = new Set();

  while (current && !seen.has(current.ProcessId)) {
    seen.add(current.ProcessId);
    const parent = byPid.get(current.ParentProcessId);
    if (!parent) {
      break;
    }
    depth += 1;
    current = parent;
  }

  return depth;
}

function includeStaleTestAncestors(targets, rows, maxAgeMinutes, now) {
  const byPid = new Map(rows.map((row) => [row.ProcessId, row]));
  const included = new Map(targets.map((row) => [row.ProcessId, row]));

  for (const target of targets) {
    let parent = byPid.get(target.ParentProcessId);
    const seen = new Set([target.ProcessId]);

    while (parent && !seen.has(parent.ProcessId)) {
      seen.add(parent.ProcessId);
      if (isTestRunnerAncestor(parent) && processAgeMinutes(parent, now) >= maxAgeMinutes) {
        included.set(parent.ProcessId, parent);
        parent = byPid.get(parent.ParentProcessId);
        continue;
      }
      break;
    }
  }

  return [...included.values()].sort((left, right) => {
    const depthDelta = processDepth(right, byPid) - processDepth(left, byPid);
    return depthDelta || processAgeMinutes(right, now) - processAgeMinutes(left, now);
  });
}

function parseWmicCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseWmicDate(value) {
  const match = String(value ?? "").match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{3})\d*([+-]\d{3})?$/,
  );
  if (!match) {
    return "";
  }

  const [, year, month, day, hour, minute, second, millisecond, offset] = match;
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  );
  const offsetMinutes = offset ? Number(offset) : 0;
  return new Date(localAsUtc - offsetMinutes * 60_000).toISOString();
}

function parseWmicCsv(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.startsWith("Node,"));
  if (headerIndex < 0) {
    return [];
  }

  const header = parseWmicCsvLine(lines[headerIndex] ?? "");
  const indexFor = (name) => header.indexOf(name);
  const commandIndex = indexFor("CommandLine");
  const creationIndex = indexFor("CreationDate");
  const nameIndex = indexFor("Name");
  const parentIndex = indexFor("ParentProcessId");
  const pidIndex = indexFor("ProcessId");
  if ([commandIndex, creationIndex, nameIndex, parentIndex, pidIndex].some((index) => index < 0)) {
    return [];
  }

  return lines.slice(headerIndex + 1)
    .map((line) => {
      const values = parseWmicCsvLine(line);
      return {
        ProcessId: Number(values[pidIndex]),
        ParentProcessId: Number(values[parentIndex]),
        Name: values[nameIndex] ?? "",
        CreationDateUtc: parseWmicDate(values[creationIndex] ?? ""),
        CommandLine: values[commandIndex] ?? "",
      };
    })
    .filter((row) => Number.isFinite(row.ProcessId) && row.ProcessId > 0);
}

function listNodeWindowsProcesses() {
  const output = execFileSync(
    "wmic",
    ["process", "where", "Name = 'node.exe'", "get", WMIC_FIELDS, "/format:csv"],
    {
      encoding: "utf8",
      timeout: LIST_PROCESSES_TIMEOUT_MS,
      windowsHide: true,
    },
  );

  return parseWmicCsv(output);
}

function stopWindowsProcess(processId) {
  execFileSync("taskkill.exe", ["/PID", String(processId), "/F"], {
    stdio: "ignore",
    timeout: STOP_PROCESS_TIMEOUT_MS,
    windowsHide: true,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = workspaceRoot();
  const now = Date.now();

  if (process.platform !== "win32") {
    console.log("[cleanup-stale-test-runners] skipped: Windows-only cleanup guard.");
    return;
  }

  let rows;
  try {
    rows = listNodeWindowsProcesses();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[cleanup-stale-test-runners] skipped: process scan failed: ${message}`);
    return;
  }

  const staleTargets = rows
    .filter((row) => row.ProcessId !== process.pid)
    .filter((row) => matchesLevelsSystemTestRunner(row, root))
    .map((row) => ({ row, ageMinutes: processAgeMinutes(row, now) }))
    .filter((item) => item.ageMinutes >= args.maxAgeMinutes)
    .map((item) => item.row);
  const staleProcesses = includeStaleTestAncestors(staleTargets, rows, args.maxAgeMinutes, now);

  if (staleProcesses.length === 0) {
    console.log(
      `[cleanup-stale-test-runners] no stale levels-system test runners older than ${args.maxAgeMinutes} minutes.`,
    );
    return;
  }

  for (const row of staleProcesses) {
    const ageText = processAgeMinutes(row, now).toFixed(1);
    const action = args.dryRun ? "would stop" : "stopping";
    console.log(
      `[cleanup-stale-test-runners] ${action} PID ${row.ProcessId} (${row.Name}, age ${ageText}m): ${describeCommandLine(row)}`,
    );

    if (!args.dryRun) {
      try {
        stopWindowsProcess(row.ProcessId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[cleanup-stale-test-runners] failed to stop PID ${row.ProcessId}: ${message}`);
      }
    }
  }
}

main();
