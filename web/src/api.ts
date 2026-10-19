// Tiny fetch helpers + shared types for the settings/threads API.
export const get = <T = any>(path: string): Promise<T> => fetch(path).then((r) => r.json());
export const send = <T = any>(path: string, body?: unknown, method = 'POST'): Promise<T> =>
  fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    // An error body must never be mistaken for the data (it once replaced the settings and blanked the app).
    if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
    return data;
  });

export type Provider = {
  id: string; name: string; kind: 'mock' | 'openai' | 'anthropic' | 'claude-code';
  baseUrl: string; apiKey: string; model: string;
  gpuHourly?: number; tunnelHost?: string; brevInstance?: string; gpuTypes?: string; autoStopMin?: number;
  recipe?: Recipe; builtin?: boolean; installed?: boolean;
};
// How an agent is set up (src/store.ts has the same list).
export type Recipe = 'demo' | 'claude' | 'claude-code' | 'nvidia' | 'gpu' | 'ollama' | 'openai';
export const recipeOf = (p: Provider): Recipe => p.recipe ?? (p.kind === 'mock' ? 'demo' : p.kind === 'anthropic' ? 'claude' : p.kind === 'claude-code' ? 'claude-code'
  : p.tunnelHost || p.brevInstance ? 'gpu' : /:11434\b/.test(p.baseUrl) ? 'ollama' : /integrate\.api\.nvidia\.com/.test(p.baseUrl) ? 'nvidia' : 'openai');
// Ready to run: set up with whatever its recipe needs. Ollama counts once its model was downloaded here.
export function isReady(p: Provider) {
  const r = recipeOf(p);
  if (r === 'demo') return true;
  if (r === 'ollama') return Boolean(p.installed);
  if (r === 'gpu') return Boolean(p.installed || p.apiKey) && Boolean(p.brevInstance);
  return Boolean(p.apiKey) && Boolean(p.model);
}
export type Settings = { providers: Provider[]; activeProvider: string; approval: 'always' | 'safe'; maxSteps: number; recentFolders: string[];
  insights?: 'auto' | 'on' | 'off'; learn: { level: 'beginner' | 'intermediate' | 'advanced'; frequency: 'light' | 'normal' | 'frequent'; language: 'en' | 'fr'; ai?: 'none' | 'chat' | 'agents' } };
export type ThreadSummary = { id: string; title: string; folder: string; updatedAt: number; running: boolean; tokens: number; engine?: Engine; shared?: boolean };
export type Me = { name: string; home: string; sandbox: string; public?: boolean; internet?: boolean; samples?: string[] };

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export function ago(t: number, fr = false) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return fr ? 'à l’instant' : 'now';
  if (s < 3600) return `${Math.round(s / 60)}${fr ? ' min' : 'm'}`;
  if (s < 86400) return `${Math.round(s / 3600)}${fr ? ' h' : 'h'}`;
  return `${Math.round(s / 86400)}${fr ? ' j' : 'd'}`;
}
// A folder's own name from a full path, on macOS, Linux and Windows alike.
export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const shortPath =(p: string, home?: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

// Online demo: leave it. The demo manager deletes the sandbox and sends the visitor back to the landing page.
export function leaveDemo() {
  const f = Object.assign(document.createElement('form'), { method: 'POST', action: '/__leave' });
  document.body.append(f);
  f.submit();
}

export type Engine = 'native' | 'claude-code';
export const engineOf = (p: Provider): Engine => (p.kind === 'claude-code' ? 'claude-code' : 'native');
// Which agent runs the model: ours, or Claude Code (through the Agent SDK).
export const agentName = (e: Engine, fr: boolean) => (e === 'native' ? (fr ? 'Agent de Codetandem' : 'Codetandem’s agent') : (fr ? 'Agent Claude Code' : 'Claude Code agent'));
export type EngineStatus = Record<Engine | 'codex', { ready: boolean; reason?: string }>;
