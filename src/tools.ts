// The agent's hands. Everything is confined to the workspace folder.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve, relative, dirname, join } from 'node:path';

export type ToolContext = {
  root: string;
  approve: (command: string) => Promise<boolean>; // UI hook: human approves shell commands
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
  fn('read_file', 'Read a file.', { path: { type: 'string' } }, ['path']),
  fn('write_file', 'Create or overwrite a file.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  fn('edit_file', 'Replace one exact string in a file.', {
    path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' },
  }, ['path', 'old', 'new']),
  fn('search', 'Find lines containing text across the workspace.', { text: { type: 'string' } }, ['text']),
  fn('run_command', 'Run a shell command in the workspace (needs human approval).', { command: { type: 'string' } }, ['command']),
];

export async function runTool(ctx: ToolContext, name: string, args: any): Promise<string> {
  switch (name) {
    case 'list_files':
      return (await walk(ctx.root)).join('\n') || '(empty)';
    case 'read_file':
      return await readFile(inside(ctx.root, args.path), 'utf8');
    case 'write_file': {
      const p = inside(ctx.root, args.path);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, args.content);
      return `wrote ${args.path}`;
    }
    case 'edit_file': {
      const p = inside(ctx.root, args.path);
      const src = await readFile(p, 'utf8');
      if (!src.includes(args.old)) throw new Error('old string not found');
      await writeFile(p, src.replace(args.old, args.new));
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
