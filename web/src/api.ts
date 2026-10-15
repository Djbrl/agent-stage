// Tiny fetch helpers + shared types for the settings/threads API.
export const get = <T = any>(path: string): Promise<T> => fetch(path).then((r) => r.json());
export const send = <T = any>(path: string, body?: unknown, method = 'POST'): Promise<T> =>
  fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());

export type Provider = {
  id: string; name: string; kind: 'mock' | 'openai' | 'anthropic';
  baseUrl: string; apiKey: string; model: string;
  gpuHourly?: number; tunnelHost?: string; brevInstance?: string;
};
export type Settings = { providers: Provider[]; activeProvider: string; approval: 'always' | 'safe'; maxSteps: number; recentFolders: string[] };
export type ThreadSummary = { id: string; title: string; folder: string; updatedAt: number; running: boolean; tokens: number };
export type Me = { name: string; home: string; sandbox: string };

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
export const shortPath = (p: string, home?: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
