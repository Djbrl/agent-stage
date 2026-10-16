// The only door between the sandboxes and the outside world. It runs in its own small container that sits on
// two networks: the sealed one the sandboxes live on (which has no internet), and the normal one.
//   :4000  sandbox → manager: model calls only (/v1/...), forwarded to the manager on the host.
//   :4001  manager → sandbox: browser traffic for one visitor, only with the secret the manager holds.
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';

const MANAGER = process.env.MANAGER_URL ?? 'http://host.docker.internal:8080';
const SECRET = process.env.RELAY_SECRET ?? '';
if (!SECRET) throw new Error('RELAY_SECRET missing');

function pipe(req: IncomingMessage, res: ServerResponse, target: URL, headers: Record<string, any>) {
  const out = request(target, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(out);
  res.on('close', () => out.destroy());
}

// Sandbox side: nothing but the model API.
createServer((req, res) => {
  if (!req.url?.startsWith('/v1/')) { res.writeHead(403); return res.end('only the model API is reachable from the sandbox'); }
  pipe(req, res, new URL(req.url, MANAGER), { ...req.headers, host: new URL(MANAGER).host });
}).listen(4000);

// Manager side: route to one sandbox by name.
createServer((req, res) => {
  const target = String(req.headers['x-agst-target'] ?? '');
  if (req.headers['x-agst-secret'] !== SECRET || !/^sess-[a-z0-9]+$/.test(target)) { res.writeHead(403); return res.end(); }
  const { 'x-agst-secret': _s, 'x-agst-target': _t, ...headers } = req.headers;
  pipe(req, res, new URL(req.url ?? '/', `http://${target}:3000`), { ...headers, host: `${target}:3000` });
}).listen(4001);

console.log('relay up');
