// Polls /api/health so the UI always knows whether a prompt would actually reach the model.
import { useEffect, useState } from 'react';

export type HealthView = {
  model: { state: 'ok' | 'mock' | 'unreachable' | 'auth' | 'missing' | 'error'; latencyMs?: number; detail?: string; name: string; mock: boolean };
  gpu?: { state: 'running' | 'stopped' | 'starting' | 'missing' | 'unknown'; name: string; detail?: string };
  tunnel?: { up: boolean; external?: boolean; host?: string; restarts: number; lastError?: string };
  usage: { tokens: number; promptTokens: number; completionTokens: number; calls: number; tokensPerSec: number; gpuHourly: number; gpuCost: number; perMillion: number | null };
  checkedAt: number;
};

export function useHealth() {
  const [h, setH] = useState<HealthView | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const load = (now = false) =>
    fetch(`/api/health${now ? '?now=1' : ''}`).then((r) => r.json()).then((x) => { setH(x); setServerDown(false); })
      .catch(() => setServerDown(true));
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return { health: h, serverDown, recheck: () => load(true) };
}

// One sentence: what's wrong and what to do. null = ready to go.
export function diagnose(h: HealthView | null, serverDown: boolean): string | null {
  if (serverDown) return 'The agent-stage server is not responding. Restart it with npm start.';
  if (!h) return null;
  const m = h.model.state;
  if (m === 'ok' || m === 'mock') return null;
  if (h.gpu && h.gpu.state === 'missing') return `GPU instance “${h.gpu.name}” doesn't exist. Create it, then run serve-vllm.sh on it.`;
  if (h.gpu && h.gpu.state === 'stopped') return `GPU “${h.gpu.name}” is off. Start it (brev start ${h.gpu.name}), then run serve-vllm.sh.`;
  if (h.gpu && h.gpu.state === 'starting') return 'GPU is booting. The model will come up a few minutes after.';
  if (h.tunnel && !h.tunnel.up) return `Tunnel to ${h.tunnel.host} is down, reconnecting… ${h.tunnel.lastError ?? ''}`;
  if (m === 'auth') return /no API key/.test(h.model.detail ?? '')
    ? 'This model has no API key yet. Add it in Settings → Engines & models (Claude models also read ANTHROPIC_API_KEY from .env after a restart).'
    : 'The model server rejected the API key. Check it in Settings → Engines & models.';
  if (m === 'missing') return `The server is up but ${h.model.detail}, not ${h.model.name}. Fix MODEL_NAME in .env.`;
  if (m === 'unreachable') return h.gpu?.state === 'running'
    ? 'GPU is on but the model isn\'t answering: it may still be loading, or vLLM isn\'t running (serve-vllm.sh).'
    : `Can't reach the model endpoint (${h.model.detail}).`;
  return `Model error: ${h.model.detail}`;
}
