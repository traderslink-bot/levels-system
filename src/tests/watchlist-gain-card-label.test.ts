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
