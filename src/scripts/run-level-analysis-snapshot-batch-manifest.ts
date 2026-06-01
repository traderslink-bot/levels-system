import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLevelAnalysisSnapshotBatchManifest,
  type LevelAnalysisSnapshotBatchManifest,
} from "../lib/analysis/level-analysis-snapshot-batch-manifest.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";

export type LevelAnalysisSnapshotBatchManifestRunnerOptions = {
  inputPath: string;
  outPath: string;
  outputRoot?: string;
  batchId: string;
  generatedAt: string;
};

export type LevelAnalysisSnapshotBatchManifestRunnerResult = {
  inputPaths: string[];
  outPath: string;
  manifest: LevelAnalysisSnapshotBatchManifest;
  content: string;
};

export type LevelAnalysisSnapshotBatchManifestFileSystem = {
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  mkdirSync: typeof mkdirSync;
  statSync: typeof statSync;
  readdirSync: typeof readdirSync;
};

const defaultFileSystem: LevelAnalysisSnapshotBatchManifestFileSystem = {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseGeneratedAt(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid --generated-at value "${value}". Expected ISO date.`);
  }

  return new Date(value).toISOString();
}

export function parseLevelAnalysisSnapshotBatchManifestRunnerArgs(
  args: string[],
): LevelAnalysisSnapshotBatchManifestRunnerOptions {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let outputRoot: string | undefined;
  let batchId: string | undefined;
  let generatedAt = new Date().toISOString();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--input") {
      inputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output-root") {
      outputRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--batch-id") {
      batchId = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      generatedAt = parseGeneratedAt(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!inputPath) {
    throw new Error("Missing required --input <path>.");
  }
  if (!outPath) {
    throw new Error("Missing required --out <path>.");
  }

  return {
    inputPath,
    outPath,
    outputRoot,
    batchId: batchId ?? `level-analysis-snapshot-batch-${Date.parse(generatedAt)}`,
    generatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJson(filePath: string, fileSystem: Pick<LevelAnalysisSnapshotBatchManifestFileSystem, "readFileSync">): unknown {
  return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
}

function snapshotPathsFromListFile(
  filePath: string,
  fileSystem: Pick<LevelAnalysisSnapshotBatchManifestFileSystem, "readFileSync">,
): string[] {
  const parsed = readJson(filePath, fileSystem);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item));
  }
  if (isRecord(parsed) && Array.isArray(parsed.artifacts)) {
    return parsed.artifacts.map((item) => String(item));
  }

  return [filePath];
}

function collectSnapshotPathsFromDirectory(
  dirPath: string,
  fileSystem: Pick<LevelAnalysisSnapshotBatchManifestFileSystem, "readdirSync" | "statSync">,
): string[] {
  const paths: string[] = [];

  for (const entry of fileSystem.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      paths.push(...collectSnapshotPathsFromDirectory(entryPath, fileSystem));
      continue;
    }
    if (entry.isFile() && entry.name === "level-analysis-snapshot-v1.json") {
      paths.push(entryPath);
    }
  }

  return paths.sort();
}

export function resolveLevelAnalysisSnapshotArtifactPaths(
  inputPath: string,
  fileSystem: Pick<
    LevelAnalysisSnapshotBatchManifestFileSystem,
    "readFileSync" | "readdirSync" | "statSync"
  > = defaultFileSystem,
): string[] {
  const stats = fileSystem.statSync(inputPath);
  if (stats.isDirectory()) {
    return collectSnapshotPathsFromDirectory(inputPath, fileSystem);
  }

  return snapshotPathsFromListFile(inputPath, fileSystem);
}

function parseSnapshot(filePath: string, content: string): LevelAnalysisSnapshot {
  const parsed = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error(`Snapshot artifact ${filePath} must contain a JSON object.`);
  }

  return parsed as LevelAnalysisSnapshot;
}

export function runLevelAnalysisSnapshotBatchManifestRunner(
  options: LevelAnalysisSnapshotBatchManifestRunnerOptions,
  fileSystem: LevelAnalysisSnapshotBatchManifestFileSystem = defaultFileSystem,
): LevelAnalysisSnapshotBatchManifestRunnerResult {
  const inputPaths = resolveLevelAnalysisSnapshotArtifactPaths(options.inputPath, fileSystem);
  const entries = inputPaths.map((artifactPath) => {
    try {
      const content = fileSystem.readFileSync(artifactPath, "utf8");
      const stats = fileSystem.statSync(artifactPath);
      return {
        artifactPath,
        artifactExists: true,
        fileSizeBytes: stats.size,
        content,
        snapshot: parseSnapshot(artifactPath, content),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        artifactPath,
        artifactExists: false,
        status: "failed" as const,
        validationErrors: [`artifact_read_failed:${message}`],
      };
    }
  });
  const { manifest, validation } = buildLevelAnalysisSnapshotBatchManifest({
    batchId: options.batchId,
    generatedAt: options.generatedAt,
    outputRoot: options.outputRoot,
    runConfig: {
      inputPath: options.inputPath,
      artifactCount: inputPaths.length,
    },
    entries,
    diagnostics: validationDiagnostics(inputPaths.length),
  });

  if (!validation.valid) {
    throw new Error(`Generated invalid batch manifest: ${validation.errors.join(", ")}`);
  }

  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  fileSystem.mkdirSync(dirname(options.outPath), { recursive: true });
  fileSystem.writeFileSync(options.outPath, content, "utf8");

  return {
    inputPaths,
    outPath: options.outPath,
    manifest,
    content,
  };
}

function validationDiagnostics(inputCount: number): string[] {
  return inputCount === 0 ? ["no_snapshot_artifacts_found"] : [];
}

function isDirectRun(): boolean {
  const argvPath = process.argv[1];
  return argvPath !== undefined && fileURLToPath(import.meta.url) === resolve(argvPath);
}

if (isDirectRun()) {
  try {
    runLevelAnalysisSnapshotBatchManifestRunner(
      parseLevelAnalysisSnapshotBatchManifestRunnerArgs(process.argv.slice(2)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
