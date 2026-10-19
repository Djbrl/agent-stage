// Safety net for real code: a git checkpoint before every task, and an undo that puts the files back.
// Checkpoints are commits under refs/agent-stage/* built with a throwaway index, so the user's branch,
// staged files and history are never touched. Ignored files (node_modules, .env…) are left alone.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((ok, fail) => execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 << 20 },
    (err, out, errOut) => (err ? fail(new Error(String(errOut || err.message).trim())) : ok(out.trim()))));
}

export async function isRepo(dir: string) {
  return git(dir, ['rev-parse', '--show-toplevel']).then((top) => top.length > 0, () => false);
}

// "Turn on version history": git init plus a first commit of what's there.
export async function initRepo(dir: string) {
  await git(dir, ['init', '-q']);
  await git(dir, ['add', '-A']);
  await git(dir, ['-c', 'user.name=agent-stage', '-c', 'user.email=agent-stage@localhost', 'commit', '-q', '--allow-empty', '-m', 'Start of version history']);
}

// The working tree as a tree object, via a private index (the real one is untouched).
async function snapshotTree(dir: string) {
  const tmp = await mkdtemp(join(tmpdir(), 'agst-'));
  const env = { GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    await git(dir, ['read-tree', 'HEAD'], env).catch(() => git(dir, ['read-tree', '--empty'], env));
    await git(dir, ['add', '-A', '.'], env);
    return await git(dir, ['write-tree'], env);
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

export async function checkpoint(dir: string, thread: string, label: string): Promise<string | null> {
  if (!(await isRepo(dir))) return null;
  const tree = await snapshotTree(dir);
  const parent = await git(dir, ['rev-parse', '-q', '--verify', 'HEAD']).catch(() => '');
  const id = await git(dir, ['-c', 'user.name=agent-stage', '-c', 'user.email=agent-stage@localhost',
    'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `agent-stage checkpoint: ${label.slice(0, 72)}`]);
  await git(dir, ['update-ref', `refs/agent-stage/${thread}/${Date.now()}`, id]); // keeps it from being garbage-collected
  return id;
}

// Files that differ between two checkpoints (or tree objects).
export async function changedBetween(dir: string, a: string, b: string) {
  const out = await git(dir, ['diff', '--name-status', '--no-renames', '--relative', a, b]);
  return out ? out.split('\n').map((l) => { const [s, ...p] = l.split('\t'); return { status: s, path: p.join('\t') }; }) : [];
}

// Files that differ between a checkpoint and the folder as it is now.
export async function changedSince(dir: string, id: string) {
  return changedBetween(dir, id, await snapshotTree(dir));
}

// The diff of some files between a checkpoint and the folder now (new files included), for a commit message.
export async function diffSince(dir: string, id: string, paths: string[]) {
  return git(dir, ['diff', '--relative', id, await snapshotTree(dir), '--', ...paths]);
}

// Keep: commit just these files on the user's current branch. Their own staged work on other files stays staged.
export async function commitFiles(dir: string, paths: string[], message: string) {
  if (!(await git(dir, ['status', '--porcelain', '--', ...paths]))) throw new Error('Nothing to save: this version is already saved.');
  await git(dir, ['add', '-A', '--', ...paths]);
  const args = ['commit', '-q', '-m', message, '--', ...paths];
  await git(dir, args).catch((e) => {
    if (!/tell me who you are|user\.(name|email)/i.test(e.message)) throw e;
    return git(dir, ['-c', 'user.name=agent-stage', '-c', 'user.email=agent-stage@localhost', ...args]); // no git identity set up
  });
  return git(dir, ['rev-parse', '--short', 'HEAD']);
}

// Put files back as they were at the checkpoint (and remove files created since). With `only`, just those
// paths: undoing a task must not wipe what the user or another thread changed elsewhere in the folder.
export async function restore(dir: string, id: string, only?: Set<string>) {
  const files = (await changedSince(dir, id)).filter((f) => !only || only.has(f.path));
  if (!files.length) return files;
  const tmp = await mkdtemp(join(tmpdir(), 'agst-'));
  const env = { GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    await git(dir, ['read-tree', id], env);
    const back = files.filter((f) => f.status !== 'A').map((f) => f.path);
    if (back.length) await git(dir, ['checkout-index', '-f', '--', ...back], env);
    for (const f of files.filter((f) => f.status === 'A')) {
      await unlink(join(dir, f.path)).catch(() => {});
      // and the folders that only existed for them (rmdir fails on anything non-empty, which is what we want)
      for (let d = dirname(f.path); d !== '.' && d !== '/'; d = dirname(d)) if (!(await rmdir(join(dir, d)).then(() => true, () => false))) break;
    }
  } finally { await rm(tmp, { recursive: true, force: true }); }
  return files;
}
