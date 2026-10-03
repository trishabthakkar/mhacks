import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export function makeServer() {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'sprout-mcp' }));
      return;
    }
    // TODO(contract): POST /mcp — Streamable HTTP MCP endpoint with the team tools (P2).
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  makeServer().listen(port, () => console.log(`sprout-mcp listening on :${port}`));
}
