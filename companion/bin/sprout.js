#!/usr/bin/env node
// Fast path: the esbuild bundle in dist/ (built by `npm run build` / on install).
// Dev fallback: run the TypeScript sources through tsx (SPROUT_DEV=1 forces it).
import { existsSync } from 'node:fs';

const dist = new URL('../dist/cli.js', import.meta.url);
let main;
if (existsSync(dist) && !process.env.SPROUT_DEV) {
  ({ main } = await import(dist.href));
} else {
  const { register } = await import('tsx/esm/api');
  register();
  ({ main } = await import('../src/cli.ts'));
}
const code = await main(process.argv.slice(2));
process.exit(code ?? 0);
