import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelQualityReviewCacheFingerprintFactsOnly,
  isLevelQualityReviewCacheFingerprint,
  isLevelQualityReviewCacheFingerprintSet,
  summarizeLevelQualityReviewCacheFingerprints,
  validateLevelQualityReviewCacheFingerprint,
  validateLevelQualityReviewCacheFingerprintSet,
  type LevelQualityReviewCacheFingerprint,
  type LevelQualityReviewCacheFingerprintSet,
  type LevelQualityReviewCacheFingerprintSummary,
} from "../lib/analysis/level-quality-review-cache-fingerprint.js";

type CacheFingerprintFixture = {
  schemaVersion: "level-quality-review-cache-fingerprint-fixture/v1";
  fixtureName: string;
  fingerprint?: LevelQualityReviewCacheFingerprint;
  fingerprintSet?: LevelQualityReviewCacheFingerprintSet;
  expectedValidationResult: {
    valid: boolean;
    errors: string[];
  };
  expectedSummary: LevelQualityReviewCacheFingerprintSummary;
  factualOnlyStatus: {
    checked: boolean;
    prohibitedLanguageHitCount: number;
  };
};

const fixtureDir = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/level-quality-review-cache-fingerprint/contract-fixtures/", import.meta.url),
);

function readFixtures(): CacheFingerprintFixture[] {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => JSON.parse(readFileSync(`${fixtureDir}/${fileName}`, "utf8")) as CacheFingerprintFixture);
}

function fixture(name: string): CacheFingerprintFixture {
  const found = readFixtures().find((item) => item.fixtureName === name);
  assert(found, `Missing fixture ${name}`);
  return found;
}

function payload(
  item: CacheFingerprintFixture,
): LevelQualityReviewCacheFingerprint | LevelQualityReviewCacheFingerprintSet {
  const value = item.fingerprintSet ?? item.fingerprint;
  assert(value, `${item.fixtureName} must include a fingerprint or fingerprintSet`);
  return value;
}

