import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_KINDS } from '../../../shared/constants.ts';
import { sentence } from './sentences.ts';

test('every activity kind has a plain-English sentence', () => {
  for (const kind of ACTIVITY_KINDS) {
    const s = sentence({ id: 1, at: 0, handle: 'ivy', kind, path: 'src/a/b.ts', detail: 'x' });
    assert.ok(typeof s === 'string' && s.length > 3, `no sentence for ${kind}`);
    assert.ok(s.includes('ivy') || s.includes('botanist') || s.includes('seedling') || s.includes('bee') || s.includes('garden'), `${kind}: "${s}" names nobody`);
  }
});

test('missing path does not crash', () => {
  assert.ok(sentence({ id: 1, at: 0, handle: 'a', kind: 'edit', detail: '' }).length > 0);
});

test('folder paths keep their name', () => {
  assert.match(sentence({ id: 1, at: 0, handle: 'ivy', kind: 'claim', path: 'src/api/', detail: '' }), /fenced off api/);
  assert.match(sentence({ id: 1, at: 0, handle: 'ivy', kind: 'release', path: 'src/api/', detail: '' }), /around api/);
});

test('Claude sessions and helpers are named plainly (no "bot"/"bee" jargon); a fence stop says so', () => {
  const s = (kind: string, detail = '') => sentence({ id: 1, at: 0, handle: 'ivy', kind: kind as never, path: 'src/a.ts', detail });
  assert.equal(s('session_start'), "ivy's Claude woke up");
  assert.equal(s('session_end'), "ivy's Claude went to sleep");
  assert.equal(s('tool_error'), "ivy's Claude hit a snag");
  assert.equal(s('subagent_start'), "a helper set off from ivy's Claude");
  assert.equal(s('subagent_stop'), "ivy's helper finished");
  assert.equal(s('blocked_edit', 'a fence held by sam'), 'ivy was stopped by a fence held by sam');
});

test('no sentence calls a Claude a "bot"', () => {
  for (const kind of ACTIVITY_KINDS) {
    const s = sentence({ id: 1, at: 0, handle: 'ivy', kind, path: 'src/a.ts', detail: 'x' });
    assert.ok(!/\bbot\b/.test(s), `${kind}: "${s}"`);
  }
});
