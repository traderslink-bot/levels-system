import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

type ChecklistCommand = {
  label: string;
  args: string[];
  required: boolean;
};

type ChecklistCommandResult = ChecklistCommand & {
  exitCode: number | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

type MondayReplayChecklistReport = {
  generatedAt: string;
  sourceRoot: string;
  latestSessionDirectory: string | null;
  outputDirectory: string;
  verdict: "pass" | "watch" | "fail";
  results: ChecklistCommandResult[];
  followUps: string[];
};

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function tail(text: string, maxLength = 1800): string {
  const trimmed = text.trim();
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(trimmed.length - maxLength);
}

function latestSessionDirectory(sourceRoot: string): string | null {
  if (!existsSync(sourceRoot)) {
    return null;
  }

  const candidates = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sourceRoot, entry.name))
    .filter((directory) => existsSync(join(directory, "discord-delivery-audit.jsonl")))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0] ?? null;
}

function runCommand(command: ChecklistCommand): ChecklistCommandResult {
  const startedAt = Date.now();
  const executable = process.platform === "win32" ? "cmd.exe" : npmCommand();
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...command.args] : command.args;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  const spawnError = result.error ? `${result.error.name}: ${result.error.message}` : "";
  return {
    ...command,
    exitCode: result.status ?? (result.error ? 1 : null),
    durationMs: Date.now() - startedAt,
    stdoutTail: tail(result.stdout ?? ""),
    stderrTail: tail([result.stderr ?? "", spawnError].filter(Boolean).join("\n")),
  };
}

