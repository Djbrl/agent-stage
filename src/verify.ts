// The done-check: when the agent says it's finished, the harness checks instead of taking its word for it.
// It runs the project's own check (tests, else typecheck/build). If that fails, the failure goes back to the
// agent with "not done yet" and the loop continues. No check available → one nudge to test its own work.
import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { ToolContext } from './tools.ts';

export const MAX_CHECKS = 3; // failed checks before we stop and hand it to the human

const exists = (p: string) => access(p).then(() => true, () => false);

// The command that tells us whether the project works, or null if we can't tell.
export async function findCheck(root: string): Promise<string | null> {
  const pkg = await readFile(join(root, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
  const s = pkg?.scripts ?? {};
  if (s.test && !/no test specified/.test(s.test)) return 'npm test --silent';
  for (const k of ['typecheck', 'check', 'build']) if (s[k]) return `npm run ${k} --silent`;
  if (await exists(join(root, 'pyproject.toml')) || await exists(join(root, 'pytest.ini')) || await exists(join(root, 'tests'))) return 'python3 -m pytest -q';
  if (await exists(join(root, 'Cargo.toml'))) return 'cargo test -q';
  if (await exists(join(root, 'go.mod'))) return 'go test ./...';
  return null;
}

// `missing`: the check couldn't run at all (the test tool isn't installed), which says nothing about the code.
export function runCheck(root: string, command: string): Promise<{ ok: boolean; missing: boolean; output: string }> {
  return new Promise((done) => execFile('sh', ['-c', command], { cwd: root, timeout: 180_000, maxBuffer: 8 << 20, env: { ...process.env, CI: '1' } },
    (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim().slice(-4000) || (err ? `exit ${err.code}` : 'ok');
      done({ ok: !err, missing: Boolean(err) && (err!.code === 127 || /No module named pytest\b/.test(output)), output });
    }));
}

export const failedMessage = (command: string, output: string, left: number) =>
  `The harness ran \`${command}\` to check your work and it failed:\n\n${output}\n\nYou are not done yet. Fix the cause in the code, then finish again. Don't weaken, skip or delete tests to make the check pass.${left <= 1 ? ' This is the last automatic check.' : ''}`;

export const NUDGE = 'Before you finish: you changed files but did not run or test anything. If there is a way to check it (run it, or open it in the browser), do that now, then finish with your summary.';

export type RunState = { wrote: boolean; tested: boolean; nudged: boolean; checks: number; gaveUp?: string };
export const newRun = (): RunState => ({ wrote: false, tested: false, nudged: false, checks: 0 });
type Emit = (e: { type: 'verify'; id: string; state: 'running' | 'pass' | 'fail' | 'nudge' | 'declined' | 'unavailable'; command?: string; output?: string }) => void;

// Returns what to tell the agent if it isn't really done, or null to accept "done". Used by both engines.
export async function doneCheck(ctx: ToolContext, emit: Emit, run: RunState, approved: Set<string>): Promise<string | null> {
  const id = crypto.randomUUID();
  const command = await findCheck(ctx.root);
  if (!command) {
    if (run.tested || run.nudged) return null;
    run.nudged = true;
    emit({ type: 'verify', id, state: 'nudge' });
    return NUDGE;
  }
  if (run.checks >= MAX_CHECKS) return null;
  if (!approved.has(command)) {
    if (!(await ctx.approve(command))) { emit({ type: 'verify', id, state: 'declined', command }); return null; }
    approved.add(command); // once per thread: retries shouldn't ask again
  }
  emit({ type: 'verify', id, state: 'running', command });
  const r = await runCheck(ctx.root, command);
  // A missing tool isn't the agent's fault: sending it back only makes it install things or rewrite the tests.
  emit({ type: 'verify', id, state: r.ok ? 'pass' : r.missing ? 'unavailable' : 'fail', command, output: r.output });
  if (r.ok || r.missing) return null;
  run.checks++;
  if (run.checks >= MAX_CHECKS) { run.gaveUp = command; return null; }
  return failedMessage(command, r.output, MAX_CHECKS - run.checks);
}

export const gaveUpNote = (run: RunState) => (run.gaveUp ? `\n\n> ⚠ \`${run.gaveUp}\` still fails after ${MAX_CHECKS} tries. Over to you.` : '');
