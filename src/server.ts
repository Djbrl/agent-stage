// Local doorway between the browser UI and the agents. Runs on the user's machine.
// Usage: npm start → http://localhost:3000. Threads and settings live in ~/.agent-stage.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Agent, type AgentEvent } from './agent.ts';
import { configFromEnv } from './model.ts';
import { startTunnel } from './tunnel.ts';
import { checkpoint, restore, isRepo, initRepo, changedBetween, diffSince, commitFiles } from './git.ts';
import { closeBrowser, SHOTS } from './browser.ts';
import { stopBackground, within, relPath } from './tools.ts';
import { checkGpu, checkModel, type Health } from './health.ts';
import { buildMap, isGenerated } from './mapdata.ts';
import { enqueue, insightsOn, labelStep, summarizeFile, explainChange, commitMessage, summarizeThread } from './insight.ts';
import { GpuManager } from './gpu.ts';
import { ClaudeCodeAgent } from './claudecode.ts';
import { loadSettings, saveSettings, toConfig, listThreads, loadThread, saveThread, deleteThread,
  PRESETS, engineOf, keyOf, apiCost, type Provider, type Settings, type Thread } from './store.ts';

const sandbox = resolve(process.env.WORKSPACE ?? 'workspace');
// Public mode: this server runs inside a disposable container for one visitor (see src/public/). The visitor
// can use the agent on the projects in the container, but can't change models, keys, the GPU or see other folders.
const PUBLIC = process.env.PUBLIC === '1';
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

// One-click GPU for the active provider (when it names a Brev instance).
const gpu = new GpuManager({
  provider: () => provider(),
  saveKey: async (key) => {
    const p = provider();
    settings.providers = settings.providers.map((x) => (x.id === p.id ? { ...x, apiKey: key } : x));
    await saveSettings(settings);
  },
  onReady: () => retunnel(),
  anyRunning: () => [...live.values()].some((l) => l.agent.running),
});
let health: Health = { model: { state: 'checking' }, checkedAt: 0 }; // until the first check answers (a few seconds after start)
let lastHealthAt = Date.now();
async function refreshHealth() {
  const p = provider();
  const [model, brev] = await Promise.all([checkModel(toConfig(p)), checkGpu(p.brevInstance)]);
  const now = Date.now();
  if (p.gpuHourly && (brev?.state === 'running' || (!brev && model.state === 'ok'))) gpuMs[p.id] = (gpuMs[p.id] ?? 0) + now - lastHealthAt;
  lastHealthAt = now;
  // The tunnel follows the GPU: no ssh retries against a machine that doesn't exist.
  const wantTunnel = Boolean(p.tunnelHost) && !(p.brevInstance && ['off', 'creating', 'stopping'].includes(gpu.state.phase) && model.state !== 'ok');
  if (wantTunnel !== tunnel.state().enabled) wantTunnel ? retunnel() : (tunnel.stop(), tunnel = startTunnel(undefined, 0));
  const t = tunnel.state();
  // Someone else (a manual ssh -L) may already own the port: if the model answers, the path works.
  const tunnelView = t.enabled ? { ...t, up: t.up || model.state === 'ok', external: !t.up && model.state === 'ok' } : undefined;
  health = { model, gpu: brev, tunnel: tunnelView, checkedAt: now };
}
void refreshHealth();
setInterval(refreshHealth, 8000);
setTimeout(() => void gpu.adopt(), 1500);

// ── threads: each has its own agent, folder, event history and usage ───────
type Stamped = AgentEvent & { at: number };
type Live = { thread: Thread; agent: Agent | ClaudeCodeAgent; emit: (e: AgentEvent) => void; listeners: Set<(e: Stamped) => void>; approvals: Map<string, (ok: boolean) => void>;
  checkpoints: Map<string, (a: { choice: 'confirm' | 'discuss' | 'skip'; text?: string }) => void> };
const live = new Map<string, Live>();
const saveSoon = new Map<string, NodeJS.Timeout>();