function validatePayload(value: LevelQualityReviewCacheFingerprint | LevelQualityReviewCacheFingerprintSet) {
  return "fingerprints" in value
    ? validateLevelQualityReviewCacheFingerprintSet(value)
    : validateLevelQualityReviewCacheFingerprint(value);
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["recommendation", /\brecommendation\b/],
    ["trade advice", /\btrade\s+advice\b/],
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coaching", /\bcoaching\b|\bcoach\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["should have", /\bshould have\b/],
    ["mistake", /\bmistake\b/],
    ["discipline", /\bdiscipline\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("cache fingerprint contract fixtures parse validate and summarize", () => {
  const fixtures = readFixtures();

  assert.equal(fixtures.length, 5);
  for (const item of fixtures) {
    const value = payload(item);
    const validation = validatePayload(value);

    assert.equal(item.schemaVersion, "level-quality-review-cache-fingerprint-fixture/v1");
    assert.deepEqual(validation, item.expectedValidationResult, item.fixtureName);
    assertLevelQualityReviewCacheFingerprintFactsOnly(value);
    assert.deepEqual(summarizeLevelQualityReviewCacheFingerprints(value), item.expectedSummary, item.fixtureName);
    assert.equal(item.factualOnlyStatus.checked, true);
    assert.equal(item.factualOnlyStatus.prohibitedLanguageHitCount, 0);
  }
});

test("single fingerprint and fingerprint sets expose type guards", () => {
  const single = fixture("cache-fingerprint-single-timeframe").fingerprint;
  const multi = fixture("cache-fingerprint-multi-timeframe-symbol").fingerprintSet;

  assert(single);
  assert(multi);
  assert.equal(isLevelQualityReviewCacheFingerprint(single), true);
  assert.equal(isLevelQualityReviewCacheFingerprintSet(multi), true);
  assert.equal(isLevelQualityReviewCacheFingerprintSet(single), false);
  assert.equal(isLevelQualityReviewCacheFingerprint(multi), false);
});

test("multi-timeframe cache fingerprint sets summarize counts and validation issues", () => {
  const multi = fixture("cache-fingerprint-multi-timeframe-symbol");
  const issues = fixture("cache-fingerprint-validation-issues");

  assert.deepEqual(summarizeLevelQualityReviewCacheFingerprints(payload(multi)), multi.expectedSummary);
  assert.deepEqual(summarizeLevelQualityReviewCacheFingerprints(payload(issues)), issues.expectedSummary);
  assert.equal(issues.expectedSummary.validationIssueCount, 3);
  assert.equal(issues.expectedSummary.hasValidationIssues, true);
});

test("15m cache fingerprints are valid only as context-only and outside LevelEngine", () => {
  const item = fixture("cache-fingerprint-with-15m-context-only");
  const set = structuredClone(item.fingerprintSet);
  assert(set);

  assert.equal(validateLevelQualityReviewCacheFingerprintSet(set).valid, true);
  assert.equal(summarizeLevelQualityReviewCacheFingerprints(set).fifteenMinuteContextOnlyCount, 1);

  const fifteenMinute = set.fingerprints.find((fingerprint) => fingerprint.timeframe === "15m");
  assert(fifteenMinute);

  const notContextOnly = structuredClone(set);
  const notContextOnly15m = notContextOnly.fingerprints.find((fingerprint) => fingerprint.timeframe === "15m");
  assert(notContextOnly15m);
  notContextOnly15m.contextOnly = false;
  assert.equal(validateLevelQualityReviewCacheFingerprintSet(notContextOnly).valid, false);

  const fedIntoEngine = structuredClone(set);
  const fedIntoEngine15m = fedIntoEngine.fingerprints.find((fingerprint) => fingerprint.timeframe === "15m");
  assert(fedIntoEngine15m);
  fedIntoEngine15m.includedInLevelEngine = true;
  assert.equal(validateLevelQualityReviewCacheFingerprintSet(fedIntoEngine).valid, false);
});

test("missing optional cache fingerprint fields still validate", () => {
  const item = fixture("cache-fingerprint-missing-optional-fields");
  const value = payload(item);
  const summary = summarizeLevelQualityReviewCacheFingerprints(value);

  assert.equal(validatePayload(value).valid, true);
  assert.equal("firstCandleTimestamp" in summary, false);
  assert.equal("lastCandleTimestamp" in summary, false);
  assert.deepEqual(summary, item.expectedSummary);
});

test("cache fingerprint contract rejects malformed unsafe and bulky payloads", () => {
  const safe = structuredClone(fixture("cache-fingerprint-single-timeframe").fingerprint);
  assert(safe);

  const badHash = structuredClone(safe);
  badHash.sha256 = "not-a-hash";
  assert.equal(validateLevelQualityReviewCacheFingerprint(badHash).valid, false);

  const absolutePath = structuredClone(safe);
  absolutePath.relativePath = "C:/cache/ibkr/DEVS/5m/file.json";
  assert.equal(validateLevelQualityReviewCacheFingerprint(absolutePath).valid, false);

  const candlePayload = {
    ...safe,
    candles: [
      {
        timestamp: 1779976200000,
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
      },
    ],
  };
  assert.equal(validateLevelQualityReviewCacheFingerprint(candlePayload).valid, false);

  const wrapperPayload = {
    ...safe,
    response: {
      candles: [],
    },
  };
  assert.equal(validateLevelQualityReviewCacheFingerprint(wrapperPayload).valid, false);

  const fullSnapshotPayload = {
    ...safe,
    fullSnapshot: {
      symbol: "DEVS",
    },
  };
  assert.equal(validateLevelQualityReviewCacheFingerprint(fullSnapshotPayload).valid, false);
});

test("cache fingerprint facts-only assertion rejects prohibited language", () => {
  const unsafe = structuredClone(fixture("cache-fingerprint-single-timeframe").fingerprint);
  assert(unsafe);
  unsafe.symbol = "BUY";

  assert.equal(validateLevelQualityReviewCacheFingerprint(unsafe).valid, true);
  assert.throws(
    () => assertLevelQualityReviewCacheFingerprintFactsOnly(unsafe),
    /non-factual wording/,
  );
});

test("cache fingerprint helpers do not mutate inputs", () => {
  const value = structuredClone(fixture("cache-fingerprint-with-15m-context-only").fingerprintSet);
  assert(value);
  const before = structuredClone(value);

  validateLevelQualityReviewCacheFingerprintSet(value);
  summarizeLevelQualityReviewCacheFingerprints(value);
  assertLevelQualityReviewCacheFingerprintFactsOnly(value);

  assert.deepEqual(value, before);
});

test("cache fingerprint fixtures remain facts-only", () => {
  for (const item of readFixtures()) {
    assertNoProhibitedLanguage(payload(item));
    assertNoProhibitedLanguage(item.expectedSummary);
  }
});

test("cache fingerprint helper source stays isolated from providers cache writes alert monitoring Discord and journal paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/analysis/level-quality-review-cache-fingerprint.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "../market-data/",
    "provider-factory",
    "fetch(",
    "writefile",
    "discord",
    "journal",
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
