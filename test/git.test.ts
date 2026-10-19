// Checkpoints and Undo: they must never touch the user's branch, staged files or other work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpoint, changedSince, restore, commitFiles, initRepo, isRepo } from '../src/git.ts';

// A fixed identity so commits work on a machine (or CI runner) without a git config.
// The ceiling keeps git from finding a repo above the temp folder (some people keep their home folder in git).
Object.assign(process.env, { GIT_CEILING_DIRECTORIES: tmpdir(), GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@localhost' });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const exists = (p: string) => access(p).then(() => true, () => false);

async function repo(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'agst-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'a.txt'), 'a1');
  await writeFile(join(dir, 'b.txt'), 'b1');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}

test('a checkpoint leaves the branch, history and staged files alone', async (t) => {
  const dir = await repo(t);
  await writeFile(join(dir, 'a.txt'), 'a2-staged'); git(dir, 'add', 'a.txt');
  await writeFile(join(dir, 'b.txt'), 'b2-unstaged');
  const head = git(dir, 'rev-parse', 'HEAD'), status = git(dir, 'status', '--porcelain');
  const id = await checkpoint(dir, 'thread1', 'add a feature');
  assert.ok(id);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(dir, 'status', '--porcelain'), status);
  assert.equal(git(dir, 'branch', '--show-current'), 'main');
  assert.match(git(dir, 'for-each-ref', '--format=%(refname)', 'refs/agent-stage/'), /^refs\/agent-stage\/thread1\/\d+$/);
  assert.equal(git(dir, 'show', `${id}:b.txt`), 'b2-unstaged'); // it saved the folder as it really was
});

test('undo puts changed files back and removes new ones with their folders', async (t) => {
  const dir = await repo(t);
  const id = (await checkpoint(dir, 't', 'task'))!;
  await writeFile(join(dir, 'a.txt'), 'changed by the agent');
  await mkdir(join(dir, 'new/deep'), { recursive: true });
  await writeFile(join(dir, 'new/deep/file.js'), 'new');
  const changed = await changedSince(dir, id);
  assert.deepEqual(changed.map((f) => `${f.status} ${f.path}`).sort(), ['A new/deep/file.js', 'M a.txt']);
  await restore(dir, id);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'a1');
  assert.equal(await exists(join(dir, 'new')), false);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('undo for one task leaves other changes in the folder alone', async (t) => {
  const dir = await repo(t);
  const id = (await checkpoint(dir, 't', 'task'))!;
  await writeFile(join(dir, 'a.txt'), 'the task');
  await writeFile(join(dir, 'b.txt'), 'the user, meanwhile');
  const back = await restore(dir, id, new Set(['a.txt']));
  assert.deepEqual(back.map((f) => f.path), ['a.txt']);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'a1');
  assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'the user, meanwhile');
});

test('a deleted file comes back', async (t) => {
  const dir = await repo(t);
  const id = (await checkpoint(dir, 't', 'task'))!;
  await rm(join(dir, 'b.txt'));
  await restore(dir, id);
  assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'b1');
});

test('Keep commits only the task files, and the user\'s staged work stays staged', async (t) => {
  const dir = await repo(t);
  await writeFile(join(dir, 'b.txt'), 'user work'); git(dir, 'add', 'b.txt');
  await writeFile(join(dir, 'a.txt'), 'agent work');
  await writeFile(join(dir, 'c.txt'), 'agent new file');
  const short = await commitFiles(dir, ['a.txt', 'c.txt'], 'Add c and update a');
  assert.equal(git(dir, 'rev-parse', '--short', 'HEAD'), short);
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'Add c and update a');
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['a.txt', 'c.txt']);
  assert.equal(git(dir, 'status', '--porcelain'), 'M  b.txt');
  await assert.rejects(commitFiles(dir, ['a.txt'], 'again'), /Nothing to keep/);
});

test('no checkpoint outside a repo, until version history is turned on', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agst-norepo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'x.txt'), 'x');
  assert.equal(await isRepo(dir), false);
  assert.equal(await checkpoint(dir, 't', 'task'), null);
  await initRepo(dir);
  assert.equal(await isRepo(dir), true);
  assert.ok(await checkpoint(dir, 't', 'task'));
});
