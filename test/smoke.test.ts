// End-to-end smoke test: boot the real server on the scripted model, run a task through the HTTP API the UI uses,
// approve what it asks, wait for it to finish, check the files it wrote, then Undo and check they are gone.
// It runs in its own temp home (settings, threads, scratch projects), on a free port, with no key, GPU or tunnel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exists = (p: string) => access(p).then(() => true, () => false);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

let home = '', base = '', server: ChildProcess | undefined, output = '';

async function api(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(base + path, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json();
  assert.ok(res.ok, `${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'agst-smoke-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/server.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port), MODEL_API_KEY: 'mock', TUNNEL_HOST: '', BREV_INSTANCE: '', GPU_HOURLY_USD: '0', PUBLIC: '',
      AGENT_STAGE_HOME: join(home, '.agent-stage'), HOME: home, USERPROFILE: home, WORKSPACE: join(home, 'workspace'),
      // Checkpoints are commits: give git an identity and keep it from finding a repo above the temp folder.
      GIT_CEILING_DIRECTORIES: tmpdir(), GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => { output += d; });
  server.stderr!.on('data', (d) => { output += d; });
  for (let i = 0; i < 100; i++) { // up to 10 s to boot
    if (server.exitCode !== null) throw new Error(`server exited:\n${output}`);
    if (await fetch(`${base}/api/me`).then((r) => r.ok, () => false)) return;
    await sleep(100);
  }
  throw new Error(`server did not start:\n${output}`);
});

after(async () => {
  server?.kill('SIGTERM');
  await sleep(300);
  if (server && server.exitCode === null) server.kill('SIGKILL');
  await rm(home, { recursive: true, force: true });
});

test('/api/me and /api/settings answer, on the scripted model', async () => {
  const me = await api('/api/me');
  assert.equal(me.public, false);
  assert.equal(me.home, home);
  const settings = await api('/api/settings');
  assert.equal(settings.activeProvider, 'mock');
  assert.ok(Array.isArray(settings.providers) && settings.providers.length > 0);
  for (const p of settings.providers) assert.doesNotMatch(String(p.apiKey), /^[^•]{9,}$/, 'keys are masked');
});

test('a scratch thread runs a task to the end, writes files, and Undo takes them back', { timeout: 90_000 }, async () => {
  const thread = await api('/api/threads', { body: { scratch: true, mode: 'build' } });
  assert.match(thread.id, /^[0-9a-f]{8}$/);
  assert.ok(thread.folder.startsWith(home), 'the scratch project lives in the temp home');
  const T = `/api/threads/${thread.id}`;

  await api(`${T}/task`, { body: { task: 'make a small greeter module with a test' } });

  // Drive it like the UI's polling fallback: read new events, approve every command and done-check it asks for.
  const events: any[] = [];
  const answered = new Set<string>();
  const deadline = Date.now() + 80_000;
  while (!(events.some((e) => e.type === 'idle') && events.some((e) => e.type === 'task_end'))) {
    assert.ok(Date.now() < deadline, `task did not finish; last events: ${JSON.stringify(events.slice(-5))}`);
    const { events: fresh } = await api(`${T}/log?from=${events.length}`);
    events.push(...fresh);
    for (const e of fresh) if (e.type === 'approval' && !answered.has(e.id)) {
      answered.add(e.id);
      await api(`${T}/approve`, { body: { id: e.id, ok: true } });
    }
    await sleep(200);
  }

  const types = new Set(events.map((e) => e.type));
  assert.ok(!types.has('error'), `no error: ${JSON.stringify(events.find((e) => e.type === 'error'))}`);
  for (const t of ['user', 'snapshot', 'tool_start', 'tool_end', 'file_change', 'done', 'task_end']) assert.ok(types.has(t), `has a ${t} event`);
  // The scripted model plants a bug, the done-check catches it, the agent fixes it and the check passes.
  const verify = events.filter((e) => e.type === 'verify').map((e) => e.state);
  assert.ok(verify.includes('fail') && verify.at(-1) === 'pass', `done-check failed then passed: ${verify}`);

  const greet = await readFile(join(thread.folder, 'src/greet.js'), 'utf8');
  assert.match(greet, /export function greet/);
  for (const f of ['package.json', 'test.js', 'index.js', 'README.md']) assert.ok(await exists(join(thread.folder, f)), `${f} written`);

  const state = await api(`${T}/state`);
  assert.equal(state.running, false);
  assert.ok(state.files.includes('src/greet.js'));

  // Undo to the task's checkpoint: the project goes back to empty.
  const { ref } = events.find((e) => e.type === 'snapshot');
  const { files } = await api(`${T}/undo`, { body: { ref } });
  assert.ok(files.some((f: any) => f.path === 'src/greet.js'));
  for (const f of ['src/greet.js', 'package.json', 'test.js', 'index.js', 'README.md']) assert.ok(!(await exists(join(thread.folder, f))), `${f} removed by Undo`);
  const { events: last } = await api(`${T}/log?from=${events.length}`);
  assert.ok(last.some((e: any) => e.type === 'restored'));

  await api(T, { method: 'DELETE' });
});
