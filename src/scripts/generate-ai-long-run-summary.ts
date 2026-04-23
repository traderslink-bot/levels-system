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
  const threadOutputPath = resolve(sessionDirectory, "thread-ai-recaps.md");
  const commentaryService = createOpenAITraderCommentaryServiceFromEnv();

  if (!commentaryService) {
    console.log("Skipping AI session summary because OPENAI_API_KEY is not set.");
    return;
  }

  const sessionSummary = await readJson(sessionSummaryPath) as Record<string, unknown>;
  const threadSummaries = await readJson(threadSummariesPath) as unknown[];
  const input = {
    sessionSummary,
    threadSummaries,
  };
  const [result, noisyFamilies] = await Promise.all([
    commentaryService.summarizeSession(input),
    commentaryService.identifyNoisyFamilies(input),
  ]);

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
    noisyFamilies?.text
      ? [``, `## AI Noise Review`, ``, noisyFamilies.text].join("\n")
      : "",
    ``,
  ].join("\n");

  await writeFile(outputPath, content, "utf8");

  const threadSections: string[] = ["# AI Thread Recaps", ""];
  for (const rawThreadSummary of threadSummaries) {
    if (!rawThreadSummary || typeof rawThreadSummary !== "object") {
      continue;
    }

    const threadSummary = rawThreadSummary as Record<string, unknown>;
    const symbol =
      typeof threadSummary.symbol === "string" && threadSummary.symbol.trim().length > 0
        ? threadSummary.symbol
        : null;
    if (!symbol) {
      continue;
    }

    const deterministicRecap =
      typeof threadSummary.summary === "string"
        ? threadSummary.summary
        : JSON.stringify(threadSummary);
    const commentary = await commentaryService.summarizeSymbolThread({
      symbol,
      deterministicRecap,
      threadSummary,
    });

    if (!commentary?.text) {
      continue;
    }

    threadSections.push(`## ${symbol}`);
    threadSections.push("");
    threadSections.push(`Model: \`${commentary.model}\``);
    threadSections.push("");
    threadSections.push(commentary.text);
    threadSections.push("");
  }

  if (threadSections.length > 2) {
    await writeFile(threadOutputPath, threadSections.join("\n"), "utf8");
    console.log(`Wrote AI thread recaps to ${threadOutputPath}`);
  }

  console.log(`Wrote AI session review to ${outputPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
