// Polls /api/health so the UI always knows whether a prompt would actually reach the model.
import { useEffect, useState } from 'react';
import { tr } from './i18n';

export type HealthView = {
  model: { state: 'checking' | 'ok' | 'mock' | 'unreachable' | 'auth' | 'missing' | 'error'; latencyMs?: number; detail?: string; name: string; mock: boolean };
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
export function diagnose(h: HealthView | null, serverDown: boolean, fr = false): string | null {
  const t = tr(fr);
  if (serverDown) return t('The agent-stage server isn’t answering. Start it again with npm start, then reload this page.', 'Le serveur agent-stage ne répond pas. Relance-le avec npm start, puis recharge la page.');
  if (!h) return null;
  const m = h.model.state;
  if (m === 'ok' || m === 'mock' || m === 'checking') return null;
  if (h.gpu && h.gpu.state === 'missing') return t(`The GPU machine “${h.gpu.name}” doesn’t exist. Create it, then run serve-vllm.sh on it.`, `La machine GPU « ${h.gpu.name} » n’existe pas. Crée-la, puis lance serve-vllm.sh dessus.`);
  if (h.gpu && h.gpu.state === 'stopped') return t(`The GPU “${h.gpu.name}” is off. Start it (brev start ${h.gpu.name}), then run serve-vllm.sh.`, `Le GPU « ${h.gpu.name} » est éteint. Démarre-le (brev start ${h.gpu.name}), puis lance serve-vllm.sh.`);
  if (h.gpu && h.gpu.state === 'starting') return t('The GPU is starting. The model will be ready a few minutes after.', 'Le GPU démarre. Le modèle sera prêt quelques minutes après.');
  if (h.tunnel && !h.tunnel.up) return t(`Lost the link to ${h.tunnel.host}, reconnecting… ${h.tunnel.lastError ?? ''}`, `Lien perdu avec ${h.tunnel.host}, reconnexion… ${h.tunnel.lastError ?? ''}`);
  if (m === 'auth') return /no API key/.test(h.model.detail ?? '')
    ? t('This model has no API key yet. Add it in Settings → Models (Claude models also read ANTHROPIC_API_KEY from .env after a restart).', 'Ce modèle n’a pas encore de clé API. Ajoute-la dans Réglages → Modèles (les modèles Claude lisent aussi ANTHROPIC_API_KEY dans .env après un redémarrage).')
    : t('The model refused the API key. Check it in Settings → Models.', 'Le modèle a refusé la clé API. Vérifie-la dans Réglages → Modèles.');
  if (m === 'missing') return t(`The model server is up but ${h.model.detail}, not ${h.model.name}. Fix MODEL_NAME in .env.`, `Le serveur du modèle répond, mais ${h.model.detail}, pas ${h.model.name}. Corrige MODEL_NAME dans .env.`);
  if (m === 'unreachable') return h.gpu?.state === 'running'
    ? t('The GPU is on but the model isn’t answering yet: it may still be loading, or vLLM isn’t running (serve-vllm.sh).', 'Le GPU est allumé mais le modèle ne répond pas encore : il charge peut-être, ou vLLM ne tourne pas (serve-vllm.sh).')
    : t(`Can’t reach the model${h.model.detail ? ` (${h.model.detail})` : ''}. Check its address in Settings → Models.`, `Impossible de joindre le modèle${h.model.detail ? ` (${h.model.detail})` : ''}. Vérifie son adresse dans Réglages → Modèles.`);
  return t(`The model ran into a problem: ${h.model.detail}`, `Le modèle a eu un problème : ${h.model.detail}`);
}
