// Tiny HTTP client for the local daemon. node:http only (fast startup), hard timeouts.
import { request } from 'node:http';

export const HOOK_TIMEOUT_MS = 500;

export function call<T = unknown>(port: number, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = HOOK_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({
      host: '127.0.0.1', port, method, path, agent: false,
      headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`daemon ${res.statusCode}: ${text}`));
        try { resolve((text ? JSON.parse(text) : undefined) as T); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('daemon timeout')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export function isDown(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOENT';
}
