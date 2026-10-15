// Local doorway between the browser UI and the agent. Runs on the user's machine.
// Usage: npm start  →  http://localhost:3000   (WORKSPACE=path to point the agent at a folder)
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { mkdir, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Agent, type AgentEvent } from './agent.ts';
import { configFromEnv } from './model.ts';
import { startTunnel } from './tunnel.ts';
import { checkGpu, checkModel, type Health } from './health.ts';
import { buildMap } from './mapdata.ts';

const root = resolve(process.env.WORKSPACE ?? 'workspace');
await mkdir(root, { recursive: true });
const cfg = configFromEnv();
const tunnel = startTunnel(process.env.TUNNEL_HOST, Number(new URL(cfg.baseUrl).port || 8000));
const GPU_HOURLY = Number(process.env.GPU_HOURLY_USD ?? 0);

// Usage + cost. Self-hosted models bill by GPU time, not tokens: we count GPU-running time while
// this server is up, and divide by tokens to show what a million tokens "cost".
const usage = { promptTokens: 0, completionTokens: 0, modelMs: 0, calls: 0, gpuMs: 0 };
let health: Health = { model: { state: 'unreachable' }, checkedAt: 0 };
let lastHealthAt = Date.now();
async function refreshHealth() {
  const [model, gpu] = await Promise.all([checkModel(cfg), checkGpu(process.env.BREV_INSTANCE)]);
  const now = Date.now();
  if (gpu?.state === 'running' || (!gpu && model.state === 'ok')) usage.gpuMs += now - lastHealthAt;
  lastHealthAt = now;
  const t = tunnel();
  // Someone else (a manual ssh -L) may already own the port: if the model answers, the path works.
  const tunnelView = t.enabled ? { ...t, up: t.up || model.state === 'ok', external: !t.up && model.state === 'ok' } : undefined;
  health = { model, gpu, tunnel: tunnelView, checkedAt: now };
}
void refreshHealth();
setInterval(refreshHealth, 8000);

type Stamped = AgentEvent & { at: number };
const history: Stamped[] = [];
const listeners = new Set<(e: Stamped) => void>();
const approvals = new Map<string, (ok: boolean) => void>();

function emit(event: AgentEvent) {
  if (event.type === 'usage') {
    usage.promptTokens += event.promptTokens;
    usage.completionTokens += event.completionTokens;
    usage.modelMs += event.ms;
    usage.calls++;
  }
  const e = { ...event, at: Date.now() };
  history.push(e);
  for (const l of listeners) l(e);
}

let agent = newAgent();
function newAgent() {
  return new Agent(cfg, {
    root,
    approve: (command) => new Promise((ok) => {
      const id = crypto.randomUUID();
      approvals.set(id, ok);
      emit({ type: 'approval', id, command });
    }),
  }, emit);
}

async function listFiles(dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await listFiles(full, out);
    else out.push(relative(root, full));
  }
  return out;
}

const app = new Hono();

app.get('/api/state', async (c) => c.json({
  workspace: root,
  model: cfg.apiKey && cfg.apiKey !== 'mock' ? cfg.model : 'mock (no key)',
  running: agent.running,
  files: await listFiles(),
}));

app.get('/api/map', async (c) => c.json(await buildMap(root)));

app.get('/api/health', async (c) => {
  if (c.req.query('now')) await refreshHealth();
  const tokens = usage.promptTokens + usage.completionTokens;
  const gpuCost = (usage.gpuMs / 3_600_000) * GPU_HOURLY;
  return c.json({
    ...health,
    model: { ...health.model, name: cfg.model, mock: !cfg.apiKey || cfg.apiKey === 'mock' },
    usage: {
      ...usage, tokens,
      tokensPerSec: usage.modelMs ? Math.round((usage.completionTokens / usage.modelMs) * 1000) : 0,
      gpuHourly: GPU_HOURLY, gpuCost, perMillion: tokens && GPU_HOURLY ? (gpuCost / tokens) * 1e6 : null,
    },
  });
});

app.get('/api/events', (c) => streamSSE(c, async (stream) => {
  for (const e of history) await stream.writeSSE({ data: JSON.stringify(e) });
  const send = (e: Stamped) => void stream.writeSSE({ data: JSON.stringify(e) });
  listeners.add(send);
  stream.onAbort(() => listeners.delete(send));
  while (!stream.aborted) await stream.sleep(15_000).then(() => stream.writeSSE({ event: 'ping', data: '' }));
}));

app.post('/api/task', async (c) => {
  const { task } = await c.req.json();
  if (agent.running) return c.json({ error: 'agent is busy' }, 409);
  void agent.run(task);
  return c.json({ ok: true });
});

app.post('/api/stop', (c) => {
  agent.stop();
  for (const [, ok] of approvals) ok(false);
  approvals.clear();
  return c.json({ ok: true });
});

app.post('/api/ask', async (c) => {
  const { text } = await c.req.json();
  void agent.ask(text);
  return c.json({ ok: true });
});

app.post('/api/steer', async (c) => {
  const { text } = await c.req.json();
  if (agent.running) agent.interject(text);
  else void agent.run(text); // idle: steering is just the next task, with full context
  return c.json({ ok: true });
});

app.post('/api/approve', async (c) => {
  const { id, ok } = await c.req.json();
  approvals.get(id)?.(Boolean(ok));
  approvals.delete(id);
  return c.json({ ok: true });
});

app.post('/api/reset', (c) => {
  agent.stop();
  agent = newAgent();
  history.length = 0;
  emit({ type: 'user', text: '— new session —' });
  history.length = 0;
  return c.json({ ok: true });
});

app.use('/*', serveStatic({ root: './web/dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`agent-stage → http://localhost:${port}  ·  workspace ${root}  ·  model ${cfg.apiKey && cfg.apiKey !== 'mock' ? cfg.model : 'mock'}`);
