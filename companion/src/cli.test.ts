import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP } from './cli.ts';

test('help lists every command', () => {
  for (const c of ['join', 'daemon', 'hook <event>', 'shell-init <zsh|bash>', 'pause', 'resume', 'status']) {
    assert.ok(HELP.includes(c), c);
  }
});
