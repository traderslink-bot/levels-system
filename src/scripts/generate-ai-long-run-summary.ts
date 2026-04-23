import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createOpenAITraderCommentaryServiceFromEnv,
} from "../lib/ai/trader-commentary-service.js";

async function readJson(path: string): Promise<Record<string, unknown> | unknown[]> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> | unknown[];
}

async function main(): Promise<void> {
  const sessionDirectoryArg = process.argv[2];
  if (!sessionDirectoryArg) {
    throw new Error("Usage: tsx src/scripts/generate-ai-long-run-summary.ts <session-directory>");
  }

  const sessionDirectory = resolve(sessionDirectoryArg);
  const sessionSummaryPath = resolve(sessionDirectory, "session-summary.json");
  const threadSummariesPath = resolve(sessionDirectory, "thread-summaries.json");
  const outputPath = resolve(sessionDirectory, "session-ai-review.md");
  const commentaryService = createOpenAITraderCommentaryServiceFromEnv();

  if (!commentaryService) {
    console.log("Skipping AI session summary because OPENAI_API_KEY is not set.");
    return;
  }

  const sessionSummary = await readJson(sessionSummaryPath) as Record<string, unknown>;
  const threadSummaries = await readJson(threadSummariesPath) as unknown[];
  const result = await commentaryService.summarizeSession({
    sessionSummary,
    threadSummaries,
  });

  if (!result?.text) {
    console.log("OpenAI commentary returned no text. No AI session summary was written.");
    return;
  }

  const content = [
    `# AI Session Review`,
    ``,
    `Model: \`${result.model}\``,
    ``,
    result.text,
    ``,
  ].join("\n");

  await writeFile(outputPath, content, "utf8");
  console.log(`Wrote AI session review to ${outputPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
