import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const DEFAULT_RENAME_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 10;
const syncDelayBuffer = new Int32Array(new SharedArrayBuffer(4));

function temporaryPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

function isRetryableRenameError(error: unknown): boolean {
  return RETRYABLE_RENAME_CODES.has((error as NodeJS.ErrnoException)?.code ?? "");
}

function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * (attempt + 1);
}

export function writeFileAtomicallySync(
  filePath: string,
  contents: string,
  renameAttempts = DEFAULT_RENAME_ATTEMPTS,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    writeFileSync(temporaryPath, contents, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(temporaryPath, filePath);
        return;
      } catch (error) {
        if (!isRetryableRenameError(error) || attempt + 1 >= renameAttempts) {
          throw error;
        }
        Atomics.wait(syncDelayBuffer, 0, 0, retryDelayMs(attempt));
      }
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function writeFileAtomically(
  filePath: string,
  contents: string,
  renameAttempts = DEFAULT_RENAME_ATTEMPTS,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    await writeFile(temporaryPath, contents, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporaryPath, filePath);
        return;
      } catch (error) {
        if (!isRetryableRenameError(error) || attempt + 1 >= renameAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      }
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
