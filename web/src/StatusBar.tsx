// Header chips: model, GPU, tunnel, throughput, cost. Each dot is green / amber / red at a glance.
import type { HealthView } from './useHealth';

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

export function StatusBar({ health, serverDown, onRecheck }: { health: HealthView | null; serverDown: boolean; onRecheck: () => void }) {
  if (serverDown) return <div className="statusbar"><Chip tone="bad" label="Server" value="offline" /></div>;
  if (!health) return <div className="statusbar"><Chip tone="off" label="Status" value="checking…" /></div>;
  const { model, gpu, tunnel, usage } = health;
  const short = model.name.split('/').pop()!.replace(/-Instruct.*$/i, '');

  const modelTone: Tone = model.state === 'ok' ? 'ok' : model.state === 'mock' ? 'off' : 'bad';
  const modelValue = model.state === 'ok' ? `${short} · ${model.latencyMs}ms`
    : model.state === 'mock' ? 'mock (no key)' : { unreachable: 'unreachable', auth: 'bad key', missing: 'wrong model', error: 'error' }[model.state];

  return (
    <div className="statusbar" onClick={onRecheck} title="Click to re-check now">
      <Chip tone={modelTone} label="Model" value={modelValue} title={model.detail ?? model.name} />
      {gpu && (
        <Chip tone={gpu.state === 'running' ? 'ok' : gpu.state === 'starting' ? 'warn' : gpu.state === 'unknown' ? 'off' : 'bad'}
          label="GPU" value={`${gpu.state}${gpu.detail && gpu.state === 'running' ? ` · ${gpu.detail}` : ''}`} title={`Brev instance ${gpu.name}`} />
      )}
      {tunnel && <Chip tone={tunnel.up ? 'ok' : 'warn'} label="Tunnel" value={tunnel.up ? (tunnel.external ? 'up (external)' : 'up') : 'reconnecting'} title={tunnel.lastError ?? `ssh → ${tunnel.host}`} />}
      {usage.calls > 0 && (
        <Chip tone="off" label="Tokens" value={`${fmt(usage.tokens)} · ${usage.tokensPerSec} tok/s`}
          title={`${fmt(usage.promptTokens)} in / ${fmt(usage.completionTokens)} out over ${usage.calls} model calls`} />
      )}
      {usage.gpuHourly > 0 && (
        <Chip tone="off" label="GPU cost" value={`$${usage.gpuCost.toFixed(2)} · $${usage.gpuHourly}/h`}
          title={`Self-hosted: you pay for GPU time, not tokens.${usage.perMillion ? ` So far that's ≈ $${usage.perMillion.toFixed(2)} per million tokens.` : ''} Counted while this server sees the GPU running.`} />
      )}
    </div>
  );
}
