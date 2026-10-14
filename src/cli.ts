// Day-1 harness: run the agent from the terminal to test models before the visual UI exists.
// Usage: node --env-file=.env src/cli.ts <workspace-dir> "<task>"
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Agent } from './agent.ts';
import { configFromEnv } from './model.ts';

const [dir = 'workspace', ...rest] = process.argv.slice(2);
const task = rest.join(' ') || 'Create hello.js that prints a greeting, then run it.';
const root = resolve(dir);
await mkdir(root, { recursive: true });
const rl = createInterface({ input: process.stdin, output: process.stdout });

const agent = new Agent(configFromEnv(), {
  root,
  approve: async (cmd) => (await rl.question(`\n  run \`${cmd}\`? [y/N] `)).trim().toLowerCase() === 'y',
}, (e) => {
  if (e.type === 'tool_start') console.log(`→ ${e.name} ${JSON.stringify(e.args).slice(0, 120)}`);
  if (e.type === 'tool_end') console.log(`  ${e.ok ? '✓' : '✗'} ${e.output.split('\n')[0].slice(0, 120)}`);
  if (e.type === 'thinking') console.log(`… ${e.text}`);
  if (e.type === 'done') console.log(`\n✔ ${e.text}`);
  if (e.type === 'error') console.log(`\n✗ ${e.message}`);
});

process.on('SIGINT', () => agent.stop());
await agent.run(task);
rl.close();