const SAFE = /^(ls|cat|pwd|echo|head|tail|wc|grep|rg|find|tree|which|node -v|node --version|npm -v|git (status|diff|log|show|branch))\b/;
const isSafe = (cmd: string) => SAFE.test(cmd.trim()) && !/[;&|><`$]/.test(cmd);

function persist(l: Live) {
  if (l.agent instanceof ClaudeCodeAgent) { l.thread.sessionId = l.agent.sessionId; l.thread.fork = l.agent.fork; }
  else l.thread.messages = l.agent.messages;
  l.thread.updatedAt = Date.now();
  clearTimeout(saveSoon.get(l.thread.id));
  saveSoon.set(l.thread.id, setTimeout(() => void saveThread(l.thread), 300));
}

// Several requests open a fresh thread at once (events, map, git, task): they must all get the same Live, or the
// agent ends up talking to listeners nobody is attached to. So the loading itself is shared.
const opening = new Map<string, Promise<Live | null>>();
function open(id: string): Promise<Live | null> {
  const existing = live.get(id);
  if (existing) return Promise.resolve(existing);
  if (!opening.has(id)) opening.set(id, load(id).finally(() => opening.delete(id)));
  return opening.get(id)!;
}

async function load(id: string): Promise<Live | null> {
  const thread = await loadThread(id);
  if (!thread) return null;
  const l: Live = { thread, agent: null!, emit: null!, listeners: new Set(), approvals: new Map(), checkpoints: new Map() };
  const emit = (event: AgentEvent) => {
    if (event.type === 'usage') {
      const u = thread.usage;
      u.promptTokens += event.promptTokens; u.completionTokens += event.completionTokens; u.modelMs += event.ms; u.calls++;
      if (event.costUsd) u.costUsd = (u.costUsd ?? 0) + event.costUsd;
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
  l.emit = emit;
  const Engine = thread.engine === 'claude-code' ? ClaudeCodeAgent : Agent;
  l.agent = new Engine(toConfig(provider(thread.providerId)), {
    root: thread.folder,
    approve: (command, kind) => {
      if (settings.approval === 'safe' && isSafe(command)) return Promise.resolve(true);
      return new Promise((ok) => {
        const aid = crypto.randomUUID();
        l.approvals.set(aid, ok);
        emit({ type: 'approval', id: aid, command, ...(kind === 'check' ? { check: true } : {}) });
      });
    },
  }, emit, {
    mode: thread.mode ?? 'build', learn: settings.learn,
    checkpoint: (cp) => new Promise((ok) => l.checkpoints.set(cp.id, ok)),
  });
  if (l.agent instanceof ClaudeCodeAgent) { l.agent.sessionId = thread.sessionId; l.agent.fork = Boolean(thread.fork); }
  else if (thread.messages.length) l.agent.messages = thread.messages;
  l.agent.setOptions({}); // refresh the system prompt for the current mode/prefs
  live.set(id, l);
  return l;
}

async function newThread(folder: string, mode: 'build' | 'learn' | 'ask' = 'build', parent?: string, temp = false): Promise<Thread> {
  const t: Thread = {
    id: crypto.randomUUID().slice(0, 8), title: 'New thread', folder, providerId: settings.activeProvider, engine: engineOf(provider()), mode, parent, temp,
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
    if (isGenerated(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await listFiles(root, full, out);
    else out.push(relPath(root, full));
  }
  return out;
}

// What a demo visitor may pick: the live GPU (or the scripted model) and, when the manager offers it, Claude Sonnet.
const demoModels = () => settings.providers.filter((p) => p.id === 'env' || p.id === 'mock' || p.id === 'claude' || p.id === 'cc-demo').map((p) => p.id);
const mask = (k: string) => (!k ? '' : k.length <= 8 ? '••••' : `••••${k.slice(-4)}`);
const publicSettings = () => ({ ...settings, recentFolders: PUBLIC ? [] : settings.recentFolders,
  providers: settings.providers.filter((p) => !PUBLIC || demoModels().includes(p.id)).map((p) => ({ ...p, apiKey: mask(keyOf(p)), ...(PUBLIC ? { baseUrl: '' } : {}) })) });

const app = new Hono();
if (PUBLIC) {
  settings.insights = 'on';
  for (const p of settings.providers) if (p.id === 'env') p.name = process.env.MODEL_LABEL ?? p.model.split('/').pop()!;
  // Claude in the demo: Sonnet only, in our loop and through the Claude Code engine, via the manager (which holds the key).
  if (process.env.DEMO_CLAUDE === '1') {
    settings.providers = settings.providers.filter((p) => p.id !== 'claude' && p.id !== 'cc-demo');
    settings.providers.push(
      { id: 'claude', name: 'Claude Sonnet 5.5', kind: 'anthropic', baseUrl: '', apiKey: '', model: 'claude-sonnet-5-5' },
      { id: 'cc-demo', name: 'Claude Code · Sonnet 5.5', kind: 'claude-code', baseUrl: '', apiKey: '', model: 'claude-sonnet-5-5' },
    );
    if (!settings.providers.some((p) => p.id === 'env')) settings.activeProvider = 'claude'; // no live GPU: Claude by default
  }
  const blocked: Array<[string, RegExp]> = [['POST', /^\/api\/providers/], ['GET', /^\/api\/fs/], ['POST', /^\/api\/pick-folder/], ['POST', /^\/api\/gpu\//]];
  app.use('/api/*', async (c, next) => {
    if (blocked.some(([m, r]) => c.req.method === m && r.test(c.req.path))) return c.json({ error: 'Not available in the online demo' }, 403);
    await next();
  });
}
const T = '/api/threads/:id';

// threads
app.get('/api/threads', async (c) => c.json((await listThreads()).filter((t) => !t.temp).map((t) => ({
  id: t.id, title: t.title, folder: t.folder, updatedAt: t.updatedAt, running: live.get(t.id)?.agent.running ?? false, engine: t.engine ?? 'native',
  tokens: t.usage.promptTokens + t.usage.completionTokens,
}))));
app.post('/api/threads', async (c) => {
  const { folder: picked, mode, providerId, scratch } = await c.req.json().catch(() => ({}));
  // No folder yet: give the thread its own empty project under ~/agent-stage-projects.
  let folder = picked;
  if (scratch) {
    folder = join(PUBLIC ? sandbox : join(homedir(), 'agent-stage-projects'), `project-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${crypto.randomUUID().slice(0, 4)}`);
    await mkdir(folder, { recursive: true });
    await initRepo(folder).catch(() => {}); // new projects get version history from the start
  }
  if ((!PUBLIC || demoModels().includes(providerId)) && providerId && settings.providers.some((p) => p.id === providerId) && providerId !== settings.activeProvider) {
    settings.activeProvider = providerId; await saveSettings(settings); retunnel();
  }
  const dir = resolve(folder || sandbox);
  if (PUBLIC && !within(sandbox, dir)) return c.json({ error: 'not a folder' }, 400);
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) return c.json({ error: 'not a folder' }, 400);
  return c.json(await newThread(dir, mode === 'learn' ? 'learn' : 'build'));
});
app.delete(T, async (c) => {
  const id = c.req.param('id'), l = live.get(id);
  l?.agent.stop(); live.delete(id);
  if (l) stopBackground(l.thread.folder); // the dev servers its agent started
  await deleteThread(id);
  return c.json({ ok: true });
});
app.get(`${T}/state`, async (c) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'no such thread' }, 404);
  return c.json({ workspace: l.thread.folder, title: l.thread.title, mode: l.thread.mode ?? 'build', parent: l.thread.parent,
    engine: l.thread.engine ?? 'native', providerId: l.thread.providerId,
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
    await stream.writeSSE({ event: 'hello', data: '' }); // lets the page tell a live stream from a held-back one
    for (const e of l.thread.events) await stream.writeSSE({ data: JSON.stringify(e) });
    const send = (e: Stamped) => void stream.writeSSE({ data: JSON.stringify(e) });
    l.listeners.add(send);
    stream.onAbort(() => { l.listeners.delete(send); });
    while (!stream.aborted) await stream.sleep(15_000).then(() => stream.writeSSE({ event: 'ping', data: '' }));
  });
});
// The same events by polling, for links that hold streams back (Cloudflare's free tunnels do).
app.get(`${T}/log`, async (c) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'no such thread' }, 404);
  const from = Math.max(0, Number(c.req.query('from') ?? 0) || 0);
  return c.json({ events: l.thread.events.slice(from), total: l.thread.events.length });
});
const withThread = (fn: (l: Live, body: any) => any) => async (c: any) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'no such thread' }, 404);
  const body = await c.req.json().catch(() => ({}));
  gpu.touch(); // any interaction keeps an auto-stopping GPU alive
  // A thread always runs on the currently selected model.
  if (!l.agent.running && engineOf(provider()) === (l.thread.engine ?? 'native')) {
    l.thread.providerId = settings.activeProvider; l.agent.setConfig(toConfig(provider()));
  }
  if (!l.agent.running) {
    l.agent.setOptions({ mode: l.thread.mode ?? 'build', learn: settings.learn });
  }
  const out = await fn(l, body);
  return c.json(out ?? { ok: true });
};
// Every task starts from a git checkpoint (when the folder is a repo), so it can be undone.
// It also ends with one (however it ended: done, stopped, step limit), so Undo knows which files were this task's.
async function runTask(l: Live, task: string) {
  const ref = await checkpoint(l.thread.folder, l.thread.id, task).catch(() => null);
  if (ref) l.emit({ type: 'snapshot', ref });
  await l.agent.run(task, settings.maxSteps).finally(() => l.emit({ type: 'idle' }));
  if (!ref) return;
  const after = await checkpoint(l.thread.folder, l.thread.id, `after: ${task}`).catch(() => null);
  const files = after ? await changedBetween(l.thread.folder, ref, after).catch(() => []) : [];
  if (after) l.emit({ type: 'task_end', ref, after, files: files.length });
}
// The files this task (and this thread's later tasks, which Undo also takes back) changed. Anything else in the
// folder, like the user's own edits or another thread's work, is left alone. Null for threads from before task_end.
async function filesOfTasksFrom(l: Live, ref: string): Promise<Set<string> | null> {
  const ends = l.thread.events.filter((e): e is AgentEvent & { type: 'task_end' } => e.type === 'task_end');
  const from = ends.findIndex((e) => e.ref === ref);
  if (from < 0) return null;
  const paths = new Set<string>();
  for (const e of ends.slice(from)) for (const f of await changedBetween(l.thread.folder, e.ref, e.after)) paths.add(f.path);
  return paths;
}
app.post(`${T}/task`, withThread((l, { task }) => {
  if (l.agent.running) return { error: 'agent is busy' };
  void runTask(l, task);
}));
app.post(`${T}/undo`, async (c) => {
  const l = await open(c.req.param('id'));
  const { ref } = await c.req.json().catch(() => ({}));
  if (!l || !/^[0-9a-f]{40}$/.test(ref ?? '')) return c.json({ error: 'bad request' }, 400);
  if (l.agent.running) return c.json({ error: 'Stop the agent first' }, 409);
  try {
    const files = await restore(l.thread.folder, ref, (await filesOfTasksFrom(l, ref)) ?? undefined);
    l.emit({ type: 'restored', ref, files });
    // Otherwise the model still "remembers" the undone code and writes it back on the next task.
    if (files.length) l.agent.notes.push(`Note from agent-stage: the user pressed Undo. These files are back to how they were before your earlier task, so your changes to them are gone: ${files.map((f) => f.path).join(', ')}. Read files again before relying on what you remember of them.`);
    return c.json({ files });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});
// Keep: commit the files this task changed, with a message the model writes from the task and the diff.
app.post(`${T}/keep-task`, async (c) => {
  const l = await open(c.req.param('id'));
  const { ref } = await c.req.json().catch(() => ({}));
  if (!l || !/^[0-9a-f]{40}$/.test(ref ?? '')) return c.json({ error: 'bad request' }, 400);
  if (l.agent.running) return c.json({ error: 'Stop the agent first' }, 409);
  const end = (l.thread.events as any[]).find((e) => e.type === 'task_end' && e.ref === ref);
  if (!end) return c.json({ error: 'This task has no record of its changes' }, 404);
  try {
    const paths = (await changedBetween(l.thread.folder, ref, end.after)).map((f) => f.path);
    if (!paths.length) return c.json({ error: 'This task changed no files' }, 400);
    const startIdx = (l.thread.events as any[]).findIndex((e) => e.type === 'snapshot' && e.ref === ref);
    const task = (l.thread.events as any[]).slice(startIdx).find((e) => e.type === 'user')?.text ?? '';
    const message = await commitMessage(toConfig(provider(l.thread.providerId)), task, await diffSince(l.thread.folder, ref, paths));
    const commit = await commitFiles(l.thread.folder, paths, message);
    l.emit({ type: 'kept', ref, commit, message });
    return c.json({ commit, message });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});
app.get(`${T}/git`, async (c) => {
  const l = await open(c.req.param('id'));
  return l ? c.json({ repo: await isRepo(l.thread.folder) }) : c.json({ error: 'not found' }, 404);
});
app.post(`${T}/git/init`, async (c) => {
  const l = await open(c.req.param('id'));
  if (!l) return c.json({ error: 'not found' }, 404);
  try { if (!(await isRepo(l.thread.folder))) await initRepo(l.thread.folder); return c.json({ repo: true }); }
  catch (e: any) { return c.json({ error: e.message }, 500); }
});
app.post(`${T}/stop`, withThread((l) => {
  if (!l.agent.running && !l.approvals.size && !l.checkpoints.size) { l.emit({ type: 'idle' }); return; } // the page thought it was still running
  l.agent.stop();
  for (const [id, ok] of l.approvals) { l.emit({ type: 'approval_answer', id, ok: false }); ok(false); }
  l.approvals.clear();
  for (const [, ok] of l.checkpoints) ok({ choice: 'discuss', text: '(stopped by the learner)' });
  l.checkpoints.clear();
}));
app.post(`${T}/ask`, withThread((l, { text }) => { void l.agent.ask(text); }));
app.post(`${T}/steer`, withThread((l, { text }) => {
  if (l.agent.running) l.agent.interject(text);
  else void runTask(l, text); // idle: steering is just the next task, with full context
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
// Ask gets a short brief of the main thread, not a copy of all of it: a side question then costs a few thousand
// tokens instead of the whole conversation (which can be 50k+ late in a task). The side agent reads files itself.
async function briefOf(l: Live) {
  const ev = l.thread.events as any[];
  const tasks = ev.filter((e) => e.type === 'user').slice(-3).map((e) => `- ${String(e.text).slice(0, 300)}`);
  const labels = new Map(ev.filter((e) => e.type === 'label').map((e) => [e.stepId, e.label]));
  const starts = new Map(ev.filter((e) => e.type === 'tool_start').map((e) => [e.id, e]));
  const steps = ev.filter((e) => e.type === 'tool_end').slice(-15).map((e) => {
    const s = starts.get(e.id), what = labels.get(e.id) ?? `${e.name} ${s?.args?.path ?? s?.args?.command ?? ''}`.trim();
    return `- ${what}${e.ok ? '' : ' (failed)'}`;
  });
  const said = [...ev].reverse().find((e) => e.type === 'done' || e.type === 'thinking')?.text ?? '';
  const files = (await listFiles(l.thread.folder)).slice(0, 80);
  return [`Context from the main thread: a short brief, not the whole conversation. Read files when you need details.`,
    `Files in the project: ${files.join(', ') || '(none)'}`,
    tasks.length ? `Recent requests:\n${tasks.join('\n')}` : '',
    steps.length ? `What the agent did most recently:\n${steps.join('\n')}` : '',
    said ? `The agent's latest message:\n${String(said).slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n\n');
}
app.post(`${T}/ask-thread`, withThread(async (l, { question }) => {
  const t = await newThread(l.thread.folder, 'ask', l.thread.id, true);
  t.engine = l.thread.engine; t.providerId = l.thread.providerId; await saveThread(t);
  t.title = String(question).slice(0, 60);
  const side = await open(t.id);
  if (!side) return { error: 'could not open side thread' };
  side.agent.notes.push(await briefOf(l));
  void side.agent.run(String(question), 12).finally(() => side.emit({ type: 'idle' }));
  return { id: t.id };
}));
// Clear or compact what the model remembers of this thread (the chat on screen stays). Compact keeps a summary.
app.post(`${T}/context`, withThread(async (l, { action }) => {
  if (l.agent.running) return { error: 'Stop the agent first' };
  let summary: string | undefined;
  if (action === 'compact') {
    const ev = l.thread.events as any[];
    const transcript = ev.map((e) => e.type === 'user' ? `User: ${e.text}` : e.type === 'done' ? `Agent: ${e.text}` : e.type === 'label' ? `  step: ${e.label}` : e.type === 'context' && e.summary ? `Earlier summary:\n${e.summary}` : '').filter(Boolean).join('\n');
    summary = await summarizeThread(toConfig(provider(l.thread.providerId)), transcript).catch(() => undefined);
    if (!summary) return { error: 'Could not write the summary. Try again, or clear instead.' };
  }
  if (l.agent instanceof ClaudeCodeAgent) { l.agent.sessionId = undefined; l.agent.fork = false; l.thread.sessionId = undefined; }
  else l.agent.messages = l.agent.messages.slice(0, 1); // keep the system prompt
  l.agent.notes = summary ? [`Summary of this thread so far (the full conversation was compacted):\n${summary}`] : [];
  l.emit({ type: 'context', action: action === 'compact' ? 'compact' : 'clear', summary });
}));
app.post(`${T}/keep`, withThread((l) => { l.thread.temp = false; persist(l); }));
app.post(`${T}/checkpoint`, withThread((l, { id, choice, text }) => {
  l.checkpoints.get(id)?.({ choice: choice === 'confirm' || choice === 'skip' ? choice : 'discuss', text });
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
  const answer = l.approvals.get(id);
  if (!answer) return; // already answered (a double click, or a second tab)
  l.approvals.delete(id);
  l.emit({ type: 'approval_answer', id, ok: Boolean(ok) });
  answer(Boolean(ok));
}));

