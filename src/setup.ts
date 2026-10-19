// Setting up an agent: check what it needs on this computer, and install open models with Ollama.
// Ollama pulls run in the background; the UI polls their progress.
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { OLLAMA_URL, type Recipe } from './store.ts';

export type Check = { id: string; ok: boolean; label: string; fix?: string; link?: string };

const has = (bin: string) => new Promise<boolean>((ok) => execFile('/bin/sh', ['-c', `command -v ${bin}`], (e) => ok(!e)));
const exits0 = (bin: string, args: string[], timeout = 20_000) => new Promise<boolean>((ok) => execFile(bin, args, { timeout }, (e) => ok(!e)));
const ollamaUp = () => fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

export async function checks(recipe: Recipe): Promise<Check[]> {
  if (recipe === 'ollama') {
    const up = await ollamaUp();
    const installed = up || (await has('ollama')) || (process.platform === 'darwin' && await access('/Applications/Ollama.app').then(() => true, () => false));
    return [
      { id: 'installed', ok: installed, label: 'Ollama is installed', fix: 'Download it from ollama.com and open it once.', link: 'https://ollama.com/download' },
      { id: 'running', ok: up, label: 'Ollama is running', fix: installed ? 'Open the Ollama app (or run “ollama serve”), then check again.' : undefined },
    ];
  }
  if (recipe === 'gpu') {
    const bin = process.env.BREV_BIN ?? 'brev';
    const cli = await has(bin);
    const login = cli && await exits0(bin, ['ls', '--json']);
    const ssh = await has('ssh');
    return [
      { id: 'brev', ok: cli, label: 'The Brev command-line tool is installed', fix: 'Install it from brev.dev, then check again.', link: 'https://docs.nvidia.com/brev/latest/brev-cli.html' },
      { id: 'login', ok: login, label: 'You’re logged in to Brev', fix: cli ? 'Run “brev login” in a terminal, then check again.' : undefined },
      { id: 'ssh', ok: ssh, label: 'ssh is available', fix: 'Install an OpenSSH client.' },
    ];
  }
  return [];
}

// Model names Ollama accepts: library names (qwen3-coder:30b) or Hugging Face GGUF repos (hf.co/user/repo:Q4_K_M).
export const validModel = (m: string) => /^[\w.\-]+(\/[\w.\-]+)*(:[\w.\-]+)?$/.test(m) && m.length <= 200;

export async function ollamaModels(): Promise<string[]> {
  const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!r?.ok) return [];
  const j = await r.json() as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}

type Pull = { model: string; state: 'pulling' | 'done' | 'error'; status: string; completed: number; total: number; error?: string };
const pulls = new Map<string, Pull>();
export const pullState = (model: string) => pulls.get(model) ?? null;

export function startPull(model: string): Pull {
  const cur = pulls.get(model);
  if (cur?.state === 'pulling') return cur;
  const job: Pull = { model, state: 'pulling', status: 'Starting', completed: 0, total: 0 };
  pulls.set(model, job);
  void (async () => {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
      if (!r.ok || !r.body) throw new Error(`Ollama answered ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const m = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
          if (m.error) throw new Error(m.error);
          if (m.status) job.status = m.status;
          if (m.total) { job.total = m.total; job.completed = m.completed ?? 0; }
          if (m.status === 'success') job.state = 'done';
        }
      }
      if (job.state !== 'done') {
        if ((await ollamaModels()).some((n) => n === model || n === `${model}:latest`)) job.state = 'done';
        else throw new Error('The download stopped before it finished.');
      }
    } catch (e: any) {
      job.state = 'error';
      job.error = /file does not exist|not found/i.test(e.message) ? 'Ollama can’t find that model. Check the name on ollama.com/library.' : e.message;
    }
  })();
  return job;
}
