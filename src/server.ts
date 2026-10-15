// Local doorway between the browser UI and the agents. Runs on the user's machine.
// Usage: npm start → http://localhost:3000. Threads and settings live in ~/.agent-stage.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Agent, type AgentEvent } from './agent.ts';
import { configFromEnv } from './model.ts';
import { startTunnel } from './tunnel.ts';
import { checkGpu, checkModel, type Health } from './health.ts';
import { buildMap } from './mapdata.ts';
import { enqueue, insightsOn, labelStep, summarizeFile, explainChange } from './insight.ts';
import { loadSettings, saveSettings, toConfig, listThreads, loadThread, saveThread, deleteThread,
  PRESETS, type Provider, type Settings, type Thread } from './store.ts';

const sandbox = resolve(process.env.WORKSPACE ?? 'workspace');
await mkdir(sandbox, { recursive: true });
const env = configFromEnv();
let settings: Settings = await loadSettings({
  ...env, gpuHourly: Number(process.env.GPU_HOURLY_USD ?? 0), tunnelHost: process.env.TUNNEL_HOST, brevInstance: process.env.BREV_INSTANCE,
}, sandbox);
// `npm run mock` forces the scripted model regardless of saved settings.
if (process.env.MODEL_API_KEY === 'mock') settings.activeProvider = 'mock';
const provider = (id = settings.activeProvider): Provider => settings.providers.find((p) => p.id === id) ?? settings.providers[0];

// ── health, tunnel and GPU time (for the active provider) ──────────────────
let tunnel = startTunnel(undefined, 0);
function retunnel() {
  tunnel.stop();
  const p = provider();
  tunnel = startTunnel(p.tunnelHost, p.baseUrl ? Number(new URL(p.baseUrl).port || 80) : 0);
}
retunnel();

const gpuMs: Record<string, number> = {}; // provider id → ms seen running
let health: Health = { model: { state: 'unreachable' }, checkedAt: 0 };
let lastHealthAt = Date.now();
async function refreshHealth() {
  const p = provider();
  const [model, gpu] = await Promise.all([checkModel(toConfig(p)), checkGpu(p.brevInstance)]);
  const now = Date.now();
  if (p.gpuHourly && (gpu?.state === 'running' || (!gpu && model.state === 'ok'))) gpuMs[p.id] = (gpuMs[p.id] ?? 0) + now - lastHealthAt;
  lastHealthAt = now;
  const t = tunnel.state();
  // Someone else (a manual ssh -L) may already own the port: if the model answers, the path works.
  const tunnelView = t.enabled ? { ...t, up: t.up || model.state === 'ok', external: !t.up && model.state === 'ok' } : undefined;
  health = { model, gpu, tunnel: tunnelView, checkedAt: now };
}
void refreshHealth();
setInterval(refreshHealth, 8000);

// ── threads: each has its own agent, folder, event history and usage ───────
type Stamped = AgentEvent & { at: number };
type Live = { thread: Thread; agent: Agent; listeners: Set<(e: Stamped) => void>; approvals: Map<string, (ok: boolean) => void>;
  checkpoints: Map<string, (a: { choice: 'confirm' | 'discuss'; text?: string }) => void> };
const live = new Map<string, Live>();
const saveSoon = new Map<string, NodeJS.Timeout>();

