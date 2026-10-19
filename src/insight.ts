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
    ? (s.learn.language === 'fr'
      ? `${path.split('/').pop()} : ${code.split('\n').length} lignes. ${/export/.test(code) ? 'Définit du code que d’autres fichiers importent.' : 'Fichier autonome.'}`
      : `${path.split('/').pop()}: ${code.split('\n').length} lines. ${/export/.test(code) ? 'Defines code other files import.' : 'Standalone file.'}`)
    : await ask(cfg, `Summarize what a source file is FOR in one sentence (max 25 words), for a learner. ${level(s)}${lang(s)}`, `File: ${path}\n\n${code}`);
  await writeFile(join(CACHE, `${key}.txt`), summary);
  return summary;
}

export async function explainChange(cfg: ModelConfig, s: Settings, path: string, before: string, after: string) {
  if (cfg.kind === 'mock' || cfg.apiKey === 'mock') {
    const n = after.split('\n').length - before.split('\n').length;
    return s.learn.language === 'fr'
      ? `✦ Concept: ce qui a changé\n\nL’agent a modifié **${path}** : ${n} lignes de plus au total. Un vrai modèle expliquerait ici chaque changement et l’idée derrière.`
      : `✦ Concept: what changed\n\nThe agent changed **${path}**: ${n} net lines. A real model would walk through each change here and the idea behind it.`;
  }
  return ask(cfg,
    `You explain a code change to a learner. ${level(s)} Use short paragraphs. Start with what the change does, then walk through the important lines, then name the main concept as a paragraph starting "✦ Concept: <name>". Max 180 words.${lang(s)}`,
    `File: ${path}\n--- before ---\n${before.slice(0, 4000)}\n--- after ---\n${after.slice(0, 4000)}`);
}

// Compact: the thread so far in a few lines, so the agent can carry on without the full transcript.
export async function summarizeThread(cfg: ModelConfig, transcript: string) {
  if (cfg.kind === 'mock' || cfg.apiKey === 'mock') return transcript.slice(-1500);
  return ask(cfg, 'Summarize this coding session so an agent can continue it: the goal, decisions made, files changed and why, what was checked, and what is still open. Plain bullet points, at most 200 words.',
    transcript.slice(-30_000));
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

// "What you learned": after a finished task, 2-3 concepts tied to what was actually done, plus one small
// exercise the learner can try by hand. Strict JSON; anything malformed means no card (null).
export type Learned = { concepts: { name: string; line: string }[]; exercise: string };
export type TaskRecap = { task: string; files: string[]; commands: string[]; result: string };

export async function learnedFromTask(cfg: ModelConfig, s: Settings, r: TaskRecap): Promise<Learned | null> {
  if (cfg.kind === 'mock' || cfg.apiKey === 'mock') return mockLearned(r, s);
  const text = await ask(cfg,
    `You help a learner remember what they just watched a coding agent do. ${level(s)} Reply with JSON only, no markdown fence:
{"concepts":[{"name":"<2-4 words>","line":"<one plain sentence, max 22 words, tied to this task: name the file, command or decision>"}],"exercise":"<one or two sentences: a small change the learner can make by hand to this same code to practise one of the concepts>"}
Give 2 or 3 concepts: the programming ideas behind the work, not a list of steps. Plain words; explain any jargon in a few words.${lang(s)}`,
    `Task: ${r.task.slice(0, 600)}\nFiles changed: ${r.files.slice(0, 12).join(', ') || 'none'}\nCommands run: ${r.commands.slice(0, 8).join(' | ') || 'none'}\nAgent's final message: ${r.result.slice(0, 1500)}`);
  return parseLearned(text);
}

export function parseLearned(text: string): Learned | null {
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const concepts = (Array.isArray(j.concepts) ? j.concepts : [])
      .filter((c: any) => typeof c?.name === 'string' && typeof c?.line === 'string' && c.name.trim())
      .slice(0, 3).map((c: any) => ({ name: c.name.trim().slice(0, 60), line: c.line.trim().slice(0, 240) }));
    const exercise = typeof j.exercise === 'string' ? j.exercise.trim().slice(0, 400) : '';
    return concepts.length ? { concepts, exercise } : null;
  } catch { return null; }
}

function mockLearned(r: TaskRecap, s: Settings): Learned {
  const fr = s.learn.language === 'fr';
  if (r.files.some((f) => f.endsWith('.html'))) return fr ? {
    concepts: [
      { name: 'Formulaire HTML', line: 'index.html utilise un <form> : la touche Entrée et le bouton lancent le même code.' },
      { name: 'Serveur local', line: "python3 -m http.server sert le dossier pour qu'un navigateur puisse ouvrir la page." },
      { name: 'Valeur par défaut', line: 'Si le champ est vide, la page dit « stranger » au lieu de laisser un trou.' },
    ],
    exercise: "Ajoute un bouton « Effacer » dans index.html qui vide le champ et le message, puis demande à l'agent de vérifier.",
  } : {
    concepts: [
      { name: 'HTML form', line: 'index.html uses a <form>, so pressing Enter and clicking the button run the same code.' },
      { name: 'Local server', line: 'python3 -m http.server serves the folder so a browser can open the page.' },
      { name: 'Fallback value', line: 'An empty name falls back to "stranger" instead of leaving a gap.' },
    ],
    exercise: 'Add a "Clear" button to index.html that empties the field and the message, then ask the agent to check it.',
  };
  return fr ? {
    concepts: [
      { name: 'Module', line: 'src/greet.js exporte greet() et index.js l’importe : la logique et l’affichage restent séparés.' },
      { name: 'Valeur par défaut', line: 'Un nom vide donne « Hello, stranger! » au lieu de « Hello, ! ».' },
      { name: 'Test automatique', line: 'test.js vérifie greet() à chaque lancement, donc une erreur se voit tout de suite.' },
    ],
    exercise: 'Ajoute une option de langue à greet() pour que greet("Dakar", "fr") renvoie « Bonjour, Dakar ! », avec un test dans test.js.',
  } : {
    concepts: [
      { name: 'Module', line: 'src/greet.js exports greet() and index.js imports it, so the logic and the printing stay apart.' },
      { name: 'Fallback value', line: 'An empty name gives "Hello, stranger!" instead of "Hello, !".' },
      { name: 'Automated test', line: 'test.js checks greet() on every run, so a mistake shows up at once.' },
    ],
    exercise: 'Give greet() a language option so greet("Dakar", "fr") returns "Bonjour, Dakar !", and add a test for it in test.js.',
  };
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
