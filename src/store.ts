// Local persistence in ~/.agent-stage (outside any repo): settings with API keys, and one JSON per thread.
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message, ModelConfig } from './model.ts';

export const DATA_DIR = process.env.AGENT_STAGE_HOME ?? join(homedir(), '.agent-stage');
const THREADS = join(DATA_DIR, 'threads');

export type Provider = {
  id: string; name: string; kind: 'mock' | 'openai' | 'anthropic';
  baseUrl: string; apiKey: string; model: string;
  gpuHourly?: number; tunnelHost?: string; brevInstance?: string;
};
export type Settings = {
  providers: Provider[];
  activeProvider: string;
  approval: 'always' | 'safe'; // safe = auto-approve read-only commands
  maxSteps: number;
  recentFolders: string[];
};
export type ThreadUsage = { promptTokens: number; completionTokens: number; modelMs: number; calls: number };
export type Thread = {
  id: string; title: string; folder: string; providerId: string;
  createdAt: number; updatedAt: number;
  messages: Message[]; events: any[]; usage: ThreadUsage;
};

const read = async <T>(p: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};

export async function loadSettings(env: ModelConfig & { gpuHourly: number; tunnelHost?: string; brevInstance?: string }, sandbox: string): Promise<Settings> {
  await mkdir(THREADS, { recursive: true });
  const saved = await read<Settings | null>(join(DATA_DIR, 'settings.json'), null);
  if (saved) return saved;
  // First run: seed from .env so existing setups keep working.
  const providers: Provider[] = [{ id: 'mock', name: 'Demo (scripted)', kind: 'mock', baseUrl: '', apiKey: '', model: 'mock' }];
  if (env.apiKey && env.apiKey !== 'mock') providers.push({
    id: 'env', name: env.tunnelHost ? `GPU · ${env.tunnelHost}` : 'From .env', kind: 'openai',
    baseUrl: env.baseUrl, apiKey: env.apiKey, model: env.model,
    gpuHourly: env.gpuHourly || undefined, tunnelHost: env.tunnelHost || undefined, brevInstance: env.brevInstance || undefined,
  });
  providers.push(
    { id: 'claude', name: 'Claude (Anthropic API)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-opus-5-5' },
    { id: 'nvidia', name: 'NVIDIA API', kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'nvidia/nemotron-3-super-120b-a12b' },
    { id: 'ollama', name: 'Ollama (this computer)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen3-coder:30b' },
  );
  const s: Settings = { providers, activeProvider: providers[1]?.id === 'env' ? 'env' : 'mock', approval: 'always', maxSteps: 30, recentFolders: [sandbox] };
  await saveSettings(s);
  return s;
}
export const saveSettings = (s: Settings) => writeFile(join(DATA_DIR, 'settings.json'), JSON.stringify(s, null, 2), { mode: 0o600 });

export const toConfig = (p: Provider): ModelConfig => ({ baseUrl: p.baseUrl, apiKey: p.kind === 'mock' ? 'mock' : p.apiKey, model: p.model, kind: p.kind });

// Presets offered in Settings → Models → Add.
export const PRESETS: Omit<Provider, 'id'>[] = [
  { name: 'Claude (Anthropic API)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-opus-5-5' },
  { name: 'OpenAI API', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' },
  { name: 'NVIDIA API', kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'nvidia/nemotron-3-super-120b-a12b' },
  { name: 'Ollama (this computer)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen3-coder:30b' },
  { name: 'vLLM on a GPU', kind: 'openai', baseUrl: 'http://localhost:8000/v1', apiKey: '', model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8', tunnelHost: 'agent-gpu', gpuHourly: 1.06 },
  { name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'qwen/qwen3-coder' },
];

export async function listThreads(): Promise<Thread[]> {
  const files = (await readdir(THREADS).catch(() => [])).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(files.map((f) => read<Thread | null>(join(THREADS, f), null)));
  return all.filter(Boolean).sort((a, b) => b!.updatedAt - a!.updatedAt) as Thread[];
}
export const loadThread = (id: string) => read<Thread | null>(join(THREADS, `${id}.json`), null);
export const saveThread = (t: Thread) => writeFile(join(THREADS, `${t.id}.json`), JSON.stringify(t));
export const deleteThread = (id: string) => rm(join(THREADS, `${id}.json`), { force: true });
