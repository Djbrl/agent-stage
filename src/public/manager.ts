// The online demo, run from this computer (`npm run public`). Every visitor gets a private, disposable sandbox:
// a Docker container running agent-stage in public mode on a sealed network. Its only door is the relay: model calls, and (INTERNET, on with an invite code) public websites. The manager:
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
const INVITE = process.env.INVITE ?? ''; // public.sh sets one by default; empty (INVITE=off) = anyone with the link
const MAX = Number(process.env.MAX_SESSIONS ?? 5);
const LANDING = process.env.LANDING_URL ?? 'https://tandemcode-app.vercel.app'; // where Leave demo sends the visitor
const IDLE_MIN = Number(process.env.IDLE_MIN ?? 20);
const BUDGET = Number(process.env.TOKEN_BUDGET ?? 0) || Infinity; // model tokens per sandbox (0 = no cap: GPU_MIN is the cap)
const GPU_MIN = Number(process.env.GPU_MIN ?? 60); // minutes on the GPU model per sandbox, from its first call
const DEMO_USD = Number(process.env.DEMO_USD ?? 5); // Claude spend allowed per sandbox
// Internet in the sandboxes, through the relay's proxy (public websites on 80/443 only). On by default with an invite code.
const INTERNET = process.env.INTERNET ? process.env.INTERNET === '1' : Boolean(INVITE);
const DISK_MB = Number(process.env.DISK_MB ?? 1024); // what a sandbox may write to disk (Docker Desktop can't cap it per container)
const IMAGE = 'agent-stage-sandbox', NET = 'agst-sandbox', RELAY = 'agst-relay', RELAY_PORT = 8099;
const SECRET = randomBytes(24).toString('hex');

type Session = { id: string; token: string; lastSeen: number; tokens: number; usd: number; gpuFrom?: number; ready: boolean; startedAt: number; diskMb?: number; who: { ip: string; country: string; agent: string } };
const sessions = new Map<string, Session>(); // cookie id → session
const byToken = new Map<string, Session>();

const docker = (args: string[]) => new Promise<string>((ok, fail) =>
  execFile('docker', args, { maxBuffer: 1 << 20 }, (err, out, errOut) => (err ? fail(new Error(String(errOut || err.message).trim())) : ok(out.trim()))));

// The model the sandboxes use: PUBLIC_MODEL_* if set, else whatever is active in agent-stage's settings here
// (e.g. the Brev GPU). If it isn't answering (GPU off), new sandboxes use Tandemcode's agent on Claude only.
type Model = { baseUrl: string; apiKey: string; model: string; name: string };
async function configured(): Promise<Model | null> {
  if (process.env.PUBLIC_MODEL === 'mock') return null;
  if (process.env.PUBLIC_MODEL_URL) return { baseUrl: process.env.PUBLIC_MODEL_URL, apiKey: process.env.PUBLIC_MODEL_KEY ?? '', model: process.env.PUBLIC_MODEL_NAME ?? '', name: process.env.PUBLIC_MODEL_NAME ?? 'Live model' };
  const s = JSON.parse(await readFile(join(DATA_DIR, 'settings.json'), 'utf8').catch(() => '{}'));
  const p = s.providers?.find((x: any) => x.id === s.activeProvider);
  return p?.kind === 'openai' && p.apiKey ? { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, name: p.model.split('/').pop() } : null;
}
// Claude for the demo: the key from agent-stage's settings here (or ANTHROPIC_API_KEY). It never enters a sandbox;
// each sandbox gets a token and its calls come back through here, where the real key is added. DEMO_CLAUDE=off disables it.
async function anthropicKey(): Promise<string> {
  if (process.env.DEMO_CLAUDE === 'off') return '';
  const s = JSON.parse(await readFile(join(DATA_DIR, 'settings.json'), 'utf8').catch(() => '{}'));
  return s.providers?.find((x: any) => (x.kind === 'anthropic' || x.kind === 'claude-code') && x.apiKey)?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
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
    '--add-host', 'host.docker.internal:host-gateway', '-e', `RELAY_SECRET=${SECRET}`, '-e', `MANAGER_URL=http://host.docker.internal:${PORT}`, '-e', `INTERNET=${INTERNET ? 1 : 0}`,
    '--memory', '256m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', IMAGE, 'src/public/relay.ts']);
  await docker(['network', 'connect', NET, RELAY]); // the relay alone sits on both networks
  for (const name of (await docker(['ps', '-aq', '--filter', 'name=^sess-'])).split('\n').filter(Boolean)) await docker(['rm', '-f', name]);
}

