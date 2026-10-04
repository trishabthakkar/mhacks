import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detail, maskSecrets, redactCommand, relPath } from './redact.ts';

test('non-test commands reduce to binary + subcommand', () => {
  assert.equal(redactCommand('git commit -m "fix the thing for bob@example.com"'), 'git commit');
  assert.equal(redactCommand('git push origin main'), 'git push');
  assert.equal(redactCommand('curl -H "Authorization: Bearer abcdef1234567890" https://api.x.com'), 'curl');
  assert.equal(redactCommand('/usr/local/bin/python3 scripts/migrate.py --password hunter2'), 'python3');
  assert.equal(redactCommand('ls -la'), 'ls');
  assert.equal(redactCommand('  cat   secrets.txt '), 'cat');
  assert.equal(redactCommand('OPENAI_API_KEY=sk-abc123def456ghi789 node server.js'), 'node');
  assert.equal(redactCommand('sudo docker compose up'), 'docker compose');
  assert.equal(redactCommand('npx prisma migrate dev'), 'prisma migrate');
  assert.equal(redactCommand('npm run build'), 'npm run');
  assert.equal(redactCommand('echo $TOKEN | pbcopy'), 'echo');
  assert.equal(redactCommand('psql postgres://admin:pw@db.internal/prod'), 'psql');
  assert.equal(redactCommand(''), '');
  assert.equal(redactCommand('FOO=bar'), '');
});

test('subcommand that looks like data is dropped', () => {
  assert.equal(redactCommand('export AWS_SECRET_ACCESS_KEY=abc'), 'export');
  assert.equal(redactCommand('echo AKIAABCDEFGHIJKLMNOP'), 'echo');
  assert.equal(redactCommand('cd ~/secret-project'), 'cd');
  assert.equal(redactCommand('git ghp_abcdefghijklmnopqrstuvwxyz0123'), 'git');
});

test('test commands keep up to 120 chars with secrets masked', () => {
  assert.equal(redactCommand('npm test'), 'npm test');
  assert.equal(redactCommand('npx vitest run src/api'), 'npx vitest run src/api');
  assert.equal(redactCommand('API_TOKEN=abc123 npm test -- --grep auth'), 'API_TOKEN=*** npm test -- --grep auth');
  assert.equal(redactCommand('DATABASE_URL=postgres://u:p@h/db pytest -k login'), 'DATABASE_URL=postgres://***@h/db pytest -k login');
  assert.equal(redactCommand('STRIPE=sk-live-abcdefghijklmnop1234 go test ./...'), 'STRIPE=*** go test ./...');
  const long = 'pytest ' + 'tests/test_a.py '.repeat(20);
  assert.ok(redactCommand(long).length <= 120);
  assert.ok(redactCommand(long).endsWith('…'));
  assert.equal(redactCommand('node --test src/*.test.ts'), 'node --test src/*.test.ts');
  assert.equal(redactCommand('cargo test --release'), 'cargo test --release');
});

test('maskSecrets: API keys and tokens', () => {
  for (const s of [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'sk-proj-AbCdEf1234567890xyz', 'ghp_0123456789abcdefghijABCDEFGHIJ0123',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'AKIAIOSFODNN7EXAMPLE', 'xoxb-1234567890-abcdefghij',
    'AIzaSyA1234567890abcdefghijklmnopqrstuv', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'd41d8cd98f00b204e9800998ecf8427ed41d8cd98f00b204', 'Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A=',
  ]) {
    const out = maskSecrets(`x ${s} y`);
    assert.ok(!out.includes(s), `${s} → ${out}`);
    assert.ok(out.includes('***'), out);
  }
});

test('maskSecrets: key=value, flags, URLs with credentials, emails', () => {
  assert.equal(maskSecrets('password=hunter2 user=bob'), 'password=*** user=bob');
  assert.equal(maskSecrets('DB_PASS="a b c"'), 'DB_PASS=***');
  assert.equal(maskSecrets('api_key: abc123'), 'api_key: ***');
  assert.equal(maskSecrets('--token abc123 --verbose'), '--token *** --verbose');
  assert.equal(maskSecrets('--password=xyz'), '--password=***');
  assert.equal(maskSecrets('https://user:pass@github.com/x.git'), 'https://***@github.com/x.git');
  assert.equal(maskSecrets('https://ghtoken@github.com/x.git'), 'https://***@github.com/x.git');
  assert.equal(maskSecrets('mail alex@umich.edu now'), 'mail <email> now');
  assert.equal(maskSecrets('Authorization: Bearer abc.def.ghi123456'), 'Authorization: *** ***');
  assert.equal(maskSecrets('-H "Bearer abcdefgh12345678"'), '-H "Bearer ***"');
});

test('maskSecrets leaves ordinary text and paths alone', () => {
  for (const s of ['npm test', 'src/components/GardenBedRenderer/index.test.ts', 'pytest -k test_login', 'go test ./...']) {
    assert.equal(maskSecrets(s), s);
  }
});

test('relPath: repo-relative, drops anything outside', () => {
  assert.equal(relPath('/Users/a/proj', '/Users/a/proj/src/x.ts'), 'src/x.ts');
  assert.equal(relPath('/Users/a/proj', 'src/x.ts', '/Users/a/proj'), 'src/x.ts');
  assert.equal(relPath('/Users/a/proj', 'x.ts', '/Users/a/proj/src'), 'src/x.ts');
  assert.equal(relPath('/Users/a/proj', '/Users/a/proj/../other/x.ts'), undefined);
  assert.equal(relPath('/Users/a/proj', '/etc/passwd'), undefined);
  assert.equal(relPath('/Users/a/proj', '/Users/a/project2/x.ts'), undefined);
  assert.equal(relPath('/Users/a/proj', '/Users/a/proj'), undefined);
  assert.equal(relPath('/Users/a/proj', undefined), undefined);
});

test('detail: masked, single line, ≤160', () => {
  assert.equal(detail('a\n b'), 'a b');
  assert.equal(detail('token=abc'), 'token=***');
  assert.ok(detail('x'.repeat(500))!.length <= 160);
  assert.equal(detail(''), undefined);
});

test('relPath and repoFor see through symlinks (macOS /var -> /private/var)', async () => {
  const { mkdtempSync, mkdirSync, symlinkSync, realpathSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { repoFor } = await import('./config.ts');
  const real = realpathSync(mkdtempSync(join(tmpdir(), 'sprout-link-')));
  mkdirSync(join(real, 'repo/src'), { recursive: true });
  writeFileSync(join(real, 'repo/src/a.ts'), 'x');
  symlinkSync(join(real, 'repo'), join(real, 'link'), 'junction'); // junction: no admin needed on Windows, ignored elsewhere
  const viaLink = join(real, 'link/src/a.ts');
  assert.equal(relPath(join(real, 'repo'), viaLink), 'src/a.ts');
  assert.equal(relPath(join(real, 'link'), join(real, 'repo/src/a.ts')), 'src/a.ts');
  assert.equal(relPath(join(real, 'repo'), join(real, 'link/src/new.ts')), 'src/new.ts'); // file not created yet
  assert.equal(relPath(join(real, 'repo'), join(real, 'repo/..foo')), '..foo'); // not "outside"
  assert.equal(relPath(join(real, 'repo'), join(real, 'elsewhere.ts')), undefined);
  const cfg = { repos: [{ name: 'team/x', root: join(real, 'repo') }] } as never;
  assert.equal(repoFor(cfg, viaLink)?.name, 'team/x');
});
