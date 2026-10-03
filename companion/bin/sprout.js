#!/usr/bin/env node
// Fast path: the esbuild bundle in dist/ (built by `npm ci` via prepare, or `npm run build`).
// If src/ or shared/ is newer than the bundle (e.g. after `git pull`), rebuild it first.
// Dev fallback: run the TypeScript sources through tsx (SPROUT_DEV=1 forces it).
import { readdirSync, statSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const dist = here('../dist/cli.js');

function newestSource() {
  let newest = 0;
  for (const dir of ['../src/', '../src/module_bindings/', '../../shared/']) {
    let names = [];
    try { names = readdirSync(here(dir)); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.ts') || n.endsWith('.test.ts')) continue;
      try { newest = Math.max(newest, statSync(here(dir + n)).mtimeMs); } catch { /* raced */ }
    }
  }
  return newest;
}

async function rebuild() {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [new URL('../src/cli.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', target: 'node22', splitting: true,
    outdir: new URL('../dist', import.meta.url).pathname, logLevel: 'silent',
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  });
}

let main;
if (!process.env.SPROUT_DEV) {
  try {
    let built = 0;
    try { built = statSync(dist).mtimeMs; } catch { /* not built */ }
    if (!built || newestSource() > built) await rebuild();
    ({ main } = await import(dist.href));
  } catch { /* fall back to tsx */ }
}
if (!main) {
  const { register } = await import('tsx/esm/api');
  register();
  ({ main } = await import('../src/cli.ts'));
}
const code = await main(process.argv.slice(2));
process.exit(code ?? 0);
