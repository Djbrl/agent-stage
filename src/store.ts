// Local persistence in ~/.agent-stage (outside any repo): settings with API keys, and one JSON per thread.
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message, ModelConfig } from './model.ts';
import type { MapData } from './mapdata.ts';

export const DATA_DIR = process.env.AGENT_STAGE_HOME ?? join(homedir(), '.agent-stage');
const THREADS = join(DATA_DIR, 'threads');

export type Provider = {
  id: string; name: string; kind: 'mock' | 'openai' | 'anthropic' | 'claude-code';
  baseUrl: string; apiKey: string; model: string;
  gpuHourly?: number; tunnelHost?: string; brevInstance?: string;
  gpuTypes?: string; autoStopMin?: number; // one-click GPU: Brev types to try, destroy after N idle minutes (0 = never)
};
export type Engine = 'native' | 'claude-code';
export const engineOf = (p: Provider): Engine => (p.kind === 'claude-code' ? 'claude-code' : 'native');

export type Settings = {
  providers: Provider[];
  activeProvider: string;
  approval: 'always' | 'safe'; // safe = auto-approve read-only commands
  maxSteps: number;
  recentFolders: string[];
  insights?: 'auto' | 'on' | 'off'; // AI step labels / file summaries
  learn: { level: 'beginner' | 'intermediate' | 'advanced'; frequency: 'light' | 'normal' | 'frequent'; language: 'en' | 'fr'; ai?: 'none' | 'chat' | 'agents' };
};
export type ThreadUsage = { promptTokens: number; completionTokens: number; modelMs: number; calls: number; costUsd?: number };
export type Thread = {
  id: string; title: string; folder: string; providerId: string; mode?: 'build' | 'learn' | 'ask'; parent?: string; temp?: boolean;
  engine?: Engine; sessionId?: string; fork?: boolean; // claude-code: the SDK session to resume (fork = side thread)
  createdAt: number; updatedAt: number;
  messages: Message[]; events: any[]; usage: ThreadUsage;
  shared?: { project: string; exportedAt: number; map: MapData }; // imported from a session file: replay only
};

const read = async <T>(p: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};

export async function loadSettings(env: ModelConfig & { gpuHourly: number; tunnelHost?: string; brevInstance?: string }, sandbox: string): Promise<Settings> {
  await mkdir(THREADS, { recursive: true });
  const saved = await read<Settings | null>(join(DATA_DIR, 'settings.json'), null);
  if (saved) return { ...saved, learn: saved.learn ?? { level: 'beginner', frequency: 'normal', language: 'en' } }; // files from before Learn mode
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
  const s: Settings = { providers, activeProvider: providers[1]?.id === 'env' ? 'env' : 'mock', approval: 'always', maxSteps: 30, recentFolders: [sandbox],
    learn: { level: 'beginner', frequency: 'normal', language: 'en' } };
  await saveSettings(s);
  return s;
}
export const saveSettings = (s: Settings) => writeFile(join(DATA_DIR, 'settings.json'), JSON.stringify(s, null, 2), { mode: 0o600 });

// Claude Code providers use an Anthropic key: health checks and teaching labels talk to the same API directly.
// Anthropic list prices, $ per million tokens (input, output), October 2026. Used for spend estimates: cache hits cost
// less, so this errs high. The Claude Code engine reports its own exact cost, which is used instead when present.
const PRICES: Array<[RegExp, number, number]> = [
  [/fable|mythos/, 10, 50], [/opus-5-5/, 4, 20], [/opus/, 5, 25], [/sonnet-4/, 3, 15], [/sonnet/, 2, 10], [/haiku-5/, 0.1, 0.5], [/haiku/, 1, 5],
];
export function apiCost(p: Provider | undefined, prompt: number, completion: number) {
  if (!p || (p.kind !== 'anthropic' && p.kind !== 'claude-code')) return 0;
  const m = PRICES.find(([r]) => r.test(p.model));
  return m ? (prompt * m[1] + completion * m[2]) / 1e6 : 0;
}

// Claude models without a key in Settings use ANTHROPIC_API_KEY from .env (never in the online demo).
// In the online demo the sandbox gets a per-sandbox token instead (DEMO_CLAUDE), and the manager adds the real key.
export const keyOf = (p: Provider) => p.apiKey || ((p.kind === 'anthropic' || p.kind === 'claude-code') && (process.env.PUBLIC !== '1' || process.env.DEMO_CLAUDE === '1') ? process.env.ANTHROPIC_API_KEY ?? '' : '');
export const toConfig = (p: Provider): ModelConfig => ({ baseUrl: p.baseUrl, apiKey: p.kind === 'mock' ? 'mock' : keyOf(p), model: p.model,
  kind: p.kind === 'claude-code' ? 'anthropic' : p.kind });

// Presets offered in Settings → Models → Add.
export const PRESETS: Omit<Provider, 'id'>[] = [
  { name: 'Claude Code · Opus 5.5', kind: 'claude-code', baseUrl: '', apiKey: '', model: 'claude-opus-5-5' },
  { name: 'Claude Code · Sonnet 5.5', kind: 'claude-code', baseUrl: '', apiKey: '', model: 'claude-sonnet-5-5' },
  { name: 'Claude (Anthropic API)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-opus-5-5' },
  { name: 'OpenAI API', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' },
  { name: 'NVIDIA API', kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'nvidia/nemotron-3-super-120b-a12b' },
  { name: 'Ollama (this computer)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen3-coder:30b' },
  { name: 'My GPU (Brev + vLLM)', kind: 'openai', baseUrl: 'http://localhost:18000/v1', apiKey: '', model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8', tunnelHost: 'agent-gpu', brevInstance: 'agent-gpu', gpuHourly: 1.06, autoStopMin: 20 },
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
