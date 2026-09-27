// Offline request-builder checkpoint; no API calls, server or filesystem writes.
// Usage: node scripts/verify-watchlist-output-allowance.cjs <typescript.js path>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
const filename = path.join(__dirname, '../src/lib/ai/traderslink-ai-read-service.ts');
const source = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const builder = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildRequestBody');
assert.ok(builder);
const compiled = ts.transpileModule(builder.getText(ast) + '\nglobalThis.build = buildRequestBody;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
});
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
// Only data/prompt dependencies are stubbed. Execute the actual request builder.
const context = {
  buildSimpleAnalysisTestRequest: () => ({ max_output_tokens: 16000, input: [], text: { format: 'fixture' } }),
  simpleMarketPacket: () => ({}), compactResearch: () => ({}), compactSnapshot: () => ({}),
  buildTradersLinkAiReadResponseSchema: () => ({}), buildTradersLinkAiReadDeveloperPrompt: () => 'fixture',
  stockTitanSearchAllowed: () => false,
};
vm.runInNewContext(compiled.outputText, context);
let checks = 0;
for (const analysisFormat of ['full', 'simple']) {
  for (const effort of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) {
    for (const configured of [16000, 48000]) {
      const body = context.build({ model: 'gpt-6-luna', reasoningEffort: effort,
        maxOutputTokens: configured, webSearchEnabled: false, dataAsOf: 0,
        input: { analysisFormat, ownerReviewRequired: true, research: {} } });
      assert.equal(body.max_output_tokens, effort === 'xhigh' ? Math.max(configured, 32000) : configured);
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.reasoning.effort, effort);
      assert.equal(body.tools, undefined);
      checks++;
    }
  }
}
assert.throws(() => context.build({ maxOutputTokens: 16000, reasoningEffort: 'xhigh',
  input: { analysisFormat: 'simple', ownerReviewRequired: false } }), /requires owner review/);
checks++;
console.log(`PASS ${checks} output allowance checks (full/simple, all efforts, larger override, web search off, review guard)`);