// settings + providers
app.get('/api/settings', (c) => c.json(publicSettings()));
app.get('/api/presets', (c) => c.json(PRESETS));
app.put('/api/settings', async (c) => {
  let next = await c.req.json();
  if (PUBLIC) { // visitors can only switch between the demo's models
    if (!demoModels().includes(next.activeProvider)) return c.json({ error: 'Not available in the online demo' }, 403);
    next = { activeProvider: next.activeProvider };
  }
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
  return c.json(await checkModel(toConfig({ ...p, apiKey: key ?? '' })));
});

// usage across all threads, per provider
app.get('/api/stats', async (c) => {
  const threads = await listThreads();
  const byProvider: Record<string, { tokens: number; calls: number; threads: number; gpuHours: number; gpuCost: number; apiCost: number }> = {};
  // A thread's spend: what the provider reported (Claude Code does), else an estimate from list prices.
  const spendOf = (t: Thread) => t.usage.costUsd ?? apiCost(settings.providers.find((p) => p.id === t.providerId), t.usage.promptTokens, t.usage.completionTokens);
  for (const t of threads) {
    const b = (byProvider[t.providerId] ??= { tokens: 0, calls: 0, threads: 0, gpuHours: 0, gpuCost: 0, apiCost: 0 });
    b.tokens += t.usage.promptTokens + t.usage.completionTokens; b.calls += t.usage.calls; b.threads++; b.apiCost += spendOf(t);
  }
  for (const [id, ms] of Object.entries(gpuMs)) {
    const b = (byProvider[id] ??= { tokens: 0, calls: 0, threads: 0, gpuHours: 0, gpuCost: 0, apiCost: 0 });
    b.gpuHours = ms / 3_600_000; b.gpuCost = b.gpuHours * (provider(id).gpuHourly ?? 0);
  }
  return c.json({
    byProvider,
    threads: threads.map((t) => ({ id: t.id, title: t.title, providerId: t.providerId, tokens: t.usage.promptTokens + t.usage.completionTokens, calls: t.usage.calls, spend: spendOf(t), updatedAt: t.updatedAt })),
  });
});

