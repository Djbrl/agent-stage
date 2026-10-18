// The only door between the sandboxes and the outside world. It runs in its own small container that sits on
// two networks: the sealed one the sandboxes live on (which has no internet), and the normal one.
//   :4000  sandbox → manager: model calls only (/v1/... and Claude's /anthropic/v1/...), forwarded to the manager on the host.
//   :4001  manager → sandbox: browser traffic for one visitor, only with the secret the manager holds.
//   :4002  sandbox → internet (only with INTERNET=1): an HTTP(S) proxy to public addresses on ports 80 and 443.
//          Never this computer, the home network or the other containers: every name is resolved here and private,
//          loopback and link-local addresses are refused, so a redirect or DNS trick can't reach them either.
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { publicAddress } from './address.ts';

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
  if (!req.url?.startsWith('/v1/') && !req.url?.startsWith('/anthropic/v1/')) { res.writeHead(403); return res.end('only the model API is reachable from the sandbox'); }
  pipe(req, res, new URL(req.url, MANAGER), { ...req.headers, host: new URL(MANAGER).host });
}).listen(4000);

// Manager side: route to one sandbox by name.
createServer((req, res) => {
  const target = String(req.headers['x-agst-target'] ?? '');
  if (req.headers['x-agst-secret'] !== SECRET || !/^sess-[a-z0-9]+$/.test(target)) { res.writeHead(403); return res.end(); }
  const { 'x-agst-secret': _s, 'x-agst-target': _t, ...headers } = req.headers;
  pipe(req, res, new URL(req.url ?? '/', `http://${target}:3000`), { ...headers, host: `${target}:3000` });
}).listen(4001);

// Internet for the sandboxes, public addresses only (see address.ts).
if (process.env.INTERNET === '1') {
  const proxy = createServer(async (req, res) => { // plain http://
    try {
      const url = new URL(req.url ?? '');
      if (url.protocol !== 'http:' || (url.port && url.port !== '80')) throw new Error('port');
      const ip = await publicAddress(url.hostname);
      const { 'proxy-connection': _p, 'proxy-authorization': _a, ...headers } = req.headers;
      const out = request({ host: ip, port: 80, method: req.method, path: url.pathname + url.search, headers: { ...headers, host: url.host } }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res);
      });
      out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(out);
    } catch { res.writeHead(403); res.end('only public websites on ports 80 and 443'); }
  });
  proxy.on('connect', async (req, client, head) => { // https:// (and git, pip, npm over TLS)
    const [host, port] = String(req.url).split(/:(?=\d+$)/);
    try {
      if (port !== '443') throw new Error('port');
      const ip = await publicAddress(host);
      const up = connect(443, ip, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(client); client.pipe(up); });
      up.setTimeout(10 * 60_000, () => up.destroy());
      up.on('error', () => client.destroy()); client.on('error', () => up.destroy());
    } catch { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
  });
  proxy.listen(4002);
}

console.log(`relay up${process.env.INTERNET === '1' ? ', with internet' : ''}`);
