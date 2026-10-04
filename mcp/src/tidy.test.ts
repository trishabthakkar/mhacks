import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyTitle } from './tidy.ts';

test('tidyTitle: one line, no wrapping quotes, no trailing period, capitalised unless it starts with code', () => {
  assert.equal(tidyTitle('  add   retry to upload client. '), 'Add retry to upload client');
  assert.equal(tidyTitle('"Fix login"'), 'Fix login');
  assert.equal(tidyTitle("'fix login'"), 'Fix login');
  assert.equal(tidyTitle('`useAuth` hook cleanup'), 'useAuth hook cleanup');
  assert.equal(tidyTitle('src/api cleanup'), 'src/api cleanup');
  assert.equal(tidyTitle('why does it fail?'), 'Why does it fail?');
  assert.equal(tidyTitle('wait for it...'), 'Wait for it...');
  assert.equal(tidyTitle('wait for it…'), 'Wait for it…');
  assert.equal(tidyTitle('line one\nline two'), 'Line one line two');
  assert.equal(tidyTitle(' "  " '), '');
  assert.equal(tidyTitle(''), '');
});

test('tidyTitle: a name made only of quotes or backticks is empty (then rejected / ignored)', () => {
  for (const q of ['"', '"""', `'"`, '`', ' " \' ']) assert.equal(tidyTitle(q), '', JSON.stringify(q));
});