async function startSession(who: Session['who']): Promise<Session> {
  const m = (await modelUp()) ? await model() : null; // null → no GPU model: Claude only
  const claude = Boolean(await anthropicKey());
  const s: Session = { id: randomBytes(6).toString('hex'), token: randomBytes(24).toString('hex'), lastSeen: Date.now(), tokens: 0, usd: 0, ready: false, startedAt: Date.now(), who };
  await docker(['run', '-d', '--name', `sess-${s.id}`, '--network', NET,
    '--memory', '1536m', '--cpus', '1', '--pids-limit', '512', '--shm-size', '256m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:size=512m',
    ...(claude ? ['-e', 'DEMO_CLAUDE=1', '-e', `ANTHROPIC_API_KEY=${s.token}`, '-e', `ANTHROPIC_BASE_URL=http://${RELAY}:4000/anthropic`,
      '-e', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1', '-e', 'DISABLE_TELEMETRY=1', '-e', 'DISABLE_AUTOUPDATER=1', '-e', 'DISABLE_ERROR_REPORTING=1'] : []),
    ...(INTERNET ? ['-e', 'DEMO_INTERNET=1', ...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap((k) => ['-e', `${k}=http://${RELAY}:4002`]),
      ...['NO_PROXY', 'no_proxy'].flatMap((k) => ['-e', `${k}=${RELAY},localhost,127.0.0.1`]), '-e', 'NODE_USE_ENV_PROXY=1'] : []),
    '-e', `DEMO_USD=${DEMO_USD}`, '-e', `DEMO_GPU_MIN=${GPU_MIN}`, '-e', `DEMO_MAX=${MAX}`, '-e', `DEMO_IDLE_MIN=${IDLE_MIN}`,
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
  console.log(`- sandbox ${s.id} removed`);
  sessions.delete(s.id); byToken.delete(s.token);
  await docker(['rm', '-f', `sess-${s.id}`]).catch(() => {});
}

// ── model calls from the sandboxes (they arrive through the relay) ─────────
let lastTouch = 0;
async function modelCall(req: IncomingMessage, res: ServerResponse) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const s = byToken.get(token);
  if (!s) { res.writeHead(401); return res.end('unknown sandbox'); }
  if (s.tokens > BUDGET) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'This demo sandbox used its model budget. Thanks for trying it!' } })); }
  const m = await model();
  if (!m) { res.writeHead(503); return res.end('no model'); }
  s.gpuFrom ??= Date.now();
  if (Date.now() - s.gpuFrom > GPU_MIN * 60_000) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: `This demo sandbox used its ${GPU_MIN} minutes on the GPU. Thanks for trying it!` } })); }
  s.lastSeen = Date.now();
  // Visitors using the model count as GPU activity for agent-stage's auto-stop (at most once a minute).
  if (Date.now() - lastTouch > 60_000) { lastTouch = Date.now(); void fetch(`http://localhost:${process.env.APP_PORT ?? 3000}/api/gpu/touch`, { method: 'POST' }).catch(() => {}); }
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

