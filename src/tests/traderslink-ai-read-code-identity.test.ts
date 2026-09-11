import assert from "node:assert/strict";
import test from "node:test";
import { captureAnalysisCodeIdentity } from "../lib/ai/traderslink-ai-read-code-identity.js";

test("analysis identity fingerprints only explicit source or compiled modules without paths or contents", () => {
  for (const extension of ["ts", "js"]) {
    const requested: string[] = [];
    const options = { moduleUrl: `file:///private/runtime/ai/traderslink-ai-read-service.${extension}`,
      deployedCommit: "A".repeat(40), readModule: (url: URL) => {
        requested.push(url.pathname); return Buffer.from(`synthetic ${url.pathname.split("/").at(-1)}`);
      } };
    const first = captureAnalysisCodeIdentity(options);
    assert.equal(first.complete, true);
    assert.equal(first.deployedCommit, "a".repeat(40));
    assert.equal(first.modules.length, 7);
    assert.match(first.sha256!, /^[a-f0-9]{64}$/);
    assert.equal(first.sha256, captureAnalysisCodeIdentity(options).sha256);
    assert.ok(requested.every(path => path.startsWith("/private/runtime/ai/traderslink-ai-read-") && path.endsWith(`.${extension}`)));
    assert.doesNotMatch(JSON.stringify(first), /private|synthetic/);
    const changed = captureAnalysisCodeIdentity({ ...options, readModule: () => Buffer.from("changed source") });
    assert.notEqual(changed.sha256, first.sha256);
  }
});

test("missing module or invalid commit is explicit and never masquerades as a complete fingerprint", () => {
  const result = captureAnalysisCodeIdentity({ moduleUrl: import.meta.url, deployedCommit: "credential-looking-invalid-value",
    readModule: url => { if (url.pathname.includes("core-evidence")) throw new Error("private path unavailable"); return Buffer.from("fixture"); } });
  assert.equal(result.complete, false);
  assert.equal(result.sha256, null);
  assert.equal(result.deployedCommit, null);
  assert.equal(result.modules.filter(module => module.sha256 === null).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /credential|private path/);
});
