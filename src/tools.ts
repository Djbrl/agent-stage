// The agent's hands. Everything is confined to the workspace folder.
import { readFile, writeFile, readdir, mkdir, realpath, stat } from 'node:fs/promises';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { resolve, relative, dirname, basename, join, isAbsolute, sep } from 'node:path';
import { browserSchemas, BROWSER_TOOLS, runBrowserTool } from './browser.ts';

export type ToolContext = {
  root: string;
  approve: (command: string, kind?: 'check') => Promise<boolean>; // UI hook: human approves shell commands ('check': agent-stage's own done-check)
  onChange?: (path: string, before: string, after: string) => void; // feeds the diff view
};

// A project path as the UI, the agent and git write it: always '/', also on Windows.
export const relPath = (root: string, full: string) => relative(root, full).split(sep).join('/');

// '..notes.md' is a fine name; another drive on Windows comes back absolute.
export function within(root: string, full: string) {
  const rel = relative(root, full);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

async function inside(root: string, p: string): Promise<string> {
  const full = resolve(root, p);
  if (!within(root, full)) throw new Error(`path escapes workspace: ${p}`);
  // A link inside the project can point elsewhere: check where the path really lands. A file that doesn't exist yet
  // lands wherever its nearest existing folder does.
  const realRoot = await realpath(root).catch(() => root);
  for (let dir = full, rest = ''; ; rest = join(basename(dir), rest), dir = dirname(dir)) {
    const real = await realpath(dir).catch(() => null);
    if (real !== null) { if (!within(realRoot, join(real, rest))) throw new Error(`path escapes workspace: ${p}`); break; }
    if (dirname(dir) === dir) break;
  }
  return full;
}

async function walk(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.isSymbolicLink()) continue; // links may lead outside
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(root, full, out);
    else out.push(relPath(root, full));
  }
  return out;
}

const MAX_SEARCH_BYTES = 2 * 1024 * 1024, MAX_READ_BYTES = 8 * 1024 * 1024;

export const toolSchemas = [
  fn('list_files', 'List every file in the workspace.', {}),
  fn('read_file', 'Read a file (at most 400 lines at a time; use offset to read further).', {
    path: { type: 'string' }, offset: { type: 'number', description: 'First line to read, 1-based. Default 1.' },
  }, ['path']),
  fn('write_file', 'Create or overwrite a file.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  fn('edit_file', 'Replace one exact string in a file. The old string must appear exactly once: include enough surrounding lines to make it unique.', {
    path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' },
  }, ['path', 'old', 'new']),
  fn('search', 'Find lines containing text across the workspace.', { text: { type: 'string' } }, ['text']),
  fn('run_command', 'Run a shell command in the workspace (needs human approval). Commands stop after 60s; for servers that keep running (npm run dev…) set background: true.', {
    command: { type: 'string' }, background: { type: 'boolean', description: 'Keep it running and return its first few seconds of output.' },
  }, ['command']),
  ...browserSchemas,
];

export async function runTool(ctx: ToolContext, name: string, args: any): Promise<string> {
  switch (name) {
    case 'list_files':
      return (await walk(ctx.root)).join('\n') || '(empty)';
    case 'read_file': {
      // Large files would flood the model's context: hand them out in pages.
      const p = await inside(ctx.root, args.path);
      const size = (await stat(p)).size;
      if (size > MAX_READ_BYTES) return `${args.path} is ${Math.round(size / 1048576)} MB, too big to read as text.`;
      const buf = await readFile(p);
      if (buf.subarray(0, 8000).includes(0)) return `${args.path} is a binary file (not text), so it can't be read here.`;
      const lines = buf.toString('utf8').split('\n');
      const from = Math.max(1, Math.floor(args.offset ?? 1)), to = Math.min(lines.length, from + 399);
      const body = lines.slice(from - 1, to).join('\n').slice(0, 40_000);
      return to < lines.length || from > 1 ? `[lines ${from}-${to} of ${lines.length}; read more with offset=${to + 1}]\n${body}` : body;
    }
    case 'write_file': {
      const p = await inside(ctx.root, args.path);
      await mkdir(dirname(p), { recursive: true });
      const before = await readFile(p, 'utf8').catch(() => '');
      await writeFile(p, args.content);
      ctx.onChange?.(args.path, before, args.content);
      return `wrote ${args.path}`;
    }
    case 'edit_file': {
      const p = await inside(ctx.root, args.path);
      const src = await readFile(p, 'utf8');
      const count = src.split(args.old).length - 1;
      if (count === 0) throw new Error('old string not found: read the file again and copy the text exactly');
      if (count > 1) throw new Error(`old string appears ${count} times: include more surrounding lines so it matches exactly once`);
      const after = src.replace(args.old, args.new);
      await writeFile(p, after);
      ctx.onChange?.(args.path, src, after);
      return `edited ${args.path}`;
    }
    case 'search': {
      // Text files only: big or binary files (images, .psd, videos) are skipped. Reading those as text froze the
      // server, so even Stop couldn't get through. It also pauses between files so other requests are served.
      const hits: string[] = [];
      let n = 0;
      for (const f of await walk(ctx.root)) {
        if (++n % 25 === 0) await new Promise((r) => setImmediate(r));
        const p = join(ctx.root, f);
        const size = await stat(p).then((s) => s.size, () => Infinity);
        if (size > MAX_SEARCH_BYTES) continue;
        const buf = await readFile(p).catch(() => null);
        if (!buf || buf.subarray(0, 8000).includes(0)) continue;
        buf.toString('utf8').split('\n').forEach((l, i) => l.includes(args.text) && hits.push(`${f}:${i + 1}: ${l.trim()}`));
        if (hits.length >= 50) break;
      }
      return hits.slice(0, 50).join('\n') || 'no matches';
    }
    case 'run_command': {
      // Thrown, not returned: a denied or failing command must show as failed, not with a green tick.
      if (!(await ctx.approve(args.command))) throw new Error('the user denied this command');
      if (args.background) return startBackground(ctx.root, args.command);
      return await new Promise((ok, fail) =>
        execFile('sh', ['-c', args.command], { cwd: ctx.root, timeout: 60_000 }, (err, stdout, stderr) => {
          const out = `${err ? `exit ${err.code ?? err.signal}\n` : ''}${stdout}${stderr}`.slice(0, 8000);
          if (err) fail(new Error(out)); else ok(out);
        }),
      );
    }
    default:
      if (BROWSER_TOOLS.has(name)) return runBrowserTool(ctx, name, args);
      throw new Error(`unknown tool ${name}`);
  }
}

function fn(name: string, description: string, properties: object, required: string[] = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

// Long-running commands (dev servers): kept alive while agent-stage runs, stopped when it exits.
const background = new Map<ChildProcess, string>(); // process → the folder it runs in
function startBackground(cwd: string, command: string): Promise<string> {
  const proc = spawn('sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  background.set(proc, cwd);
  let out = '';
  proc.stdout?.on('data', (d) => { out += d; }); proc.stderr?.on('data', (d) => { out += d; });
  return new Promise((ok) => {
    const done = (why: string) => { clearTimeout(t); ok(`${why}\n${out.slice(-4000)}`); };
    const t = setTimeout(() => done(`running in the background (pid ${proc.pid}); first output:`), 5000);
    proc.on('exit', (code) => { background.delete(proc); done(`exited with code ${code}:`); });
  });
}
// All of them, or only those started in one folder (when its thread is deleted).
export function stopBackground(root?: string) {
  for (const [p, cwd] of background) if (!root || cwd === root || cwd.startsWith(root + '/')) try { process.kill(-p.pid!, 'SIGTERM'); } catch {}
}