// ── Claude calls from the sandboxes: Sonnet only, the real key added here, a dollar cap per sandbox ──────────
const SONNET = 'claude-sonnet-5-5';
const SONNET_PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }; // $ per million tokens, Oct 2026
async function anthropicCall(req: IncomingMessage, res: ServerResponse) {
  const token = String(req.headers['x-api-key'] ?? req.headers.authorization ?? '').replace(/^Bearer /, '');
  const s = byToken.get(token);
  if (!s) { res.writeHead(401); return res.end('unknown sandbox'); }
  const deny = (msg: string) => { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: msg } })); };
  if (s.usd >= DEMO_USD) return deny(`This demo sandbox used its $${DEMO_USD.toFixed(2)} of Claude. Thanks for trying it!`);
  const key = await anthropicKey();
  if (!key) { res.writeHead(503); return res.end('Claude is not available right now'); }
  s.lastSeen = Date.now();
  const body = await new Promise<Buffer>((ok) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  let payload: any;
  try { payload = body.length ? JSON.parse(body.toString()) : undefined; } catch { res.writeHead(400); return res.end('bad request'); }
  if (payload?.model) payload = { ...payload, model: SONNET }; // whatever the sandbox asks for, it gets Sonnet
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': key };
  for (const h of ['anthropic-version', 'anthropic-beta', 'accept']) if (req.headers[h]) headers[h] = String(req.headers[h]);
  const up = await fetch(`https://api.anthropic.com${(req.url ?? '').replace(/^\/anthropic/, '')}`, {
    method: req.method, headers, body: payload ? JSON.stringify(payload) : undefined,
  }).catch((e) => e as Error);
  if (up instanceof Error) { res.writeHead(502); return res.end(`Claude unreachable: ${up.message}`); }
  res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
  // Stream it through (Claude Code streams), and price the usage it reports.
  let seen = '';
  const max = (field: string) => Math.max(0, ...[...seen.matchAll(new RegExp(`"${field}":(\\d+)`, 'g'))].map((m) => Number(m[1])));
  if (up.body) for await (const chunk of up.body as any) { res.write(chunk); seen += Buffer.from(chunk).toString(); }
  res.end();
  const p = SONNET_PRICE;
  const usd = (max('input_tokens') * p.input + max('output_tokens') * p.output + max('cache_read_input_tokens') * p.cacheRead + max('cache_creation_input_tokens') * p.cacheWrite) / 1e6;
  s.usd += usd; s.tokens += max('input_tokens') + max('output_tokens') + max('cache_read_input_tokens') + max('cache_creation_input_tokens');
}

// ── the visitor's browser ───────────────────────────────────────────────────
const cookieOf = (req: IncomingMessage) => /(?:^|; )agst=([a-f0-9]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function proxy(req: IncomingMessage, res: ServerResponse, s: Session) {
  s.lastSeen = Date.now();
  const { cookie: _c, host: _h, ...headers } = req.headers;
  const out = request({ host: '127.0.0.1', port: RELAY_PORT, path: req.url, method: req.method,
    headers: { ...headers, 'x-agst-secret': SECRET, 'x-agst-target': `sess-${s.id}` } }, (up) => {
    // Live event streams: tell Cloudflare not to compress or hold them back, and push a first chunk through.
    if (String(up.headers['content-type']).startsWith('text/event-stream')) {
      res.writeHead(up.statusCode ?? 200, { ...up.headers, 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
      res.write(`: ${' '.repeat(2048)}\n\n`);
      up.on("data", (d) => { s.lastSeen = Date.now(); res.write(d); });
      up.on('end', () => res.end());
      return;
    }
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
    up.on('data', () => (s.lastSeen = Date.now())); // a live run counts as activity
  });
  out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(out);
  res.on('close', () => out.destroy());
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/v1/')) return await modelCall(req, res);
    if (req.url?.startsWith('/anthropic/v1/')) return await anthropicCall(req, res);
    // For the landing page on Vercel: is the demo up, and is the live model on?
    if (req.url === '/__status') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ up: true, model: (await modelUp().catch(() => false)) ? 'live' : 'scripted', claude: Boolean(await anthropicKey()), free: Math.max(0, MAX - sessions.size), invite: Boolean(INVITE), internet: INTERNET }));
    }
    if (req.url?.startsWith('/__admin')) return await admin(req, res);
    const s = sessions.get(cookieOf(req) ?? '');
    if (req.method === 'POST' && req.url === '/__start') {
      const body = await new Promise<string>((ok) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => ok(b)); });
      const code = new URLSearchParams(body).get('code') ?? '';
      if (INVITE && !same(code, INVITE)) return page(res, 'That code is not right.');
      if (s) { res.writeHead(303, { location: '/' }); return res.end(); }
      if (sessions.size >= MAX) return page(res, 'All demo sandboxes are busy right now. Try again in a few minutes.');
      const n = await startSession({ ip: String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? ''), country: String(req.headers['cf-ipcountry'] ?? ''), agent: String(req.headers['user-agent'] ?? '').slice(0, 160) });
      console.log(`+ sandbox ${n.id} for ${n.who.ip} ${n.who.country} (${sessions.size}/${MAX})`);
      res.writeHead(303, { location: '/', 'set-cookie': `agst=${n.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400` });
      return res.end();
    }
    // Leave demo: delete this visitor's sandbox, forget the cookie, back to the landing page.
    if (req.method === 'POST' && req.url === '/__leave') {
      if (s) { console.log(`- sandbox ${s.id} left by its visitor`); void stopSession(s); }
      res.writeHead(303, { location: LANDING, 'set-cookie': 'agst=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
      return res.end();
    }
    if (s) return proxy(req, res, s);
    if (req.url?.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"sandbox expired"}'); }
    return page(res);
  } catch (e: any) {
    console.error(e);
    if (!res.headersSent) page(res, `Something went wrong: ${e.message}`);
  }
});
// Docker is only touched once this copy owns the port: a second copy that fails to start must not
// wipe the running one's sandboxes.
server.on('error', (e: any) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is taken: the demo is probably already running.` : e.message); process.exit(1); });
server.listen(PORT, async () => {
  await setup().catch(async (e) => { console.error(e.message); await shutdown(1); });
  console.log(`demo manager on http://localhost:${PORT}  ·  max ${MAX} sandboxes  ·  ${INVITE ? 'invite code required' : 'no invite code'}`);
});

