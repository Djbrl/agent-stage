// The agent's hands. Everything is confined to the workspace folder.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve, relative, dirname, join } from 'node:path';

export type ToolContext = {
  root: string;
  approve: (command: string) => Promise<boolean>; // UI hook: human approves shell commands
  onChange?: (path: string, before: string, after: string) => void; // feeds the diff view
};

function inside(root: string, p: string): string {
  const full = resolve(root, p);
  if (relative(root, full).startsWith('..')) throw new Error(`path escapes workspace: ${p}`);
  return full;
}

async function walk(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

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
  fn('run_command', 'Run a shell command in the workspace (needs human approval).', { command: { type: 'string' } }, ['command']),
];

export async function runTool(ctx: ToolContext, name: string, args: any): Promise<string> {
  switch (name) {
    case 'list_files':
      return (await walk(ctx.root)).join('\n') || '(empty)';
    case 'read_file': {
      // Large files would flood the model's context: hand them out in pages.
      const lines = (await readFile(inside(ctx.root, args.path), 'utf8')).split('\n');
      const from = Math.max(1, Math.floor(args.offset ?? 1)), to = Math.min(lines.length, from + 399);
      const body = lines.slice(from - 1, to).join('\n').slice(0, 40_000);
      return to < lines.length || from > 1 ? `[lines ${from}-${to} of ${lines.length}; read more with offset=${to + 1}]\n${body}` : body;
    }
    case 'write_file': {
      const p = inside(ctx.root, args.path);
      await mkdir(dirname(p), { recursive: true });
      const before = await readFile(p, 'utf8').catch(() => '');
      await writeFile(p, args.content);
      ctx.onChange?.(args.path, before, args.content);
      return `wrote ${args.path}`;
    }
    case 'edit_file': {
      const p = inside(ctx.root, args.path);
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
      const hits: string[] = [];
      for (const f of await walk(ctx.root)) {
        const lines = (await readFile(join(ctx.root, f), 'utf8')).split('\n');
        lines.forEach((l, i) => l.includes(args.text) && hits.push(`${f}:${i + 1}: ${l.trim()}`));
      }
      return hits.slice(0, 50).join('\n') || 'no matches';
    }
    case 'run_command': {
      if (!(await ctx.approve(args.command))) return 'user denied this command';
      return await new Promise((ok) =>
        execFile('sh', ['-c', args.command], { cwd: ctx.root, timeout: 60_000 }, (err, stdout, stderr) =>
          ok(`${err ? `exit ${err.code}\n` : ''}${stdout}${stderr}`.slice(0, 8000))),
      );
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function fn(name: string, description: string, properties: object, required: string[] = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