function buildCommands(params: {
  sourceRoot: string;
  outputDirectory: string;
  latestSession: string | null;
  savedDataLimit: string;
  skipSlow: boolean;
}): ChecklistCommand[] {
  const commands: ChecklistCommand[] = [
    {
      label: "TypeScript build",
      args: ["run", "build"],
      required: true,
    },
    {
      label: "All-symbol stress report",
      args: ["run", "stress:all-symbols", "--", "--input", params.sourceRoot],
      required: true,
    },
    {
      label: "Small-cap scenario simulator",
      args: ["run", "scenario:smallcap"],
      required: true,
    },
    {
      label: "Saved-data regression",
      args: ["run", "saved-data:test", "--", "--input", params.sourceRoot, "--limit", params.savedDataLimit],
      required: true,
    },
    {
      label: "Startup cache readiness",
      args: ["run", "startup:cache-readiness"],
      required: false,
    },
  ];

  if (params.latestSession) {
    commands.push(
      {
        label: "Latest-session audit reports",
        args: ["run", "longrun:audit:reports", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session trader post quality",
        args: ["run", "quality:posts", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session trader usefulness replay",
        args: ["run", "audit:usefulness", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session daily trader review",
        args: ["run", "audit:daily-review", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session missed meaningful moves",
        args: ["run", "audit:missed-moves", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session first snapshot trade maps",
        args: ["run", "audit:first-snapshots", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session end-of-day verdict",
        args: ["run", "audit:eod-verdict", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session why-no-post proof",
        args: ["run", "audit:why-no-post", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session candle intelligence exploratory gate",
        args: [
          "run",
          "candles:regression-gate",
          "--",
          params.latestSession,
          "--preset",
          "exploratory",
          "--max-cases-per-type",
          "10",
          "--no-fail",
        ],
        required: true,
      },
      {
        label: "Latest-session strict candle intelligence gate",
        args: [
          "run",
          "candles:regression-gate",
          "--",
          params.latestSession,
          "--preset",
          "strict",
          "--max-cases-per-type",
          "10",
        ],
        required: false,
      },
      {
        label: "Latest-session dynamic/reference calibration",
        args: ["run", "candles:dynamic-calibrate", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session candle import safety",
        args: ["run", "candles:import-safety", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session behavior/readiness audit",
        args: ["run", "audit:session-behavior", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session post reasons",
        args: ["run", "audit:post-reasons", "--", params.latestSession],
        required: true,
      },
      {
        label: "Latest-session known-bad post patterns",
        args: ["run", "audit:known-bad-posts", "--", params.latestSession],
        required: false,
      },
      {
        label: "Latest-session volume replay",
        args: ["run", "volume:replay", "--", params.latestSession],
        required: false,
      },
    );
  }

  if (!params.skipSlow) {
    commands.push(
      {
        label: "Market-structure replay",
        args: ["run", "structure:replay", "--", "--max-files-per-symbol", "2"],
        required: false,
      },
      {
        label: "Stable-structure Discord alignment",
        args: ["run", "structure:discord-align", "--", "--limit", "all"],
        required: false,
      },
      {
        label: "Market-structure calibration",
        args: ["run", "structure:calibrate", "--", "--max-files-per-symbol", "2", "--audit-limit", "all"],
        required: false,
      },
      {
        label: "Advanced candle context",
        args: ["run", "candles:advanced-context", "--", "--max-symbols", "50"],
        required: false,
      },
      {
        label: "Provider comparison readiness",
        args: ["run", "candles:provider-compare", "--", "--primary", "ibkr", "--comparison", "stub"],
        required: false,
      },
    );
  }

  return commands;
}

function verdictFor(results: ChecklistCommandResult[]): MondayReplayChecklistReport["verdict"] {
  if (results.some((result) => result.required && result.exitCode !== 0)) {
    return "fail";
  }
  if (results.some((result) => result.exitCode !== 0)) {
    return "watch";
  }
  return "pass";
}

function followUpsFor(results: ChecklistCommandResult[], latestSession: string | null): string[] {
  const followUps: string[] = [
    "Review all-symbol-stress-report.md for symbols above their style budget.",
    "Review trader-post-quality-report.md for blockers, majors, and repeated-story clusters.",
    "Review trader-usefulness-replay-score.md for repeat noise, missing context, late posts, ticker personality, and ladder confidence.",
    "Review daily-trader-review.md / .html for daily recap, expected post budget, best/worst examples, no-post evidence coverage, and post-timing flags.",
    "Review missed-meaningful-move-audit.md to confirm quiet posting did not hide candle-backed breakouts, support losses, or large 5m moves.",
    "Review first-snapshot-trade-map-audit.md for first-post map checks, line-by-line levels, strength labels, and penny-risk/no-resistance wording.",
    "Review end-of-day-symbol-verdict.md for final per-symbol verdicts that now include structure calibration, advanced candle context, and provider readiness warnings.",
    "Review why-no-post-replay-proof.md for candle-backed quiet-period proof plus replay suppression evidence.",
    "Review candle-intelligence-regression-gate.md for first-post quality, missed moves, forward-level gaps, execution relation evidence, and volume context.",
    "Review dynamic-reference-calibration-report.md and -gate.md before allowing VWAP/EMA/opening-range facts into trader-facing posts.",
    "Review candle-import-safety.md before bulk/backfill work so IBKR or future providers are not hammered.",
    "Review startup-cache-readiness.md to confirm restarts can warm levels from disk while Discord snapshots still wait for fresh candles.",
    "Review session-behavior-audit.md for candle readiness, first-post quality, thread balance, session behavior profiles, runtime markers, and candle/post timeline samples.",
    "Review post-reason-audit.md after the next live run to see which posts fired and why.",
    "Review market-structure-calibration.md before letting stable structure drive stronger suppression.",
    "Review advanced-candle-context.md to see which candle-derived facts are ready, partial, blocked, or degraded.",
    "Review provider-comparison-readiness.md for missing/stale timeframe behavior before any provider switch.",
  ];
  if (!latestSession) {
    followUps.unshift("No latest session with discord-delivery-audit.jsonl was found; run the live app before judging live output.");
  }
  for (const result of results.filter((item) => item.exitCode !== 0)) {
    followUps.unshift(`${result.label} needs review because it exited with ${result.exitCode ?? "unknown"}.`);
  }
  return followUps;
}

function renderMarkdown(report: MondayReplayChecklistReport): string {
  const lines = [
    "# Monday Replay Checklist",
    "",
    `Generated: ${report.generatedAt}`,
    `Source root: ${report.sourceRoot}`,
    `Latest session: ${report.latestSessionDirectory ?? "none"}`,
    `Verdict: ${report.verdict}`,
    "",
    "## Command Results",
    "",
    "| Step | Required | Exit | Duration |",
    "| --- | --- | ---: | ---: |",
  ];

  for (const result of report.results) {
    lines.push(`| ${result.label} | ${result.required ? "yes" : "no"} | ${result.exitCode ?? "n/a"} | ${(result.durationMs / 1000).toFixed(1)}s |`);
  }

  lines.push("", "## Follow-Ups", "");
  for (const followUp of report.followUps) {
    lines.push(`- ${followUp}`);
  }

  lines.push("", "## Command Output Tails", "");
  for (const result of report.results) {
    lines.push(`### ${result.label}`, "");
    if (result.stdoutTail) {
      lines.push("stdout:", "", "```text", result.stdoutTail, "```", "");
    }
    if (result.stderrTail) {
      lines.push("stderr:", "", "```text", result.stderrTail, "```", "");
    }
    if (!result.stdoutTail && !result.stderrTail) {
      lines.push("- no output", "");
    }
  }

  return `${lines.join("\n")}\n`;
}

const sourceRoot = resolve(readFlag("--input") ?? join("artifacts", "long-run"));
const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "monday-replay-checklist"));
const savedDataLimit = readFlag("--limit") ?? "8";
const skipSlow = hasFlag("--skip-slow");
const latestSession = readFlag("--session")
  ? resolve(readFlag("--session")!)
  : latestSessionDirectory(sourceRoot);

mkdirSync(outputDirectory, { recursive: true });

const results = buildCommands({
  sourceRoot,
  outputDirectory,
  latestSession,
  savedDataLimit,
  skipSlow,
}).map(runCommand);

const report: MondayReplayChecklistReport = {
  generatedAt: new Date().toISOString(),
  sourceRoot,
  latestSessionDirectory: latestSession,
  outputDirectory,
  verdict: verdictFor(results),
  results,
  followUps: followUpsFor(results, latestSession),
};

const jsonPath = join(outputDirectory, "monday-replay-checklist.json");
const markdownPath = join(outputDirectory, "monday-replay-checklist.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(report), "utf8");

console.log(`Monday replay checklist verdict: ${report.verdict}.`);
console.log(`Latest session: ${latestSession ? basename(latestSession) : "none"}.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);

if (report.verdict === "fail") {
  process.exitCode = 1;
}
