import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinceCardHtml } from './sinceCard.ts';

test('sinceCardHtml: title, one button per line carrying its pick, a close button; agent text is escaped', () => {
  const h = sinceCardHtml({ title: 'Since you were last here (2h ago)', lines: [{ text: '🔒 <b>x</b> fenced src/', pick: { kind: 'plant', key: 'src/a"b.ts' } }, { text: '🌧️ 2 commits', pick: null }] });
  assert.match(h, /Since you were last here \(2h ago\)/);
  assert.match(h, /data-pick="plant:src\/a&quot;b.ts"/);
  assert.ok(!h.includes('<b>x</b>') && h.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.match(h, /data-close/);
  assert.equal((h.match(/<button class="ln"/g) ?? []).length, 2);
});
