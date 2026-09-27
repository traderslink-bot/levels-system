/* Bounded offline checkpoint. No providers, API keys, notifications, or disk writes.
 * Usage: node scripts/verify-watchlist-closed-market.cjs <typescript.js path>
 * Small pure modules run directly through an in-memory TS loader. The manager's
 * actual admission methods are extracted with the TS AST, avoiding runtime startup.
 * This is not a substitute for the subsequent hosted owner-reviewed ticker test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let transport;
let checks = 0;
function check(label, work) { work(); checks++; console.log(`PASS ${label}`); }
function evaluate(source, filename, injections = {}) {
  const output = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, filename);
  const module = { exports: {} };
  const context = { module, exports: module.exports, console, Date, Intl, URL, URLSearchParams,
    process: { env: {} }, fetch: (...args) => { assert.ok(transport, 'No real network allowed'); return transport(...args); },
    require: specifier => {
      if (specifier.startsWith('node:')) return require(specifier);
      assert.ok(specifier.startsWith('.'), `Unexpected dependency ${specifier}`);
      return load(path.resolve(path.dirname(filename), specifier.replace(/\.js$/, '.ts')));
    }, ...injections };
  vm.runInNewContext(output.outputText, context, { filename });
  return module.exports;
}
function load(relative) {
  const filename = path.resolve(root, relative);
  if (!cache.has(filename)) cache.set(filename, evaluate(fs.readFileSync(filename, 'utf8'), filename));
  return cache.get(filename);
}
const calendar = load('src/lib/market-data/us-equity-exchange-calendar.ts');
const market = load('src/lib/ai/traderslink-ai-read-market-context.ts');
const policy = load('src/lib/ai/traderslink-ai-read-review-policy.ts');
const action = load('src/lib/ai/traderslink-ai-read-price-action.ts');
const loaderModule = load('src/lib/market-data/platform-moomoo-ai-read-candle-loader.ts');
const at = value => Date.parse(value);
const saturday = at('2026-09-26T16:00:00Z');
const fridayEnd = at('2026-09-26T00:00:00Z');
const fridayStart = at('2026-09-25T08:00:00Z');
const closedCases = [
  ['Saturday', '2026-09-26T16:00:00Z', '2026-09-25', '2026-09-25T08:00:00Z', '2026-09-26T00:00:00Z'],
  ['Sunday', '2026-09-27T16:00:00Z', '2026-09-25', '2026-09-25T08:00:00Z', '2026-09-26T00:00:00Z'],
  ['Monday before premarket', '2026-09-28T07:00:00Z', '2026-09-25', '2026-09-25T08:00:00Z', '2026-09-26T00:00:00Z'],
  ['Friday after postmarket', '2026-09-26T00:30:00Z', '2026-09-25', '2026-09-25T08:00:00Z', '2026-09-26T00:00:00Z'],
  ['Labor Day', '2026-09-07T16:00:00Z', '2026-09-04', '2026-09-04T08:00:00Z', '2026-09-05T00:00:00Z'],
  ['DST spring Sunday', '2026-03-08T16:00:00Z', '2026-03-06', '2026-03-06T09:00:00Z', '2026-03-07T01:00:00Z'],
  ['DST fall Sunday', '2026-11-01T16:00:00Z', '2026-10-30', '2026-10-30T08:00:00Z', '2026-10-31T00:00:00Z'],
];
for (const [name, requested, date, start, end] of closedCases) check(name, () => {
  const result = market.closedMarketAnalysisWindow(at(requested));
  assert.equal(result.date, date); assert.equal(result.fromTimeMs, at(start)); assert.equal(result.toTimeMs, at(end));
  assert.equal(result.toTimeMs - result.fromTimeMs, 16 * 3600000);
});
check('Open sessions are unchanged', () => {
  for (const value of ['2026-09-25T08:00:00Z', '2026-09-25T15:00:00Z', '2026-09-25T23:00:00Z'])
    assert.equal(market.closedMarketAnalysisWindow(at(value)), null);
});
check('Closed admission survives normalization; historical false remains false', () => {
  for (const enabled of [true, false]) assert.equal(policy.normalizeAiReadAdmission({ timestamp: saturday,
    session: 'closed', initialGenerationEnabled: enabled }).initialGenerationEnabled, enabled);
});
check('Closed review requires master On, even if open-session review is Off', () => {
  const settings = { reviewEnabled: false, generationEnabled: true, session: 'closed',
    premarketEnabled: false, regularEnabled: false, postmarketEnabled: false };
  assert.equal(policy.requiresInitialWatchlistReview(settings), true);
  assert.equal(policy.requiresInitialWatchlistReview({ ...settings, generationEnabled: false }), false);
  assert.equal(policy.requiresInitialWatchlistReview({ ...settings, session: 'regular' }), false);
});

const managerPath = path.join(root, 'src/lib/monitoring/manual-watchlist-runtime-manager.ts');
const managerSource = fs.readFileSync(managerPath, 'utf8');
const parsed = ts.createSourceFile(managerPath, managerSource, ts.ScriptTarget.Latest, true);
const declaration = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ManualWatchlistRuntimeManager');
const selected = ['getTradersLinkAiReadGenerationAvailability', 'captureAiReadAdmission', 'shouldPreparePrivateActivation', 'buildTradersLinkAiReadPriceActionContext'];
const methods = selected.map(name => {
  const member = declaration.members.find(member => member.name?.getText(parsed) === name);
  assert.ok(member, name); return member.getText(parsed);
});
const Probe = evaluate(`export class Probe { ${methods.join('\n')} }`, managerPath, {
  classifyUsEquityMarketSession: calendar.classifyUsEquityMarketSession,
  closedMarketAnalysisWindow: market.closedMarketAnalysisWindow,
  requiresInitialWatchlistReview: policy.requiresInitialWatchlistReview,
  normalizeSymbol: value => value.toUpperCase(),
  normalizePullbackCandles: candles => candles,
  resolveTradersLinkAiReadHistoricalCoverageRequirement: action.resolveTradersLinkAiReadHistoricalCoverageRequirement,
  buildTradersLinkAiCompletedSessionWindow: action.buildTradersLinkAiCompletedSessionWindow,
  mergeTradersLinkAiIntradayCandles: action.mergeTradersLinkAiIntradayCandles,
  datedPreviousRegularSession: market.datedPreviousRegularSession,
}).Probe;
const settings = { enabled: true, automaticUpdatesEnabled: true, premarketEnabled: true, regularEnabled: true, postmarketEnabled: false };
const entry = { active: true, tags: ['manual'], aiReadAdmission: { initialGenerationEnabled: true }, automaticAnalysisEnabled: true };
const probe = new Probe();
probe.options = { now: () => saturday };
probe.tradersLinkAiReadGenerationSettings = settings;
probe.watchlistStore = { getEntry: () => entry };
probe.reviewBeforePublishingEnabled = false; probe.analysisFormat = 'current';
const availability = trigger => probe.getTradersLinkAiReadGenerationAvailability(saturday, { symbol: 'TEST', requestedTrigger: trigger });
check('Manual UI, activation and refresh enabled; other triggers do not spend', () => {
  for (const trigger of [undefined, 'activation', 'manual']) assert.equal(availability(trigger).allowed, true, String(trigger));
  for (const trigger of ['startup', 'automatic', 'visibility_enabled']) assert.equal(availability(trigger).allowed, false, trigger);
  entry.tags = ['auto']; assert.equal(availability('activation').allowed, false); entry.tags = ['manual'];
});
check('Master Off and open-session switches still control requests', () => {
  settings.enabled = false; assert.equal(availability('manual').allowed, false); settings.enabled = true;
  assert.equal(probe.getTradersLinkAiReadGenerationAvailability(at('2026-09-25T23:00:00Z'), { symbol: 'TEST', requestedTrigger: 'manual' }).allowed, false);
});
check('Notes-only, previous disabled admission and automatic Off remain respected', () => {
  entry.automaticAnalysisEnabled = false;
  assert.equal(availability('activation').allowed, false); assert.equal(availability('manual').allowed, true);
  entry.automaticAnalysisEnabled = true; entry.aiReadAdmission.initialGenerationEnabled = false;
  assert.equal(availability('activation').allowed, false); assert.equal(availability('manual').allowed, true);
  entry.aiReadAdmission.initialGenerationEnabled = true; settings.automaticUpdatesEnabled = false;
  assert.equal(availability('activation').allowed, true); assert.equal(availability('automatic').allowed, false);
  settings.automaticUpdatesEnabled = true;
});
check('New closed ticker prepares privately; notes-only is still private', () => {
  entry.active = false;
  assert.equal(probe.shouldPreparePrivateActivation({ symbol: 'TEST' }), true);
  assert.equal(probe.shouldPreparePrivateActivation({ symbol: 'TEST', generateAnalysis: false }), true);
  assert.equal(probe.captureAiReadAdmission().initialGenerationEnabled, true);
  assert.equal(probe.captureAiReadAdmission({ source: 'auto' }).initialGenerationEnabled, false);
  assert.equal(probe.shouldPreparePrivateActivation({ symbol: 'TEST', source: 'auto' }), false);
  entry.active = true;
});
check('Actual publication policy blocks a private draft and permits its owner approval', () => {
  const payload = { symbol: 'TEST', currentRead: 'Completed-session draft' };
  const gate = { cycleId: 'weekend', required: true };
  const state = { symbol: 'TEST', cycleId: 'weekend', reviewRequired: true, cancelled: false, approved: null,
    events: [{ revision: 2, body: { kind: 'original', payload } }] };
  assert.equal(policy.hasWatchlistPublicationApproval('TEST', gate, () => state), false);
  assert.equal(policy.isWatchlistPatchApproved({ symbol: 'TEST', cards: {} }, gate, () => state), false);
  state.approved = { revision: 3, body: { kind: 'approve', draftRevision: 2 } };
  assert.equal(policy.hasWatchlistPublicationApproval('TEST', gate, () => state), true);
});
const candle = (timestamp, close = 4) => ({ timestamp, open: close, high: close + .01, low: close - .01, close, volume: 100 });
const five = Array.from({ length: 12 }, (_, i) => candle(fridayEnd - (12 - i) * 300000));
const minute = [candle(fridayEnd - 60000, 4.1)];
const context = { source: 'Fixture Moomoo', fetchedAt: saturday, priorRegularClose: 3,
  intradayCandles: five, oneMinuteCandles: minute, dailyCandles: [], fourHourCandles: [] };
check('Closed quote uses actual newest completed-session candle, not wall-clock time', () => {
  for (const [, date] of closedCases.slice(0, 4)) {
    const quote = action.resolveTradersLinkAiReadReferenceQuote({ ...context, fetchedAt: at(date) }, 99, at(date));
    assert.equal(quote.price, 4.1); assert.equal(quote.dataAsOf, fridayEnd - 60000);
  }
  const quote = action.resolveTradersLinkAiReadReferenceQuote({ ...context, oneMinuteCandles: [candle(fridayEnd - 3600000, 3)] }, 99, saturday);
  assert.equal(quote.dataAsOf, five.at(-1).timestamp); assert.equal(quote.price, 4);
});
check('Missing completed-session tape is not replaced with an invented current price', () => {
  const older = { ...context, oneMinuteCandles: [], intradayCandles: five.map(bar => ({ ...bar, timestamp: bar.timestamp - 86400000 })) };
  assert.equal(action.resolveTradersLinkAiReadReferenceQuote(older, 99, saturday).price, 0);
});
check('Live quote freshness remains unchanged', () => {
  const now = at('2026-09-25T15:00:00Z');
  const older = { ...context, fetchedAt: now, oneMinuteCandles: [candle(now - 3600000)], intradayCandles: [] };
  assert.equal(action.resolveTradersLinkAiReadReferenceQuote(older, 3, now).price, 3);
});
check('Full packet retains completed-session date, timestamp and closed-market instruction', () => {
  const quote = action.resolveTradersLinkAiReadReferenceQuote(context, 99, saturday);
  assert.equal(action.hasUsableTradersLinkAiPriceAction(context, quote.dataAsOf), true);
  const packet = action.buildTradersLinkAiPriceActionPacket(context, quote.price, quote.dataAsOf);
  assert.equal(packet.marketTiming.marketClosedAtRequest, true);
  assert.equal(packet.marketTiming.tradingDate, '2026-09-25');
  assert.equal(packet.marketTiming.dataAsOf, fridayEnd - 60000);
  assert.equal(packet.observedSessionExpansion.sessionDate, '2026-09-25');
  assert.equal(packet.recentFiveMinuteBars.length, 12);
  assert.equal(market.compactAnalysisCandleTransport(packet).marketTiming.marketClosedAtRequest, true);
});
check('Changed TypeScript parses and generated admin JavaScript is valid', () => {
  for (const file of ['src/lib/ai/traderslink-ai-read-market-context.ts', 'src/lib/ai/traderslink-ai-read-price-action.ts',
    'src/lib/ai/traderslink-ai-read-review-policy.ts', 'src/lib/ai/traderslink-ai-read-service.ts',
    'src/lib/ai/watchlist-simple-analysis.ts', 'src/lib/market-data/platform-moomoo-ai-read-candle-loader.ts',
    'src/lib/monitoring/manual-watchlist-runtime-manager.ts', 'src/runtime/manual-watchlist-page.ts',
    'src/tests/traderslink-ai-read-review-policy.test.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  }
  const html = load('src/runtime/manual-watchlist-page.ts').MANUAL_WATCHLIST_PAGE;
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) new vm.Script(source);
});

(async () => {
  let calls = 0;
  transport = async url => {
    calls++; assert.equal(Number(url.searchParams.get('start')) * 1000, fridayStart);
    assert.equal(Number(url.searchParams.get('end')) * 1000, fridayEnd);
    assert.ok(url.searchParams.get('end') - url.searchParams.get('start') <= 86400);
    return { ok: true, status: 200, json: async () => ({ status: 'ready', provider: 'moomoo_open_api', candles: minute }) };
  };
  const loader = loaderModule.createPlatformMoomooAiReadCandleLoader({
    TRADERSLINK_WATCHLIST_INGEST_URL: 'https://fixture.invalid/api/live-watchlist/ingest',
    TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN: 'fixture-not-a-secret',
  });
  const response = await loader({ symbol: 'TEST', asOfTimeMs: saturday });
  check('Moomoo requests one bounded Friday window, with original candle time', () => {
    assert.equal(calls, 1); assert.equal(response.oneMinuteCandles[0].timestamp, minute[0].timestamp);
  });
  probe.chartThesisSeriesMapBySymbol = new Map(); probe.technicalContextProviderBySymbol = new Map();
  probe.technicalContextCandleStore = { getCandles: () => [] };
  const history = [];
  probe.options = { now: () => saturday, levelStore: { getLevels: () => null },
    tradersLinkAiReadMoomooCandleLoader: async () => ({ oneMinuteCandles: minute, fiveMinuteCandles: five }),
    tradersLinkAiReadHistoricalCandleLoader: async input => { history.push(input); return { series: [] }; },
  };
  const prepared = await probe.buildTradersLinkAiReadPriceActionContext('TEST', saturday);
  check('Manager retains Friday tape and requests Thursday plus existing daily/4h history', () => {
    assert.equal(prepared.intradayCandles.length, 12);
    assert.equal(history.length, 3);
    const previous = history.find(input => input.timeframes[0] === '5m');
    assert.equal(previous.fromTimeMs, at('2026-09-24T08:00:00Z'));
    assert.equal(previous.toTimeMs, at('2026-09-25T00:00:00Z'));
  });
  check('Replacement review, pre-paid price validation and closed UI copy are wired', () => {
    assert.ok(managerSource.includes('analysisFormat === "simple" || generationAvailability.session === "closed"'));
    const service = fs.readFileSync(path.join(root, 'src/lib/ai/traderslink-ai-read-service.ts'), 'utf8');
    assert.ok(service.includes('if (!(referenceQuote.price > 0) || !hasUsableTradersLinkAiPriceAction'));
    const page = fs.readFileSync(path.join(root, 'src/runtime/manual-watchlist-page.ts'), 'utf8');
    assert.ok(page.includes('Market closed: additions and manual refresh use the latest completed session. Automatic updates remain paused.'));
  });
  console.log(`${checks} bounded offline checks passed. No hosted or paid requests made.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
