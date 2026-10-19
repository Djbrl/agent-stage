// Header chips: model, GPU, tunnel, throughput, cost. Each dot is green / amber / red at a glance.
import type { HealthView } from './useHealth';
import { useT } from './i18n';

type Tone = 'ok' | 'warn' | 'bad' | 'off';
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function Chip({ tone, label, value, title }: { tone: Tone; label: string; value: string; title?: string }) {
  return (
    <span className="schip" title={title}>
      <span className={`sdot ${tone}`} />
      <span className="slabel">{label}</span>
      <span className="svalue">{value}</span>
    </span>
  );
}

export function StatusBar({ health, serverDown, onRecheck, gpuOff }: { health: HealthView | null; serverDown: boolean; onRecheck: () => void; gpuOff?: boolean }) {
  const t = useT();
  if (serverDown) return <div className="statusbar"><Chip tone="bad" label={t('Server', 'Serveur')} value={t('not answering', 'ne répond pas')} /></div>;
  if (!health) return <div className="statusbar"><Chip tone="off" label={t('Status', 'État')} value={t('checking…', 'vérification…')} /></div>;
  const { model, gpu, tunnel, usage } = health;
  const short = model.name.split('/').pop()!.replace(/-Instruct.*$/i, '');

  const modelTone: Tone = model.state === 'ok' ? 'ok' : model.state === 'mock' ? 'off' : 'bad';
  const modelValue = model.state === 'ok' ? `${short} · ${model.latencyMs}ms`
    : model.state === 'mock' ? t('demo (no key)', 'démo (sans clé)') : { checking: t('checking…', 'vérification…'), unreachable: t('not answering', 'ne répond pas'), auth: t('key refused', 'clé refusée'), missing: t('wrong model', 'mauvais modèle'), error: t('problem', 'problème') }[model.state];

  // GPU switched off on purpose: nothing is broken and nothing is billing, so say that, in grey.
  if (gpuOff && model.state !== 'ok') return (
    <div className="statusbar" onClick={onRecheck} title={t('Click to check again now', 'Clique pour vérifier de nouveau')}>
      <Chip tone="off" label={t('Model', 'Modèle')} value={t('sleeping', 'en veille')} title={t('It runs on your GPU, which is off', 'Il tourne sur ton GPU, qui est éteint')} />
      <Chip tone="off" label="GPU" value={t('off · not billing', 'éteint · rien à payer')} title={t('No machine exists on Brev right now', 'Aucune machine sur Brev en ce moment')} />
      {usage.gpuHourly > 0 && <Chip tone="off" label={t('Spent', 'Dépensé')} value={`$${usage.gpuCost.toFixed(2)}`} title={t('GPU time so far', 'Temps GPU jusqu’ici')} />}
    </div>
  );
  return (
    <div className="statusbar" onClick={onRecheck} title={t('Click to check again now', 'Clique pour vérifier de nouveau')}>
      <Chip tone={modelTone} label={t('Model', 'Modèle')} value={modelValue} title={model.detail ?? model.name} />
      {gpu && (
        <Chip tone={gpu.state === 'running' ? 'ok' : gpu.state === 'starting' ? 'warn' : gpu.state === 'unknown' ? 'off' : 'bad'}
          label="GPU" value={`${{ running: t('on', 'allumé'), stopped: t('off', 'éteint'), starting: t('starting', 'démarrage'), missing: t('missing', 'introuvable'), unknown: t('unknown', 'inconnu') }[gpu.state]}${gpu.detail && gpu.state === 'running' ? ` · ${gpu.detail}` : ''}`} title={t(`Brev machine ${gpu.name}`, `Machine Brev ${gpu.name}`)} />
      )}
      {tunnel && <Chip tone={tunnel.up ? 'ok' : 'warn'} label={t('Link', 'Lien')} value={tunnel.up ? (tunnel.external ? t('up (external)', 'actif (externe)') : t('up', 'actif')) : t('reconnecting', 'reconnexion')} title={tunnel.lastError ?? `ssh → ${tunnel.host}`} />}
      {usage.calls > 0 && (
        <Chip tone="off" label="Tokens" value={`${fmt(usage.tokens)} · ${usage.tokensPerSec} tok/s`}
          title={t(`${fmt(usage.promptTokens)} read / ${fmt(usage.completionTokens)} written over ${usage.calls} model calls`, `${fmt(usage.promptTokens)} lus / ${fmt(usage.completionTokens)} écrits en ${usage.calls} appels au modèle`)} />
      )}
      {(usage as any).costUsd > 0 && <Chip tone="off" label={t('API cost', 'Coût API')} value={`$${(usage as any).costUsd.toFixed(2)}`} title={t('Billed per token on your Anthropic account', 'Facturé au token sur ton compte Anthropic')} />}
      {usage.gpuHourly > 0 && (
        <Chip tone="off" label={t('GPU cost', 'Coût GPU')} value={`$${usage.gpuCost.toFixed(2)} · $${usage.gpuHourly}/h`}
          title={t(`Your own GPU: you pay for its time, not per token.${usage.perMillion ? ` So far that's about $${usage.perMillion.toFixed(2)} per million tokens.` : ''} Counted while this server sees the GPU running.`, `Ton propre GPU : tu paies son temps, pas au token.${usage.perMillion ? ` Jusqu’ici, environ ${usage.perMillion.toFixed(2)} $ par million de tokens.` : ''} Compté tant que ce serveur voit le GPU allumé.`)} />
      )}
    </div>
  );
}
