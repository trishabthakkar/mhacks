// Tiny HTTP/1.1 client for the local daemon on node:net. Importing node:http costs ~60ms
// of startup; node:net ~10ms, and hooks run on every tool call. Hard timeouts.
import { connect } from 'node:net';

export const HOOK_TIMEOUT_MS = 500;

function decodeChunked(body: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  for (;;) {
    const nl = body.indexOf('\r\n', i);
    if (nl < 0) break;
    const size = parseInt(body.subarray(i, nl).toString('latin1'), 16);
    if (!size) break;
    out.push(body.subarray(nl + 2, nl + 2 + size));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

export function call<T = unknown>(port: number, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = HOOK_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const sock = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null, v?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      err ? reject(err) : resolve(v as T);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('daemon timeout'), { code: 'ETIMEDOUT' })), timeoutMs);
    sock.on('connect', () => {
      const head = `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n` +
        (method === 'POST' ? `Content-Type: application/json\r\nContent-Length: ${data.length}\r\n` : '') + '\r\n';
      sock.write(head);
      if (data.length) sock.write(data);
    });
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', (e) => finish(e));
    sock.on('end', () => {
      const raw = Buffer.concat(chunks);
      const sep = raw.indexOf('\r\n\r\n');
      if (sep < 0) return finish(new Error('bad response from daemon'));
      const headers = raw.subarray(0, sep).toString('latin1');
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(headers)?.[1] ?? 500);
      let payload = raw.subarray(sep + 4);
      if (/\r\ntransfer-encoding:\s*chunked/i.test(headers)) payload = decodeChunked(payload) as typeof payload;
      const text = payload.toString('utf8');
      if (status >= 400) return finish(new Error(`daemon ${status}: ${text}`));
      try { finish(null, (text ? JSON.parse(text) : undefined) as T); } catch (e) { finish(e as Error); }
    });
  });
}

export function isDown(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOENT';
}
