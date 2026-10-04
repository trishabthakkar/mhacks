import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spiritText } from './scene/spiritText.ts';

test('spirit bubble: action + file basename, ≤24 chars, fallback to action', () => {
  assert.equal(spiritText('read', 'mcp/src/time.ts'), 'read time.ts');
  assert.equal(spiritText('search', undefined), 'search');
  assert.ok(spiritText('edit', 'a/very/long/path/some_really_long_file_name.test.ts').length <= 24);
  assert.equal(spiritText('Explore', undefined), 'Explore');
});
