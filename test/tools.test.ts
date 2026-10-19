// The agent's file and shell tools: they must stay inside the thread's folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool, type ToolContext } from '../src/tools.ts';

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'agst-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const ctx = (root: string, approve = true): ToolContext => ({ root, approve: async () => approve });

test('reads and writes files inside the workspace', async (t) => {
  const root = await workspace(t);
  const changes: string[] = [];
  const c = { ...ctx(root), onChange: (p: string, before: string, after: string) => changes.push(`${p}:${before}→${after}`) };
  await runTool(c, 'write_file', { path: 'src/a.txt', content: 'one' });
  assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'one');
  assert.equal(await runTool(c, 'read_file', { path: 'src/a.txt' }), 'one');
  await runTool(c, 'edit_file', { path: 'src/a.txt', old: 'one', new: 'two' });
  assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'two');
  assert.deepEqual(changes, ['src/a.txt:→one', 'src/a.txt:one→two']); // feeds the diff view
});

test('refuses paths that leave the workspace', async (t) => {
  const root = await workspace(t);
  const outside = join(root, '..', `agst-outside-${process.pid}.txt`);
  for (const path of ['../escape.txt', 'a/../../escape.txt', outside, '/etc/passwd', '..']) {
    await assert.rejects(runTool(ctx(root), 'write_file', { path, content: 'x' }), /escapes workspace/, path);
    await assert.rejects(runTool(ctx(root), 'read_file', { path }), /escapes workspace/, path);
  }
});

test('refuses another drive on Windows', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await workspace(t);
  const other = root.toUpperCase().startsWith('Z:') ? 'Y:\\escape.txt' : 'Z:\\escape.txt';
  await assert.rejects(runTool(ctx(root), 'read_file', { path: other }), /escapes workspace/);
});

test('allows names that only start with two dots', async (t) => {
  const root = await workspace(t);
  await runTool(ctx(root), 'write_file', { path: '..notes.md', content: 'ok' });
  assert.equal(await runTool(ctx(root), 'read_file', { path: '..notes.md' }), 'ok');
});

test('edit_file needs exactly one match', async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, 'f.txt'), 'x x');
  await assert.rejects(runTool(ctx(root), 'edit_file', { path: 'f.txt', old: 'y', new: 'z' }), /not found/);
  await assert.rejects(runTool(ctx(root), 'edit_file', { path: 'f.txt', old: 'x', new: 'z' }), /appears 2 times/);
  assert.equal(await readFile(join(root, 'f.txt'), 'utf8'), 'x x');
});

test('read_file hands out long files in pages', async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, 'long.txt'), Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n'));
  const first = await runTool(ctx(root), 'read_file', { path: 'long.txt' });
  assert.match(first, /^\[lines 1-400 of 1000; read more with offset=401\]/);
  const last = await runTool(ctx(root), 'read_file', { path: 'long.txt', offset: 801 });
  assert.match(last, /^\[lines 801-1000 of 1000/);
  assert.match(last, /line 1000$/);
});

test('list_files and search skip node_modules and hidden folders', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'node_modules/pkg'), { recursive: true });
  await mkdir(join(root, '.git'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'node_modules/pkg/index.js'), 'needle');
  await writeFile(join(root, '.git/config'), 'needle');
  await writeFile(join(root, 'src/app.js'), 'const needle = 1;');
  // '/' on every system, Windows included: the map, the agent and git all use it
  assert.equal(await runTool(ctx(root), 'list_files', {}), 'src/app.js');
  assert.equal(await runTool(ctx(root), 'search', { text: 'needle' }), 'src/app.js:1: const needle = 1;');
});

// A folder link: 'junction' needs no admin rights on Windows, and is ignored elsewhere.
const linkDir = (target: string, path: string) => symlink(target, path, 'junction');

test('links inside the project cannot lead the tools outside', async (t) => {
  const root = await workspace(t), elsewhere = await workspace(t);
  await writeFile(join(elsewhere, 'secret.txt'), 'top secret');
  await linkDir(elsewhere, join(root, 'door'));
  await assert.rejects(runTool(ctx(root), 'read_file', { path: 'door/secret.txt' }), /escapes workspace/);
  await assert.rejects(runTool(ctx(root), 'write_file', { path: 'door/new.txt', content: 'x' }), /escapes workspace/);
  await assert.rejects(runTool(ctx(root), 'write_file', { path: 'door/deep/new.txt', content: 'x' }), /escapes workspace/);
  await assert.rejects(runTool(ctx(root), 'edit_file', { path: 'door/secret.txt', old: 'top', new: 'no' }), /escapes workspace/);
  assert.equal(await runTool(ctx(root), 'search', { text: 'secret' }), 'no matches');
  assert.equal(await readFile(join(elsewhere, 'secret.txt'), 'utf8'), 'top secret');
});

test('a link that stays inside the project still works', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'real'));
  await writeFile(join(root, 'real/a.txt'), 'here');
  await linkDir(join(root, 'real'), join(root, 'alias'));
  assert.equal(await runTool(ctx(root), 'read_file', { path: 'alias/a.txt' }), 'here');
});

test('a project opened through a link works', async (t) => {
  const real = await workspace(t), parent = await workspace(t);
  await writeFile(join(real, 'a.txt'), 'via link');
  await linkDir(real, join(parent, 'project'));
  const root = join(parent, 'project');
  assert.equal(await runTool(ctx(root), 'read_file', { path: 'a.txt' }), 'via link');
  await runTool(ctx(root), 'write_file', { path: 'new/b.txt', content: 'ok' });
  assert.equal(await readFile(join(real, 'new/b.txt'), 'utf8'), 'ok');
});

test('run_command asks first, and a denied command fails', async (t) => {
  const root = await workspace(t);
  const asked: string[] = [];
  const c: ToolContext = { root, approve: async (cmd) => { asked.push(cmd); return false; } };
  await assert.rejects(runTool(c, 'run_command', { command: 'echo hi > hi.txt' }), /denied/);
  assert.deepEqual(asked, ['echo hi > hi.txt']);
  await assert.rejects(readFile(join(root, 'hi.txt')));
});

test('run_command runs in the workspace and reports failures', async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, 'here.txt'), '');
  assert.match(await runTool(ctx(root), 'run_command', { command: 'ls' }), /here\.txt/);
  await assert.rejects(runTool(ctx(root), 'run_command', { command: 'echo broken; exit 3' }), /exit 3\nbroken/);
});

test('search and read skip binary files (a big .psd once froze the server)', async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, 'notes.txt'), 'find the needle here');
  await writeFile(join(root, 'art.psd'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from('needle')]));
  assert.equal(await runTool(ctx(root), 'search', { text: 'needle' }), 'notes.txt:1: find the needle here');
  assert.match(await runTool(ctx(root), 'read_file', { path: 'art.psd' }), /binary/);
});
