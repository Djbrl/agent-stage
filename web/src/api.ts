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
};
export type Settings = { providers: Provider[]; activeProvider: string; approval: 'always' | 'safe'; maxSteps: number; recentFolders: string[];
  insights?: 'auto' | 'on' | 'off'; learn: { level: 'beginner' | 'intermediate' | 'advanced'; frequency: 'light' | 'normal' | 'frequent'; language: 'en' | 'fr' } };
export type ThreadSummary = { id: string; title: string; folder: string; updatedAt: number; running: boolean; tokens: number; engine?: Engine; shared?: boolean };
export type Me = { name: string; home: string; sandbox: string; public?: boolean; internet?: boolean; samples?: string[] };

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
// A folder's own name from a full path, on macOS, Linux and Windows alike.
export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const shortPath =(p: string, home?: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

export type Engine = 'native' | 'claude-code';
export const engineOf = (p: Provider): Engine => (p.kind === 'claude-code' ? 'claude-code' : 'native');
export const ENGINE_LABEL: Record<Engine | 'codex', string> = { native: 'agent-stage', 'claude-code': 'Claude Code', codex: 'Codex' };
export type EngineStatus = Record<Engine | 'codex', { ready: boolean; reason?: string }>;
