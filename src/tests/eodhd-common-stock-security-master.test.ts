import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EodhdCommonStockSecurityMaster } from "../lib/auto-watchlist/eodhd-common-stock-security-master.js";

test("EODHD security master accepts only an authoritative common-stock record and reuses its cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eodhd-security-master-"));
  let calls = 0;
  const master = new EodhdCommonStockSecurityMaster({
    apiToken: "test-token",
    cachePath: join(directory, "security-master.json"),
    now: () => Date.parse("2026-07-17T14:00:00Z"),
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(String(url), /type=common_stock/);
      return new Response(JSON.stringify([
        { Code: "GOOD", Type: "Common Stock" },
        { Code: "BADW", Type: "Warrant" },
      ]), { status: 200 });
    },
  });
  try {
    const first = await master.verifySymbols({ symbols: ["good", "badw", "missing"] });
    assert.equal(first.available, true);
    assert.equal(first.cacheUsed, false);
    assert.equal(first.bySymbol.GOOD?.status, "verified_common_stock");
    assert.equal(first.bySymbol.BADW?.status, "not_found");
    assert.equal(first.bySymbol.MISSING?.status, "not_found");

    const cached = await master.verifySymbols({ symbols: ["GOOD"] });
    assert.equal(cached.cacheUsed, true);
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("EODHD security master fails closed when no token is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eodhd-security-master-"));
  const original = process.env.EODHD_API_TOKEN;
  delete process.env.EODHD_API_TOKEN;
  try {
    const master = new EodhdCommonStockSecurityMaster({
      apiToken: null,
      cachePath: join(directory, "security-master.json"),
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    const result = await master.verifySymbols({ symbols: ["SAFE"] });
    assert.equal(result.available, false);
    assert.equal(result.bySymbol.SAFE?.status, "unavailable");
  } finally {
    if (original === undefined) delete process.env.EODHD_API_TOKEN;
    else process.env.EODHD_API_TOKEN = original;
    await rm(directory, { recursive: true, force: true });
  }
});
