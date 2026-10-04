import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipWords, tidy } from './fmt.ts';

test('tidy: same rules as the MCP tidyTitle (one line, no wrapping quotes or trailing period, capitalised unless code)', () => {
  assert.equal(tidy('  add   retry to upload client. '), 'Add retry to upload client');
  assert.equal(tidy('"Fix login"'), 'Fix login');
  assert.equal(tidy('`useAuth` hook cleanup'), 'useAuth hook cleanup');
  assert.equal(tidy('src/api cleanup'), 'src/api cleanup');
  assert.equal(tidy('why does it fail?'), 'Why does it fail?');
  assert.equal(tidy('wait for it...'), 'Wait for it...');
  assert.equal(tidy(' "  " '), '');
});

test('clipWords cuts at a word boundary with an ellipsis', () => {
  assert.equal(clipWords('Add retry to the upload client', 18), 'Add retry to the…');
  assert.equal(clipWords('short', 18), 'short');
  assert.equal(clipWords('Supercalifragilisticexpialidocious', 10), 'Supercali…');
  assert.equal(clipWords('Fix it, then ship', 9), 'Fix it…');
});