// ── admin: only from this computer (requests through the tunnel carry Cloudflare's headers) ──
const isLocal = (req: IncomingMessage) => !req.headers['cf-connecting-ip'] && !req.headers['cf-ray'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
async function admin(req: IncomingMessage, res: ServerResponse) {
  if (!isLocal(req)) { res.writeHead(404); return res.end(); }
  const url = new URL(req.url ?? '/', 'http://x');
  const s = sessions.get(url.searchParams.get('id') ?? '');
  if (url.pathname === '/__admin/stop' && s) { await stopSession(s); res.writeHead(303, { location: '/__admin' }); return res.end(); }
  // Look inside: this browser gets that sandbox's cookie (only works here on localhost, visitors' cookies are separate).
  if (url.pathname === '/__admin/open' && s) { res.writeHead(303, { location: '/', 'set-cookie': `agst=${s.id}; Path=/; HttpOnly; SameSite=Lax` }); return res.end(); }
  const rows = await Promise.all([...sessions.values()].map(async (x) => {
    const threads = await fetch(`http://127.0.0.1:${RELAY_PORT}/api/threads`, { headers: { 'x-agst-secret': SECRET, 'x-agst-target': `sess-${x.id}` }, signal: AbortSignal.timeout(3000) })
      .then((r) => r.json()).catch(() => []) as { title: string; running: boolean }[];
    const ago = (t: number) => `${Math.round((Date.now() - t) / 60_000)} min`;
    return `<tr><td class="mono">${x.id}</td><td>${esc(x.who.ip)} ${esc(x.who.country)}<div class="dim">${esc(x.who.agent.replace(/^Mozilla\/5.0 /, ''))}</div></td>
      <td>${ago(x.startedAt)}</td><td>${ago(x.lastSeen)} ago</td><td>${Math.round(x.tokens / 1000)}k${BUDGET < Infinity ? ` / ${Math.round(BUDGET / 1000)}k` : ''}<div class="dim">Claude $${x.usd.toFixed(2)} / $${DEMO_USD.toFixed(2)} · disk ${x.diskMb === undefined ? '…' : Math.round(x.diskMb)} / ${DISK_MB} MB</div></td>
      <td>${threads.map((t) => `${t.running ? '● ' : ''}${esc(t.title)}`).join('<br>') || '<span class="dim">no threads yet</span>'}</td>
      <td><a href="/__admin/open?id=${x.id}">Look inside</a> · <a href="/__admin/stop?id=${x.id}" onclick="return confirm('Delete this sandbox?')">Stop</a></td></tr>`;
  }));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Demo sandboxes</title>
<style>:root{color-scheme:dark}body{margin:32px;background:#0b0c0e;color:#e7e9ee;font:14px/1.5 system-ui}table{border-collapse:collapse;width:100%}
td,th{padding:10px 12px;border-bottom:1px solid #22252b;text-align:left;vertical-align:top}th{color:#9aa1ad;font-weight:500}.dim{color:#6b7280;font-size:12px}
.mono{font-family:ui-monospace,monospace}a{color:#9bb4ff}</style>
<h1 style="font-size:20px">Demo sandboxes: ${sessions.size} / ${MAX}</h1>
<p class="dim">Live model: ${(await modelUp().catch(() => false)) ? 'on' : 'off (scripted)'} · idle sandboxes are deleted after ${IDLE_MIN} min · ${INVITE ? 'invite code on' : 'no invite code'} · refreshes every 5 s.
"Look inside" opens that visitor's sandbox in this browser; come back to <b>localhost:${PORT}/__admin</b> afterwards.</p>
<table><tr><th>Sandbox</th><th>Visitor</th><th>Started</th><th>Last active</th><th>Model tokens</th><th>Threads</th><th></th></tr>${rows.join('') || '<tr><td colspan=7 class="dim">Nobody yet.</td></tr>'}</table>`);
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function page(res: ServerResponse, message = '') {
  const up = await modelUp().catch(() => false);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tandemcode · live demo</title>
<style>
  :root { color-scheme: dark; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0c0e; color: #e7e9ee; font: 15px/1.55 system-ui, sans-serif; }
  main { width: min(440px, calc(100% - 32px)); } h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 8px; } p { color: #9aa1ad; }
  form { display: flex; gap: 8px; margin-top: 22px; } input { flex: 1; padding: 10px 12px; border-radius: 9px; border: 1px solid #2a2e36; background: #14161a; color: inherit; font: inherit; }
  button { padding: 10px 16px; border-radius: 9px; border: 0; background: #e7e9ee; color: #0b0c0e; font: inherit; font-weight: 600; cursor: pointer; }
  .msg { color: #f5b84a; } .busy button { opacity: .6; pointer-events: none; }
</style>
<main><h1>Tandemcode, live</h1>
<p>Watch an AI coding agent work on a real project, on a map. You get your own private sandbox with sample projects: the agent really edits files, runs tests and uses a browser inside it. It's deleted ${IDLE_MIN} minutes after you leave.</p>
<p>Limits, so everyone gets a turn: ${MAX} sandboxes at a time, $${DEMO_USD} of Claude and ${GPU_MIN} minutes on the GPU per sandbox.</p>
<p>${up ? '● The live model is <b style="color:#3ecf8e">online</b>: an open model on our GPU does the work.' : '● Tandemcode’s agent runs on <b style="color:#3ecf8e">Claude Sonnet 5.5</b>.'}</p>
${message ? `<p class="msg">${message.replace(/</g, '&lt;')}</p>` : ''}
<form method="post" action="/__start" onsubmit="this.classList.add('busy');this.querySelector('button').textContent='Starting your sandbox…'">
  ${INVITE ? '<input name="code" placeholder="Invite code" autocomplete="off" required>' : ''}<button>Start my sandbox</button>
</form></main>`);
}

// Idle sandboxes go away; everything goes away when the manager stops.
setInterval(() => { for (const s of sessions.values()) if (Date.now() - s.lastSeen > IDLE_MIN * 60_000) void stopSession(s); }, 60_000);

// Disk watchdog: a sandbox that writes more than DISK_MB (its container layer; /tmp is already a capped tmpfs) is deleted.
const toMb = (size: string) => { const m = size.match(/^([\d.]+)\s*([kMGT]?B)/); return m ? Number(m[1]) * ({ B: 1e-6, kB: 1e-3, MB: 1, GB: 1e3, TB: 1e6 } as any)[m[2]] : 0; };
setInterval(async () => {
  if (!sessions.size) return;
  const out = await docker(['ps', '-s', '--filter', 'name=^sess-', '--format', '{{.Names}}\t{{.Size}}']).catch(() => '');
  for (const line of out.split('\n').filter(Boolean)) {
    const [name, size = ''] = line.split('\t');
    const s = sessions.get(name.replace(/^sess-/, ''));
    if (!s) continue;
    s.diskMb = toMb(size);
    if (s.diskMb > DISK_MB) { console.log(`- sandbox ${s.id} wrote ${Math.round(s.diskMb)} MB (limit ${DISK_MB}): deleted`); void stopSession(s); }
  }
}, 30_000);
// Leave nothing behind: on Ctrl-C, on kill, and on a crash.
let quitting = false;
async function shutdown(code = 0) {
  if (quitting) return; quitting = true;
  console.log('\nremoving sandboxes…');
  await Promise.all([...sessions.values()].map(stopSession));
  for (const name of (await docker(['ps', '-aq', '--filter', 'name=^sess-']).catch(() => '')).split('\n').filter(Boolean)) await docker(['rm', '-f', name]).catch(() => {});
  await docker(['rm', '-f', RELAY]).catch(() => {});
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => void shutdown(0));
process.on('uncaughtException', (e) => { console.error(e); void shutdown(1); });
