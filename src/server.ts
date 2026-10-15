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

const root = resolve(process.env.WORKSPACE ?? 'workspace');
await mkdir(root, { recursive: true });
const cfg = configFromEnv();

type Stamped = AgentEvent & { at: number };
const history: Stamped[] = [];
const listeners = new Set<(e: Stamped) => void>();
const approvals = new Map<string, (ok: boolean) => void>();

function emit(event: AgentEvent) {
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
