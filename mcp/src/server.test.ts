import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from './server.ts';

test('GET /health returns ok', async () => {
  const s = makeServer();
  await new Promise<void>((r) => s.listen(0, r));
  const { port } = s.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: 'sprout-mcp' });
  s.close();
});