// health of the active provider + this session's usage
app.get('/api/health', async (c) => {
  if (c.req.query('now')) await refreshHealth();
  const p = provider();
  const threads = [...live.values()].map((l) => l.thread.usage);
  const u = threads.reduce((a, b) => ({ promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, modelMs: a.modelMs + b.modelMs, calls: a.calls + b.calls, costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) }),
    { promptTokens: 0, completionTokens: 0, modelMs: 0, calls: 0, costUsd: 0 });
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

// Native folder dialog (macOS Finder). The server runs on this computer, so it can open one; the browser can't.
app.post('/api/pick-folder', async (c) => {
  if (process.platform !== 'darwin') return c.json({ error: 'unsupported' }, 400);
  const { execFile } = await import('node:child_process');
  const out = await new Promise<string | null>((ok) => execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Open a project folder")'],
    { timeout: 300_000 }, (err, stdout) => ok(err ? null : stdout.trim().replace(/\/$/, ''))));
  return out ? c.json({ path: out }) : c.json({ cancelled: true });
});

// Browser screenshots for the stage.
app.get('/api/shots/:name', async (c) => {
  const name = c.req.param('name');
  if (!/^[\w-]+\.png$/.test(name)) return c.json({ error: 'bad name' }, 400);
  const buf = await readFile(join(SHOTS, name)).catch(() => null);
  return buf ? c.body(buf, 200, { 'content-type': 'image/png', 'cache-control': 'max-age=31536000' }) : c.json({ error: 'gone' }, 404);
});

