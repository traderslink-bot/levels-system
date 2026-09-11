import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../runtime/manual-watchlist-page.ts", import.meta.url), "utf8");
const start = source.indexOf("    function groupAiReadAuditOperations(events)");
const end = source.indexOf("    function appendAiReadTimelineEvent", start);
assert.ok(start > 0 && end > start);
const group = new Function(`${source.slice(start, end)}; return groupAiReadAuditOperations;`)();

test("five requests remain five operations with preparation and interrupted outcome linked", () => {
  const events: any[] = [];
  for (let index = 1; index <= 5; index++) {
    events.push({ runId: `r${index}`, stage: "preparation", occurredAt: index * 10 });
    events.push({ runId: `r${index}`, generationId: `g${index}`, stage: "request", occurredAt: index * 10 + 1 });
  }
  events.push({ generationId: "g5", stage: "startup", outcome: "missing", occurredAt: 100 });
  const operations = group(events);
  assert.equal(operations.length, 5);
  assert.equal(operations[0].key, "generation:g5");
  assert.equal(operations[0].events.length, 3);
  assert.equal(operations.reduce((sum: number, item: any) => sum + item.events.length, 0), 11);
});

test("ambiguous run identity is not assigned to an arbitrary generation", () => {
  const operations = group([{ runId: "r", generationId: "g1" }, { runId: "r", generationId: "g2" }, { runId: "r" }]);
  assert.equal(operations.length, 3);
  assert.ok(operations.some((operation: any) => operation.key === "run:r"));
});
