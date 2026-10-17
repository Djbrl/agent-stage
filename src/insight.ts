// Teaching helpers that run on the same model as the agent: a plain-English label + "why" for every
// step, a one-line summary per file, and an explanation of any change. Self-hosted models bill by
// GPU time, so this is free there; on per-token APIs it's off unless the user turns it on.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chat, type ModelConfig } from './model.ts';
import { DATA_DIR, type Provider, type Settings } from './store.ts';

const CACHE = join(DATA_DIR, 'summaries');
const lang = (s: Settings) => (s.learn.language === 'fr' ? ' Answer in French.' : '');
const level = (s: Settings) => `The reader is a ${s.learn.level} programmer.`;

export function insightsOn(s: Settings, p: Provider) {
  const mode = s.insights ?? 'auto';
  if (mode !== 'auto') return mode === 'on';
  if (p.kind === 'mock') return true;
  return Boolean(p.gpuHourly || p.tunnelHost || /localhost|127\.0\.0\.1/.test(p.baseUrl)); // free to run
}

async function ask(cfg: ModelConfig, system: string, user: string) {
  const r = await chat(cfg, [{ role: 'system', content: system }, { role: 'user', content: user }], []);
  return (r.content ?? '').trim();
}

// One job at a time, newest first, so labels never slow the agent down.
const queue: Array<() => Promise<void>> = [];
let busy = false;
export function enqueue(job: () => Promise<void>) {
  queue.unshift(job);
  if (queue.length > 20) queue.length = 20;
  void pump();
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) await queue.shift()!().catch(() => {});
  busy = false;
}

export async function labelStep(cfg: ModelConfig, s: Settings, step: { name: string; args: any; output: string; ok: boolean; task: string }) {
  if (cfg.kind === 'mock' || cfg.apiKey === 'mock') return mockLabel(step, s);
  const text = await ask(cfg,
    `You label steps of a coding agent for a learner. ${level(s)} Reply with exactly two lines:\nLABEL: <max 8 words, plain English, no file extensions jargon>\nWHY: <one short sentence: why an engineer would take this step now>${lang(s)}`,
    `Task: ${step.task.slice(0, 300)}\nTool: ${step.name}\nArguments: ${JSON.stringify(step.args).slice(0, 600)}\nResult${step.ok ? '' : ' (FAILED)'}: ${step.output.slice(0, 600)}`);
  return { label: text.match(/LABEL:\s*(.+)/i)?.[1]?.trim() ?? text.split('\n')[0], why: text.match(/WHY:\s*(.+)/i)?.[1]?.trim() ?? '' };
}

export async function summarizeFile(cfg: ModelConfig, s: Settings, root: string, path: string) {
  const full = join(root, path);
  const st = await stat(full);
  const key = createHash('sha1').update(`${full}:${st.mtimeMs}:${s.learn.language}:${s.learn.level}`).digest('hex');
  await mkdir(CACHE, { recursive: true });
  const cached = await readFile(join(CACHE, `${key}.txt`), 'utf8').catch(() => null);
  if (cached) return cached;
  const code = (await readFile(full, 'utf8')).split('\n').slice(0, 200).join('\n');
  const summary = cfg.kind === 'mock' || cfg.apiKey === 'mock'
    ? `${path.split('/').pop()}: ${code.split('\n').length} lines. ${/export/.test(code) ? 'Defines code other files import.' : 'Standalone file.'}`
    : await ask(cfg, `Summarize what a source file is FOR in one sentence (max 25 words), for a learner. ${level(s)}${lang(s)}`, `File: ${path}\n\n${code}`);
  await writeFile(join(CACHE, `${key}.txt`), summary);
  return summary;
}

export async function explainChange(cfg: ModelConfig, s: Settings, path: string, before: string, after: string) {
  if (cfg.kind === 'mock' || cfg.apiKey === 'mock') {
    return `✦ Concept: what changed\n\nThe agent changed **${path}**: ${after.split('\n').length - before.split('\n').length} net lines. A real model would walk through each change here and the idea behind it.`;
  }
  return ask(cfg,
    `You explain a code change to a learner. ${level(s)} Use short paragraphs. Start with what the change does, then walk through the important lines, then name the main concept as a paragraph starting "✦ Concept: <name>". Max 180 words.${lang(s)}`,
    `File: ${path}\n--- before ---\n${before.slice(0, 4000)}\n--- after ---\n${after.slice(0, 4000)}`);
}

// A commit message for a task the user decided to keep: what changed and why, from the task and its diff.
export async function commitMessage(cfg: ModelConfig, task: string, diff: string) {
  const fallback = `agent-stage: ${task.split('\n')[0].slice(0, 60)}`;
  if (cfg.kind === 'mock' || cfg.apiKey === 'mock') return fallback;
  const text = await ask(cfg,
    'Write a git commit message for this change. First line: what it does, imperative mood, at most 65 characters, no period. Then a blank line and 1-3 short lines on why, only if useful. Plain text, no quotes, no markdown fences.',
    `Task the user gave: ${task.slice(0, 600)}\n\nDiff:\n${diff.slice(0, 12_000)}`).catch(() => '');
  return text.replace(/^```\w*\n?|```$/g, '').trim() || fallback;
}

function mockLabel(step: { name: string; args: any; ok: boolean }, s: Settings) {
  const fr = s.learn.language === 'fr';
  const f = step.args?.path ?? '';
  const t: Record<string, [string, string]> = fr ? {
    list_files: ['Faire le tour du projet', "On regarde ce qui existe avant de toucher à quoi que ce soit."],
    read_file: [`Lire ${f}`, 'Comprendre le code existant avant de le modifier.'],
    write_file: [`Créer ${f}`, 'Ajouter le nouveau morceau de code dont la tâche a besoin.'],
    edit_file: [`Modifier ${f}`, 'Un petit changement ciblé est plus sûr que tout réécrire.'],
    search: ['Chercher dans le code', 'Trouver où une fonction est utilisée avant de la changer.'],
    run_command: ['Lancer le programme', 'Vérifier que le code marche vraiment.'],
    checkpoint: ['Demander ton accord', "L'agent attend ta décision avant d'écrire du code."],
  } : {
    list_files: ['Look around the project', 'See what exists before touching anything.'],
    read_file: [`Read ${f}`, 'Understand the existing code before changing it.'],
    write_file: [`Create ${f}`, 'Add the new piece of code the task needs.'],
    edit_file: [`Change ${f}`, 'A small, targeted edit is safer than rewriting the file.'],
    search: ['Search the code', 'Find where something is used before changing it.'],
    run_command: ['Run the program', 'Check that the code actually works.'],
    checkpoint: ['Ask for your decision', 'The agent waits for you before writing code.'],
  };
  const [label, why] = t[step.name] ?? [step.name, ''];
  return { label: step.ok ? label : `${label} (failed)`, why: step.ok ? why : (fr ? "Ça n'a pas marché : l'agent va devoir s'adapter." : "It didn't work, so the agent has to adapt.") };
}