app.get('/api/gpu', (c) => c.json(gpu.view()));
app.post('/api/gpu/start', async (c) => {
  try { void gpu.start(); return c.json(gpu.view()); } catch (e: any) { return c.json({ error: e.message }, 400); }
});
// The live demo's model calls skip this server: the demo manager reports them here so auto-stop counts them.
app.post('/api/gpu/touch', (c) => { gpu.touch(); return c.json({ ok: true }); });
app.post('/api/gpu/stop', async (c) => { void gpu.stop('Stopped by you'); return c.json(gpu.view()); });

// Which engines can run here: Claude Code needs an Anthropic API key on one of its models.
app.get('/api/engines', (c) => {
  const cc = settings.providers.filter((p) => p.kind === 'claude-code');
  return c.json({
    native: { ready: true },
    'claude-code': PUBLIC && process.env.DEMO_CLAUDE !== '1' ? { ready: false, reason: 'Not in the online demo' } : { ready: cc.some((p) => keyOf(p)), reason: cc.length ? (cc.some((p) => keyOf(p)) ? '' : 'Add an Anthropic API key') : 'Add a Claude Code model in Settings' },
    codex: { ready: false, reason: 'Coming soon' },
  });
});

app.get('/api/me', async (c) => c.json({
  name: PUBLIC ? 'visitor' : userInfo().username, home: homedir(), sandbox, public: PUBLIC, internet: PUBLIC && process.env.DEMO_INTERNET === '1',
  // Online demo: the projects in the container to start from.
  samples: PUBLIC ? (await readdir(sandbox, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(sandbox, e.name)) : undefined,
}));

// The page itself must never be cached (it names the current build's files); hashed assets can be.
app.use('/*', async (c, next) => {
  await next();
  if (!c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
});
app.use('/*', serveStatic({ root: './web/dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`agent-stage → http://localhost:${port}  ·  model ${provider().name}  ·  data ~/.agent-stage`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { tunnel.stop(); stopBackground(); await closeBrowser(); process.exit(0); });
