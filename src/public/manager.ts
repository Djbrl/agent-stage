// The online demo, run from this computer (`npm run public`). Every visitor gets a private, disposable sandbox:
// a Docker container running agent-stage in public mode on a sealed network with no internet. The manager:
//   · serves the "start your sandbox" page (with an optional invite code), one sandbox per visitor (cookie);
//   · proxies the visitor's browser to their sandbox (through the relay, the sealed network's only door);
//   · answers the sandboxes' model calls itself, with the real key, and a token budget per sandbox;
//   · deletes sandboxes after IDLE_MIN minutes without activity, and all of them when it stops.
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../store.ts';

const PORT = Number(process.env.PORT ?? 8080);
const INVITE = process.env.INVITE ?? ''; // empty = anyone with the link
const MAX = Number(process.env.MAX_SESSIONS ?? 5);
const IDLE_MIN = Number(process.env.IDLE_MIN ?? 20);
const BUDGET = Number(process.env.TOKEN_BUDGET ?? 400_000); // model tokens per sandbox
const IMAGE = 'agent-stage-sandbox', NET = 'agst-sandbox', RELAY = 'agst-relay', RELAY_PORT = 8099;
const SECRET = randomBytes(24).toString('hex');

type Session = { id: string; token: string; lastSeen: number; tokens: number; ready: boolean };
const sessions = new Map<string, Session>(); // cookie id → session
const byToken = new Map<string, Session>();

const docker = (args: string[]) => new Promise<string>((ok, fail) =>
  execFile('docker', args, { maxBuffer: 1 << 20 }, (err, out, errOut) => (err ? fail(new Error(String(errOut || err.message).trim())) : ok(out.trim()))));

// The model the sandboxes use: PUBLIC_MODEL_* if set, else whatever is active in agent-stage's settings here
// (e.g. the Brev GPU). If it isn't answering (GPU off), new sandboxes get the scripted demo model instead.
type Model = { baseUrl: string; apiKey: string; model: string; name: string };
async function configured(): Promise<Model | null> {
  if (process.env.PUBLIC_MODEL === 'mock') return null;
  if (process.env.PUBLIC_MODEL_URL) return { baseUrl: process.env.PUBLIC_MODEL_URL, apiKey: process.env.PUBLIC_MODEL_KEY ?? '', model: process.env.PUBLIC_MODEL_NAME ?? '', name: process.env.PUBLIC_MODEL_NAME ?? 'Live model' };
  const s = JSON.parse(await readFile(join(DATA_DIR, 'settings.json'), 'utf8').catch(() => '{}'));
  const p = s.providers?.find((x: any) => x.id === s.activeProvider);
  return p?.kind === 'openai' && p.apiKey ? { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, name: p.model.split('/').pop() } : null;
}
const model = configured;
let live = { at: 0, up: false };
async function modelUp() {
  if (Date.now() - live.at < 20_000) return live.up;
  const m = await configured();
  const up = m ? await fetch(`${m.baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${m.apiKey}` }, signal: AbortSignal.timeout(4000) })
    .then(async (r) => r.ok && JSON.stringify(await r.json()).includes(m.model), () => false) : false;
  live = { at: Date.now(), up };
  return up;
}

// ── infrastructure: the sealed network and the relay ───────────────────────
async function setup() {
  await docker(['image', 'inspect', IMAGE]).catch(() => { throw new Error(`No ${IMAGE} image. Run: npm run public (it builds it).`); });
  await docker(['network', 'inspect', NET]).catch(() => docker(['network', 'create', '--internal', NET]));
  await docker(['rm', '-f', RELAY]).catch(() => {});
  await docker(['run', '-d', '--name', RELAY, '-p', `127.0.0.1:${RELAY_PORT}:4001`,
    '--add-host', 'host.docker.internal:host-gateway', '-e', `RELAY_SECRET=${SECRET}`, '-e', `MANAGER_URL=http://host.docker.internal:${PORT}`,
    '--memory', '256m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', IMAGE, 'src/public/relay.ts']);
  await docker(['network', 'connect', NET, RELAY]); // the relay alone sits on both networks
  for (const name of (await docker(['ps', '-aq', '--filter', 'name=^sess-'])).split('\n').filter(Boolean)) await docker(['rm', '-f', name]);
}

async function startSession(): Promise<Session> {
  const m = (await modelUp()) ? await model() : null; // null → scripted demo model
  const s: Session = { id: randomBytes(6).toString('hex'), token: randomBytes(24).toString('hex'), lastSeen: Date.now(), tokens: 0, ready: false };
  await docker(['run', '-d', '--name', `sess-${s.id}`, '--network', NET,
    '--memory', '1536m', '--cpus', '1', '--pids-limit', '512', '--shm-size', '256m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:size=512m',
    '-e', `MODEL_BASE_URL=http://${RELAY}:4000/v1`, '-e', `MODEL_API_KEY=${m ? s.token : 'mock'}`, '-e', `MODEL_NAME=${m?.model ?? 'mock'}`, '-e', `MODEL_LABEL=${m ? `${m.name} · live GPU` : 'Demo (scripted)'}`,
    IMAGE]);
  sessions.set(s.id, s); byToken.set(s.token, s);
  for (let i = 0; i < 60 && !s.ready; i++) { // wait for its server to answer
    await new Promise((r) => setTimeout(r, 500));
    s.ready = await fetch(`http://127.0.0.1:${RELAY_PORT}/api/me`, { headers: { 'x-agst-secret': SECRET, 'x-agst-target': `sess-${s.id}` } }).then((r) => r.ok, () => false);
  }
  if (!s.ready) { await stopSession(s); throw new Error('sandbox did not start'); }
  return s;
}

