import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  generateStartupOperatorPreflight,
  renderStartupOperatorPreflightMarkdown,
} from "../lib/review/startup-operator-preflight.js";

test("startup operator preflight surfaces latest session and missing audit evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "startup-preflight-"));
  const artifactsRoot = resolve(root, "artifacts");
  const sessionDir = resolve(artifactsRoot, "long-run", "2026-05-02_09-30-00");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(resolve(sessionDir, "discord-delivery-audit.jsonl"), "{}\n");
  writeFileSync(resolve(sessionDir, "trader-post-quality-report.md"), "# quality\n");

  const result = generateStartupOperatorPreflight({
    artifactsRoot,
    now: "2026-05-02T14:00:00.000Z",
  });

  assert.equal(result.latestLongRunSessionName, "2026-05-02_09-30-00");
  assert.equal(
    result.artifacts.some(
      (artifact) => artifact.name === "discord-delivery-audit.jsonl" && artifact.status === "present",
    ),
    true,
  );
  assert.equal(
    result.artifacts.some(
      (artifact) => artifact.name === "missed-meaningful-move-audit.md" && artifact.status === "missing",
    ),
    true,
  );
  assert.equal(
    result.checklist.some((item) => item.includes("operator-only")),
    true,
  );

  const markdown = renderStartupOperatorPreflightMarkdown(result);
  assert.match(markdown, /Startup Operator Preflight/);
  assert.match(markdown, /2026-05-02_09-30-00/);
  assert.match(markdown, /missed-meaningful-move-audit\.md/);
});
