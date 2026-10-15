// One dot instead of a status bar: green = ready, amber = connecting, red = broken. Details on hover/click.
import { useState } from 'react';
import { StatusBar } from './StatusBar';
import type { HealthView } from './useHealth';

export function HealthDot({ health, serverDown, onRecheck }: { health: HealthView | null; serverDown: boolean; onRecheck: () => void }) {
  const [open, setOpen] = useState(false);
  const m = health?.model.state;
  const tone = serverDown ? 'bad' : !health ? 'off' : m === 'ok' ? 'ok' : m === 'mock' ? 'off'
    : health.tunnel && !health.tunnel.up ? 'warn' : health.gpu?.state === 'starting' ? 'warn' : 'bad';
  const name = health ? (health.model.mock ? 'Demo' : health.model.name.split('/').pop()!.replace(/-Instruct.*$/i, '')) : '…';
  return (
    <div className="hdot" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="hdot-btn" onClick={() => { setOpen(!open); onRecheck(); }} title="Model status">
        <span className={`sdot ${tone}`} /><span className="hdot-name">{name}</span>
      </button>
      {open && <div className="hdot-pop"><StatusBar health={health} serverDown={serverDown} onRecheck={onRecheck} /></div>}
    </div>
  );
}
