// The done-check: the harness runs the project's own check instead of taking the agent's word for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCheck, runCheck, doneCheck, newRun, MAX_CHECKS, NUDGE } from '../src/verify.ts';
import type { ToolContext } from '../src/tools.ts';

async function project(t: { after: (fn: () => Promise<void>) => void }, files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agst-verify-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return dir;
}
const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'p', scripts });

test('finds the project check, tests first', async (t) => {
  assert.equal(await findCheck(await project(t, { 'package.json': pkg({ test: 'node --test', build: 'vite build' }) })), 'npm test --silent');
  assert.equal(await findCheck(await project(t, { 'package.json': pkg({ build: 'vite build', typecheck: 'tsc' }) })), 'npm run typecheck --silent');
  assert.equal(await findCheck(await project(t, { 'pyproject.toml': '' })), 'python3 -m pytest -q');
  assert.equal(await findCheck(await project(t, { 'Cargo.toml': '' })), 'cargo test -q');
  assert.equal(await findCheck(await project(t, { 'go.mod': '' })), 'go test ./...');
  assert.equal(await findCheck(await project(t)), null);
});

test("npm's placeholder test script doesn't count", async (t) => {
  const dir = await project(t, { 'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1' }) });
  assert.equal(await findCheck(dir), null);
});

test('a Python tests folder is enough', async (t) => {
  const dir = await project(t);
  await mkdir(join(dir, 'tests'));
  assert.equal(await findCheck(dir), 'python3 -m pytest -q');
});

test('runCheck tells a failing check from a missing tool', async (t) => {
  const dir = await project(t);
  assert.deepEqual(await runCheck(dir, 'echo fine'), { ok: true, missing: false, output: 'fine' });
  const failed = await runCheck(dir, 'echo "1 failing"; exit 1');
  assert.equal(failed.ok, false); assert.equal(failed.missing, false); assert.match(failed.output, /1 failing/);
  const missing = await runCheck(dir, 'agst-no-such-tool --version');
  assert.equal(missing.ok, false); assert.equal(missing.missing, true);
});

function harness(root: string, answer = true) {
  const events: { state: string; command?: string }[] = [], asked: string[] = [];
  const ctx: ToolContext = { root, approve: async (cmd) => { asked.push(cmd); return answer; } };
  return { ctx, events, asked, emit: (e: { state: string; command?: string }) => events.push({ state: e.state, command: e.command }) };
}

test('a failing check sends the agent back, then hands over after the last try', async (t) => {
  // node rather than `echo; exit 1`: npm runs scripts with cmd.exe on Windows
  const root = await project(t, { 'package.json': pkg({ test: `node -e "console.log('expected 2, got 3'); process.exit(1)"` }) });
  const h = harness(root), run = newRun(), approved = new Set<string>();
  for (let i = 1; i < MAX_CHECKS; i++) {
    const reply = await doneCheck(h.ctx, h.emit, run, approved);
    assert.match(reply ?? '', /You are not done yet/);
    assert.match(reply ?? '', /expected 2, got 3/);
  }
  assert.equal(await doneCheck(h.ctx, h.emit, run, approved), null); // gives up instead of looping forever
  assert.equal(run.gaveUp, 'npm test --silent');
  assert.deepEqual(h.asked, ['npm test --silent']); // asked once per thread, not on every retry
  assert.deepEqual(h.events.map((e) => e.state), Array(MAX_CHECKS).fill(['running', 'fail']).flat());
});

test('a passing check accepts "done"', async (t) => {
  const root = await project(t, { 'package.json': pkg({ test: 'exit 0' }) });
  const h = harness(root);
  assert.equal(await doneCheck(h.ctx, h.emit, newRun(), new Set()), null);
  assert.deepEqual(h.events.map((e) => e.state), ['running', 'pass']);
});

test('a declined check is not run', async (t) => {
  const root = await project(t, { 'package.json': pkg({ test: 'touch ran.txt' }) });
  const h = harness(root, false);
  assert.equal(await doneCheck(h.ctx, h.emit, newRun(), new Set()), null);
  assert.deepEqual(h.events.map((e) => e.state), ['declined']);
});

test('without a check, the agent gets one nudge to test its work', async (t) => {
  const h = harness(await project(t)), run = newRun();
  assert.equal(await doneCheck(h.ctx, h.emit, run, new Set()), NUDGE);
  assert.equal(await doneCheck(h.ctx, h.emit, run, new Set()), null);
  assert.deepEqual(h.events.map((e) => e.state), ['nudge']);
});
