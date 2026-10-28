import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';
import { WATCHLIST_ROW_REVIEW } from '../runtime/manual-watchlist-row-review.js';

test('Post Gain label preserves its existing preview action and message identity', () => {
  assert.match(WATCHLIST_ROW_REVIEW, /gainPost.textContent = 'Post Gain'/);
  assert.doesNotMatch(WATCHLIST_ROW_REVIEW, /gainPost.textContent = 'Post potential gain'/);
  assert.match(WATCHLIST_ROW_REVIEW, /type: 'post-potential-gain', symbol: entry.symbol/);
  new Script(WATCHLIST_ROW_REVIEW.match(/<script>([\s\S]*?)<\/script>/)![1]!);
});

test('Post Loss is a separate manual action with only the ticker and no automatic trade facts', () => {
  assert.match(WATCHLIST_ROW_REVIEW, /lossPost.textContent = 'Post Loss'/);
  const action = WATCHLIST_ROW_REVIEW.slice(WATCHLIST_ROW_REVIEW.indexOf('    const lossPost'), WATCHLIST_ROW_REVIEW.indexOf('    const free ='));
  assert.match(action, /type: 'post-manual-loss', symbol: entry.symbol/);
  assert.match(action, /entry.watchlistGroup !== "private"/);
  assert.doesNotMatch(action, /price|Date\.now|fetch\(|request\(/);
  new Script(WATCHLIST_ROW_REVIEW.match(/<script>([\s\S]*?)<\/script>/)![1]!);
});

test('ticker divider is one scoped top border including the first ticker, with no spacing changes', () => {
  assert.match(WATCHLIST_ROW_REVIEW, /li\.watchlist-control-row, li\.watchlist-control-row:first-child \{ border-top:2px solid #64748B; \}/);
});

test('orange applies only to the admin row ticker symbol, not badges, controls or public pages', () => {
  assert.match(WATCHLIST_ROW_REVIEW, /li\.watchlist-control-row > \.entry-main > \.entry-title > strong:first-child \{ color:#EA580C; \}/);
  const orangeRules = WATCHLIST_ROW_REVIEW.match(/[^{}]+\{[^{}]*#EA580C[^{}]*\}/g);
  assert.equal(orangeRules?.length, 1);
  assert.doesNotMatch(orangeRules![0]!, /padding|margin|border|font-size|gap|background/);
});
