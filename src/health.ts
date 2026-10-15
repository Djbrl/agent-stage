// Answers "can I send a prompt right now?" before the user finds out the hard way.
import { execFile } from 'node:child_process';
import type { ModelConfig } from './model.ts';
import type { TunnelState } from './tunnel.ts';

export type Health = {
  model: { state: 'ok' | 'mock' | 'unreachable' | 'auth' | 'missing' | 'error'; latencyMs?: number; detail?: string };
  gpu?: { state: 'running' | 'stopped' | 'starting' | 'missing' | 'unknown'; name: string; detail?: string };
  tunnel?: TunnelState;
  checkedAt: number;
};

export async function checkModel(cfg: ModelConfig): Promise<Health['model']> {
  if (!cfg.apiKey || cfg.apiKey === 'mock') return { state: 'mock' };
  const t0 = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - t0;
    if (res.status === 401 || res.status === 403) return { state: 'auth', latencyMs, detail: 'API key rejected' };
    if (!res.ok) return { state: 'error', latencyMs, detail: `HTTP ${res.status}` };
    const ids: string[] = ((await res.json()).data ?? []).map((m: any) => m.id);
    if (ids.length && !ids.includes(cfg.model)) return { state: 'missing', latencyMs, detail: `serving ${ids[0]}` };
    return { state: 'ok', latencyMs };
  } catch (e: any) {
    return { state: 'unreachable', detail: e.name === 'TimeoutError' ? 'timed out' : 'connection refused' };
  }
}

// GPU state via the Brev CLI (cached: the CLI is slow). Only used when BREV_INSTANCE is set.
let gpuCache: { at: number; value: Health['gpu'] } | null = null;
export async function checkGpu(name: string | undefined): Promise<Health['gpu']> {
  if (!name) return undefined;
  if (gpuCache && Date.now() - gpuCache.at < 30_000) return gpuCache.value;
  const value = await new Promise<Health['gpu']>((ok) =>
    execFile('brev', ['ls'], { timeout: 20_000 }, (err, stdout) => {
      if (err && !stdout) return ok({ state: 'unknown', name, detail: 'brev CLI unavailable' });
      const row = stdout.split('\n').find((l) => l.trim().split(/\s+/)[0] === name);
      if (!row) return ok({ state: 'missing', name, detail: 'no such instance' });
      const status = row.trim().split(/\s+/)[1]?.toUpperCase() ?? '';
      const gpu = row.trim().split(/\s+/).at(-1);
      const state = status === 'RUNNING' ? 'running' : /STOP|PAUS/.test(status) ? 'stopped' : /START|DEPLOY|CREAT/.test(status) ? 'starting' : 'unknown';
      ok({ state, name, detail: gpu });
    }),
  );
  gpuCache = { at: Date.now(), value };
  return value;
}
