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
