import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export type StartupOperatorPreflightInput = {
  artifactsRoot?: string;
  now?: string;
};

export type StartupOperatorPreflightArtifactStatus = "present" | "missing";

export type StartupOperatorPreflightArtifact = {
  name: string;
  path: string;
  status: StartupOperatorPreflightArtifactStatus;
};

export type StartupOperatorPreflightResult = {
  generatedAt: string;
  latestLongRunSession: string | null;
  latestLongRunSessionName: string | null;
  artifacts: StartupOperatorPreflightArtifact[];
  checklist: string[];
};

const REQUIRED_SESSION_ARTIFACTS = [
  "discord-delivery-audit.jsonl",
  "trader-post-quality-report.md",
  "known-bad-post-patterns.md",
  "post-reason-audit-report.md",
  "missed-meaningful-move-audit.md",
  "session-behavior-audit.md",
];

const REQUIRED_GLOBAL_ARTIFACTS = [
  ["session-behavior-audit/session-behavior-audit.md", "global session behavior audit"],
  ["missed-meaningful-move-audit/missed-meaningful-move-audit.md", "global missed meaningful move audit"],
  ["daily-trader-review/daily-trader-review.md", "daily trader review"],
];

function findLatestLongRunSession(artifactsRoot: string): string | null {
  const longRunRoot = resolve(artifactsRoot, "long-run");
  if (!existsSync(longRunRoot)) {
    return null;
  }

  const directories = readdirSync(longRunRoot)
    .map((name) => resolve(longRunRoot, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  return directories[0] ?? null;
}

export function generateStartupOperatorPreflight(
  input: StartupOperatorPreflightInput = {},
): StartupOperatorPreflightResult {
  const artifactsRoot = input.artifactsRoot ?? resolve(process.cwd(), "artifacts");
  const latestLongRunSession = findLatestLongRunSession(artifactsRoot);
  const artifacts: StartupOperatorPreflightArtifact[] = [];

  if (latestLongRunSession) {
    for (const artifactName of REQUIRED_SESSION_ARTIFACTS) {
      const path = resolve(latestLongRunSession, artifactName);
      artifacts.push({
        name: artifactName,
        path,
        status: existsSync(path) ? "present" : "missing",
      });
    }
  }

  for (const [relativePath, name] of REQUIRED_GLOBAL_ARTIFACTS) {
    const path = resolve(artifactsRoot, relativePath);
    artifacts.push({
      name,
      path,
      status: existsSync(path) ? "present" : "missing",
    });
  }

  const checklist = [
    "Run this before relying on a restarted manual watchlist session.",
    "If Discord permission preflight is stale or missing, run `npm run discord:preflight`.",
    "If post quality artifacts are missing, run `npm run replay:monday -- --skip-slow` or the specific audit commands.",
    "Treat this artifact as operator-only. It should never be posted to Discord.",
  ];

  const missing = artifacts.filter((artifact) => artifact.status === "missing");
  if (missing.length > 0) {
    checklist.push(`${missing.length} expected audit artifact${missing.length === 1 ? " is" : "s are"} missing.`);
  }

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    latestLongRunSession,
    latestLongRunSessionName: latestLongRunSession ? basename(latestLongRunSession) : null,
    artifacts,
    checklist,
  };
}

export function renderStartupOperatorPreflightMarkdown(
  result: StartupOperatorPreflightResult,
): string {
  const lines = [
    "# Startup Operator Preflight",
    "",
    `Generated: ${result.generatedAt}`,
    `Latest long-run session: ${result.latestLongRunSessionName ?? "none"}`,
    "",
    "## Artifact Checks",
    "",
    "| Artifact | Status | Path |",
    "| --- | --- | --- |",
  ];

  for (const artifact of result.artifacts) {
    lines.push(`| ${artifact.name} | ${artifact.status} | ${artifact.path.replace(/\|/g, "\\|")} |`);
  }

  lines.push("", "## Checklist", "");
  for (const item of result.checklist) {
    lines.push(`- ${item}`);
  }

  return `${lines.join("\n")}\n`;
}

export function writeStartupOperatorPreflightArtifacts(
  result: StartupOperatorPreflightResult,
  outputDir = resolve(process.cwd(), "artifacts", "startup-operator-preflight"),
): string {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "startup-operator-preflight.json"), JSON.stringify(result, null, 2));
  writeFileSync(
    resolve(outputDir, "startup-operator-preflight.md"),
    renderStartupOperatorPreflightMarkdown(result),
  );
  return outputDir;
}