const SAFE = /^(ls|cat|pwd|echo|head|tail|wc|grep|rg|find|tree|which|node -v|node --version|npm -v|git (status|diff|log|show|branch))\b/;
const isSafe = (cmd: string) => SAFE.test(cmd.trim()) && !/[;&|><`$]/.test(cmd);

function persist(l: Live) {
  l.thread.messages = l.agent.messages;
  l.thread.updatedAt = Date.now();
  clearTimeout(saveSoon.get(l.thread.id));
  saveSoon.set(l.thread.id, setTimeout(() => void saveThread(l.thread), 300));
}

async function open(id: string): Promise<Live | null> {
  const existing = live.get(id);
  if (existing) return existing;
  const thread = await loadThread(id);
  if (!thread) return null;
  const l: Live = { thread, agent: null!, listeners: new Set(), approvals: new Map(), checkpoints: new Map() };
  const emit = (event: AgentEvent) => {
    if (event.type === 'usage') {
      const u = thread.usage;
      u.promptTokens += event.promptTokens; u.completionTokens += event.completionTokens; u.modelMs += event.ms; u.calls++;
    }
    if (event.type === 'user' && thread.title === 'New thread') thread.title = event.text.slice(0, 60);
    const e = { ...event, at: Date.now() };
    thread.events.push(e);
    // Teaching labels: ask the same model to describe each finished step (queued, never blocks the agent).
    if (event.type === 'tool_end' && insightsOn(settings, provider(thread.providerId))) {
      const start = [...thread.events].reverse().find((x: any) => x.type === 'tool_start' && x.id === event.id);
      const task = [...thread.events].reverse().find((x: any) => x.type === 'user')?.text ?? '';
      const cfg = toConfig(provider(thread.providerId));
      enqueue(async () => {
        const { label, why } = await labelStep(cfg, settings, { name: event.name, args: start?.args ?? {}, output: event.output, ok: event.ok, task });
        if (label) emit({ type: 'label', stepId: event.id, label, why });
      });
    }
    for (const fn of l.listeners) fn(e);
    persist(l);
  };
  l.agent = new Agent(toConfig(provider(thread.providerId)), {
    root: thread.folder,
    approve: (command) => {
      if (settings.approval === 'safe' && isSafe(command)) return Promise.resolve(true);
      return new Promise((ok) => {
        const aid = crypto.randomUUID();
        l.approvals.set(aid, ok);
        emit({ type: 'approval', id: aid, command });
      });
    },
  }, emit, {
    mode: thread.mode ?? 'build', learn: settings.learn,
    checkpoint: (cp) => new Promise((ok) => l.checkpoints.set(cp.id, ok)),
  });
  if (thread.messages.length) l.agent.messages = thread.messages;
  l.agent.setOptions({}); // refresh the system prompt for the current mode/prefs
  live.set(id, l);
  return l;
}

async function newThread(folder: string, mode: 'build' | 'learn' | 'ask' = 'build', parent?: string, temp = false): Promise<Thread> {
  const t: Thread = {
    id: crypto.randomUUID().slice(0, 8), title: 'New thread', folder, providerId: settings.activeProvider, mode, parent, temp,
    createdAt: Date.now(), updatedAt: Date.now(), messages: [], events: [], usage: { promptTokens: 0, completionTokens: 0, modelMs: 0, calls: 0 },
  };
  await saveThread(t);
  if (temp) return t;
  settings.recentFolders = [folder, ...settings.recentFolders.filter((f) => f !== folder)].slice(0, 8);
  await saveSettings(settings);
  return t;
}

async function listFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (out.length > 2000) break;
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await listFiles(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

const mask = (k: string) => (!k ? '' : k.length <= 8 ? '••••' : `••••${k.slice(-4)}`);
const publicSettings = () => ({ ...settings, providers: settings.providers.map((p) => ({ ...p, apiKey: mask(p.apiKey) })) });

const app = new Hono();
const T = '/api/threads/:id';

// threads
app.get('/api/threads', async (c) => c.json((await listThreads()).filter((t) => !t.temp).map((t) => ({
  id: t.id, title: t.title, folder: t.folder, updatedAt: t.updatedAt, running: live.get(t.id)?.agent.running ?? false,
  tokens: t.usage.promptTokens + t.usage.completionTokens,
}))));
app.post('/api/threads', async (c) => {
  const { folder, mode } = await c.req.json().catch(() => ({}));
  const dir = resolve(folder || sandbox);
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) return c.json({ error: 'not a folder' }, 400);
  return c.json(await newThread(dir, mode === 'learn' ? 'learn' : 'build'));
});
app.delete(T, async (c) => {
  const id = c.req.param('id'), l = live.get(id);
  l?.agent.stop(); live.delete(id);
  await deleteThread(id);
  return c.json({ ok: true });
});
app.get(`${T}/state`, async (c) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'no such thread' }, 404);
  return c.json({ workspace: l.thread.folder, title: l.thread.title, mode: l.thread.mode ?? 'build', parent: l.thread.parent,
    running: l.agent.running, files: await listFiles(l.thread.folder) });
});
app.get(`${T}/map`, async (c) => {
  const l = await open(c.req.param('id'));
  return l ? c.json(await buildMap(l.thread.folder)) : c.json({ files: [], edges: [] });
});
app.get(`${T}/events`, async (c) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'no such thread' }, 404);
  return streamSSE(c, async (stream) => {
    for (const e of l.thread.events) await stream.writeSSE({ data: JSON.stringify(e) });
    const send = (e: Stamped) => void stream.writeSSE({ data: JSON.stringify(e) });
    l.listeners.add(send);
    stream.onAbort(() => l.listeners.delete(send));
    while (!stream.aborted) await stream.sleep(15_000).then(() => stream.writeSSE({ event: 'ping', data: '' }));
  });
});
const withThread = (fn: (l: Live, body: any) => any) => async (c: any) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'no such thread' }, 404);
  const body = await c.req.json().catch(() => ({}));
  // A thread always runs on the currently selected model.
  if (!l.agent.running) {
    l.thread.providerId = settings.activeProvider; l.agent.setConfig(toConfig(provider()));
    l.agent.setOptions({ mode: l.thread.mode ?? 'build', learn: settings.learn });
  }
  const out = await fn(l, body);
  return c.json(out ?? { ok: true });
};
app.post(`${T}/task`, withThread((l, { task }) => {
  if (l.agent.running) return { error: 'agent is busy' };
  void l.agent.run(task, settings.maxSteps);
}));
app.post(`${T}/stop`, withThread((l) => {
  l.agent.stop();
  for (const [, ok] of l.approvals) ok(false);
  l.approvals.clear();
  for (const [, ok] of l.checkpoints) ok({ choice: 'discuss', text: '(stopped by the learner)' });
  l.checkpoints.clear();
}));
app.post(`${T}/ask`, withThread((l, { text }) => { void l.agent.ask(text); }));
app.post(`${T}/steer`, withThread((l, { text }) => {
  if (l.agent.running) l.agent.interject(text);
  else void l.agent.run(text, settings.maxSteps); // idle: steering is just the next task, with full context
}));
app.get(`${T}/summary`, async (c) => {
  const l = await open(c.req.param('id'));
  const path = c.req.query('path') ?? '';
  if (!l || !path || path.includes('..')) return c.json({ error: 'bad request' }, 400);
  const p = provider(l.thread.providerId);
  if (!insightsOn(settings, p) && !c.req.query('force')) return c.json({ off: true });
  try { return c.json({ summary: await summarizeFile(toConfig(p), settings, l.thread.folder, path) }); }
  catch (e: any) { return c.json({ error: e.message }); }
});
app.post(`${T}/explain`, withThread(async (l, { path, before, after }) => {
  try { return { text: await explainChange(toConfig(provider(l.thread.providerId)), settings, path, before ?? '', after ?? '') }; }
  catch (e: any) { return { error: e.message }; }
}));
// Ask opens a temporary, read-only side thread that starts from the work thread's context.
app.post(`${T}/ask-thread`, withThread(async (l, { question }) => {
  const t = await newThread(l.thread.folder, 'ask', l.thread.id, true);
  t.title = String(question).slice(0, 60);
  const side = await open(t.id);
  if (!side) return { error: 'could not open side thread' };
  side.agent.messages = [side.agent.messages[0], ...l.agent.snapshot()];
  void side.agent.run(String(question), 12);
  return { id: t.id };
}));
app.post(`${T}/keep`, withThread((l) => { l.thread.temp = false; persist(l); }));
app.post(`${T}/checkpoint`, withThread((l, { id, choice, text }) => {
  l.checkpoints.get(id)?.({ choice: choice === 'confirm' ? 'confirm' : 'discuss', text });
  l.checkpoints.delete(id);
}));
app.post(`${T}/mode`, withThread((l, { mode }) => {
  if (l.agent.running) return { error: 'agent is busy' };
  l.thread.mode = mode === 'learn' ? 'learn' : 'build';
  l.agent.setOptions({ mode: l.thread.mode });
  persist(l);
  return { mode: l.thread.mode };
}));
app.post(`${T}/approve`, withThread((l, { id, ok }) => {
  l.approvals.get(id)?.(Boolean(ok));
  l.approvals.delete(id);
}));

// settings + providers
app.get('/api/settings', (c) => c.json(publicSettings()));
app.get('/api/presets', (c) => c.json(PRESETS));
app.put('/api/settings', async (c) => {
  const next = await c.req.json();
  const prevActive = settings.activeProvider;
  const providers: Provider[] = (next.providers ?? settings.providers).map((p: Provider) => {
    const old = settings.providers.find((o) => o.id === p.id);
    // Masked keys come back unchanged: keep the stored secret.
    return { ...p, apiKey: p.apiKey?.startsWith('••••') ? old?.apiKey ?? '' : p.apiKey ?? '' };
  });
  settings = { ...settings, ...next, providers };
  if (!settings.providers.some((p) => p.id === settings.activeProvider)) settings.activeProvider = settings.providers[0].id;
  await saveSettings(settings);
  for (const l of live.values()) if (!l.agent.running) l.agent.setConfig(toConfig(provider()));
  const p = provider();
  if (prevActive !== settings.activeProvider || tunnel.state().host !== p.tunnelHost) retunnel();
  void refreshHealth();
  return c.json(publicSettings());
});
app.post('/api/providers/test', async (c) => {
  const p: Provider = await c.req.json();
  const stored = settings.providers.find((o) => o.id === p.id);
  const key = p.apiKey?.startsWith('••••') ? stored?.apiKey ?? '' : p.apiKey;
  return c.json(await checkModel(toConfig({ ...p, apiKey: key })));
});

// usage across all threads, per provider
app.get('/api/stats', async (c) => {
  const threads = await listThreads();
  const byProvider: Record<string, { tokens: number; calls: number; threads: number; gpuHours: number; gpuCost: number }> = {};
  for (const t of threads) {
    const b = (byProvider[t.providerId] ??= { tokens: 0, calls: 0, threads: 0, gpuHours: 0, gpuCost: 0 });
    b.tokens += t.usage.promptTokens + t.usage.completionTokens; b.calls += t.usage.calls; b.threads++;
  }
  for (const [id, ms] of Object.entries(gpuMs)) {
    const b = (byProvider[id] ??= { tokens: 0, calls: 0, threads: 0, gpuHours: 0, gpuCost: 0 });
    b.gpuHours = ms / 3_600_000; b.gpuCost = b.gpuHours * (provider(id).gpuHourly ?? 0);
  }
  return c.json({
    byProvider,
    threads: threads.map((t) => ({ id: t.id, title: t.title, providerId: t.providerId, tokens: t.usage.promptTokens + t.usage.completionTokens, calls: t.usage.calls, updatedAt: t.updatedAt })),
  });
});

// health of the active provider + this session's usage
app.get('/api/health', async (c) => {
  if (c.req.query('now')) await refreshHealth();
  const p = provider();
  const threads = [...live.values()].map((l) => l.thread.usage);
  const u = threads.reduce((a, b) => ({ promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, modelMs: a.modelMs + b.modelMs, calls: a.calls + b.calls }),
    { promptTokens: 0, completionTokens: 0, modelMs: 0, calls: 0 });
  const tokens = u.promptTokens + u.completionTokens;
  const gpuCost = ((gpuMs[p.id] ?? 0) / 3_600_000) * (p.gpuHourly ?? 0);
  return c.json({
    ...health,
    model: { ...health.model, name: p.kind === 'mock' ? 'Demo (scripted)' : p.model, provider: p.name, kind: p.kind, mock: p.kind === 'mock' },
    usage: {
      ...u, tokens,
      tokensPerSec: u.modelMs ? Math.round((u.completionTokens / u.modelMs) * 1000) : 0,
      gpuHourly: p.gpuHourly ?? 0, gpuCost, perMillion: tokens && p.gpuHourly ? (gpuCost / tokens) * 1e6 : null,
    },
  });
});

// folder picker: list sub-folders of a directory on this machine
app.get('/api/fs', async (c) => {
  const dir = resolve(c.req.query('path') || homedir());
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return c.json({ error: 'cannot read folder' }, 400);
  return c.json({
    path: dir, parent: dirname(dir) !== dir ? dirname(dir) : null, name: basename(dir) || dir,
    folders: entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name).sort((a, b) => a.localeCompare(b)),
  });
});

app.get('/api/me', (c) => c.json({ name: userInfo().username, home: homedir(), sandbox }));

app.use('/*', serveStatic({ root: './web/dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`agent-stage → http://localhost:${port}  ·  model ${provider().name}  ·  data ~/.agent-stage`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { tunnel.stop(); process.exit(0); });
