// Sprout MCP server: Streamable HTTP at /mcp (MCP TS SDK v2), GET /health.
// One fresh McpServer per request (createMcpHandler), bound to the member named by the
// X-Sprout-Member header (fallback ?member=). All state lives in the SproutDb.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { SproutDb } from './db.ts';
import { makeHandlers, registerTools } from './tools.ts';

const HANDLE_RE = /^[a-z0-9_-]{1,32}$/;

export function memberFrom(header: string | null | undefined, query: string | null | undefined): string | null {
  for (const raw of [header, query]) {
    const m = raw?.trim().toLowerCase().replace(/^@/, '');
    if (m && HANDLE_RE.test(m)) return m;
  }
  return null;
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * DNS-rebinding guard (the SDK's express app 403s any non-localhost Host by default).
 * Allowed: localhost, SPROUT_ALLOWED_HOSTS, or any request that came through a reverse
 * proxy (X-Forwarded-For set — Caddy on the VM; a browser can't add that header without
 * a CORS preflight we never answer, and the server binds 127.0.0.1 there).
 */
export function hostAllowed(host: string | undefined, forwardedFor: string | undefined, allowed: string[]): boolean {
  if (forwardedFor) return true;
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return LOCAL_HOSTS.includes(name.toLowerCase()) || allowed.includes(name.toLowerCase());
}

export interface AppOptions { version: string; allowedHosts?: string[]; impl?: string }

export function makeApp(db: SproutDb, opts: AppOptions) {
  const allowed = (opts.allowedHosts ?? []).map((h) => h.toLowerCase());
  const handlers = makeHandlers(db);
  const mcp = createMcpHandler(({ requestInfo }) => {
    const url = requestInfo ? new URL(requestInfo.url) : undefined;
    const member = memberFrom(requestInfo?.headers.get('x-sprout-member'), url?.searchParams.get('member'));
    const server = new McpServer({ name: 'sprout', version: opts.version });
    registerTools(server, handlers, member);
    return server;
  });
  const node = toNodeHandler(mcp);

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (hostAllowed(req.get('host'), req.get('x-forwarded-for'), allowed)) return next();
    res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: `Invalid Host: ${req.get('host')}` }, id: null });
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, db: db.connection(), version: opts.version, ...(opts.impl ? { impl: opts.impl } : {}) });
  });

  app.all('/mcp', (req, res) => {
    if (process.env.LOG_REQUESTS) {
      const b = req.body as { method?: string; params?: { name?: string } } | undefined;
      console.log(`${req.method} /mcp member=${req.get('x-sprout-member') ?? req.query.member ?? '-'} rpc=${b?.method ?? '-'}${b?.params?.name ? `(${b.params.name})` : ''}`);
    }
    void node(req, res, req.body);
  });

  return { app, close: () => mcp.close() };
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

async function main() {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '127.0.0.1';
  const sha = gitSha();
  const version = `${process.env.npm_package_version ?? '0.0.0'}${sha ? `+${sha}` : ''}`;
  const allowedHosts = (process.env.SPROUT_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const { openDb } = await import('./openDb.ts');
  const { db, impl } = await openDb();
  const { app, close } = makeApp(db, { version, allowedHosts, impl });
  const http = app.listen(port, host, () => {
    console.log(`sprout-mcp ${version} (${impl} db) on http://${host}:${port}/mcp`);
  });
  const stop = async () => { await close(); http.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