async function stopSession(s: Session) {
  sessions.delete(s.id); byToken.delete(s.token);
  await docker(['rm', '-f', `sess-${s.id}`]).catch(() => {});
}

// ── model calls from the sandboxes (they arrive through the relay) ─────────
async function modelCall(req: IncomingMessage, res: ServerResponse) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const s = byToken.get(token);
  if (!s) { res.writeHead(401); return res.end('unknown sandbox'); }
  if (s.tokens > BUDGET) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'This demo sandbox used its model budget. Thanks for trying it!' } })); }
  const m = await model();
  if (!m) { res.writeHead(503); return res.end('no model'); }
  s.lastSeen = Date.now();
  const body = await new Promise<Buffer>((ok) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const path = (req.url ?? '').replace(/^\/v1/, '');
  let payload: any = body.length ? JSON.parse(body.toString()) : undefined;
  if (payload?.model) payload = { ...payload, model: m.model }; // the sandbox can't pick another model
  const up = await fetch(m.baseUrl.replace(/\/$/, '') + path, {
    method: req.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${m.apiKey}` },
    body: payload ? JSON.stringify(payload) : undefined,
  }).catch((e) => e as Error);
  if (up instanceof Error) { res.writeHead(502); return res.end(`model unreachable: ${up.message}`); }
  const text = await up.text();
  try { const u = JSON.parse(text).usage; if (u) s.tokens += (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0); } catch {}
  res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
  res.end(text);
}

// ── the visitor's browser ───────────────────────────────────────────────────
const cookieOf = (req: IncomingMessage) => /(?:^|; )agst=([a-f0-9]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function proxy(req: IncomingMessage, res: ServerResponse, s: Session) {
  s.lastSeen = Date.now();
  const { cookie: _c, host: _h, ...headers } = req.headers;
  const out = request({ host: '127.0.0.1', port: RELAY_PORT, path: req.url, method: req.method,
    headers: { ...headers, 'x-agst-secret': SECRET, 'x-agst-target': `sess-${s.id}` } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
    up.on('data', () => (s.lastSeen = Date.now())); // a live run counts as activity
  });
  out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(out);
  res.on('close', () => out.destroy());
}

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/v1/')) return await modelCall(req, res);
    const s = sessions.get(cookieOf(req) ?? '');
    if (req.method === 'POST' && req.url === '/__start') {
      const body = await new Promise<string>((ok) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => ok(b)); });
      const code = new URLSearchParams(body).get('code') ?? '';
      if (INVITE && !same(code, INVITE)) return page(res, 'That code is not right.');
      if (s) { res.writeHead(303, { location: '/' }); return res.end(); }
      if (sessions.size >= MAX) return page(res, 'All demo sandboxes are busy right now. Try again in a few minutes.');
      const n = await startSession();
      res.writeHead(303, { location: '/', 'set-cookie': `agst=${n.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400` });
      return res.end();
    }
    if (s) return proxy(req, res, s);
    if (req.url?.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"sandbox expired"}'); }
    return page(res);
  } catch (e: any) {
    console.error(e);
    if (!res.headersSent) page(res, `Something went wrong: ${e.message}`);
  }
}).listen(PORT, () => console.log(`demo manager on http://localhost:${PORT}  ·  max ${MAX} sandboxes  ·  ${INVITE ? 'invite code required' : 'no invite code'}`));

async function page(res: ServerResponse, message = '') {
  const up = await modelUp().catch(() => false);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>agent-stage · live demo</title>
<style>
  :root { color-scheme: dark; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0c0e; color: #e7e9ee; font: 15px/1.55 system-ui, sans-serif; }
  main { width: min(440px, calc(100% - 32px)); } h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 8px; } p { color: #9aa1ad; }
  form { display: flex; gap: 8px; margin-top: 22px; } input { flex: 1; padding: 10px 12px; border-radius: 9px; border: 1px solid #2a2e36; background: #14161a; color: inherit; font: inherit; }
  button { padding: 10px 16px; border-radius: 9px; border: 0; background: #e7e9ee; color: #0b0c0e; font: inherit; font-weight: 600; cursor: pointer; }
  .msg { color: #f5b84a; } .busy button { opacity: .6; pointer-events: none; }
</style>
<main><h1>agent-stage, live</h1>
<p>Watch an AI coding agent work on a real project, on a map. You get your own private sandbox with sample projects: the agent really edits files, runs tests and uses a browser inside it. It's deleted ${IDLE_MIN} minutes after you leave.</p>
<p>${up ? '● The live model is <b style="color:#3ecf8e">online</b>: an open model on our GPU does the work.' : '○ The live model is offline right now, so the sandbox runs a scripted demo model. Everything else is real.'}</p>
${message ? `<p class="msg">${message.replace(/</g, '&lt;')}</p>` : ''}
<form method="post" action="/__start" onsubmit="this.classList.add('busy');this.querySelector('button').textContent='Starting your sandbox…'">
  ${INVITE ? '<input name="code" placeholder="Invite code" autocomplete="off" required>' : ''}<button>Start my sandbox</button>
</form></main>`);
}

// Idle sandboxes go away; everything goes away when the manager stops.
setInterval(() => { for (const s of sessions.values()) if (Date.now() - s.lastSeen > IDLE_MIN * 60_000) void stopSession(s); }, 60_000);
let quitting = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => {
  if (quitting) return; quitting = true;
  console.log('\nremoving sandboxes…');
  await Promise.all([...sessions.values()].map(stopSession));
  await docker(['rm', '-f', RELAY]).catch(() => {});
  process.exit(0);
});
await setup();
