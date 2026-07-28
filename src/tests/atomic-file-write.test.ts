import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  writeFileAtomically,
  writeFileAtomicallySync,
} from "../lib/persistence/atomic-file-write.js";

test("atomic file writes use unique temporary files and leave no residue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atomic-file-write-"));
  const filePath = join(directory, "state.json");
  try {
    await Promise.all([
      writeFileAtomically(filePath, "first\n"),
      writeFileAtomically(filePath, "second\n"),
    ]);
    assert.match(await readFile(filePath, "utf8"), /^(first|second)\n$/);
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
      [],
    );

    writeFileAtomicallySync(filePath, "sync\n");
    assert.equal(await readFile(filePath, "utf8"), "sync\n");
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
