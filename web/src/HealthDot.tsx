// One dot instead of a status bar: green = ready, amber = starting, red = broken, grey = off on purpose. Details on hover/click.
import { useState } from 'react';
import { useDismiss } from './dismiss';
import { StatusBar } from './StatusBar';
import type { HealthView } from './useHealth';
import { GpuPanel, gpuBusy, type GpuView } from './useGpu';
import { useT } from './i18n';

export function HealthDot({ health, serverDown, onRecheck, gpu, bare }: { health: HealthView | null; serverDown: boolean; onRecheck: () => void;
  gpu?: { gpu: GpuView | null; start: () => void; stop: () => void }; bare?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));
  const m = health?.model.state;
  const g = gpu?.gpu?.managed ? gpu.gpu : null;
  const gpuOff = Boolean(g && g.phase === 'off');
  const tone = gpuOff && m !== 'ok' ? 'off' : g && gpuBusy(g) ? 'warn' : serverDown ? 'bad' : !health ? 'off' : m === 'ok' ? 'ok' : m === 'mock' || m === 'checking' ? 'off'
    : health.tunnel && !health.tunnel.up ? 'warn' : health.gpu?.state === 'starting' ? 'warn' : 'bad';
  const name = health ? (health.model.mock ? t('Demo', 'Démo') : health.model.name.split('/').pop()!.replace(/-Instruct.*$/i, '')) : '…';
  return (
    <div className="hdot" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className={`hdot-btn ${bare ? 'bare' : ''}`} onClick={() => { setOpen(!open); onRecheck(); }} title={t('Model status', 'État du modèle')}>
        <span className={`sdot ${tone}`} />{!bare && <span className="hdot-name">{g && gpuBusy(g) ? `${g.phase}…` : name}</span>}
      </button>
      {open && <div className="hdot-pop">
        {g && gpu && <GpuPanel gpu={g} start={gpu.start} stop={gpu.stop} />}
        <StatusBar gpuOff={gpuOff} health={health} serverDown={serverDown} onRecheck={onRecheck} />
      </div>}
    </div>
  );
}
