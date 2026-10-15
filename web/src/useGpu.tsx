// The one-click GPU, as seen from the UI: phase, progress log, and the start/stop buttons.
import { useEffect, useState } from 'react';
import { Icon } from './icons';

export type GpuView = {
  phase: 'off' | 'creating' | 'connecting' | 'installing' | 'loading' | 'ready' | 'stopping' | 'error';
  managed: boolean; name?: string; type?: string; startedAt?: number; error?: string; log: string[];
  idleStopAt?: number; autoStopMin: number; sessionCost: number;
};
const STEPS = ['creating', 'connecting', 'installing', 'loading', 'ready'] as const;
const STEP_NAME: Record<string, string> = { creating: 'Rent GPU', connecting: 'Connect', installing: 'Install', loading: 'Load model' };
// What's happening, in plain words, and how long that step usually takes.
const NOW: Record<string, [string, string]> = {
  creating: ['Brev is finding an available L40S and booting it.', 'usually 5–7 min'],
  connecting: ['The machine is up; opening a secure SSH connection to it.', 'under a minute'],
  installing: ['Installing vLLM, the program that serves the model.', 'about 1 min'],
  loading: ['Downloading the model (≈30 GB) and loading it onto the GPU.', '2–5 min'],
  stopping: ['Destroying the machine so nothing keeps billing.', 'a few seconds'],
};
const LABEL: Record<GpuView['phase'], string> = {
  off: 'GPU off', creating: 'Renting a GPU…', connecting: 'Connecting…', installing: 'Installing vLLM…',
  loading: 'Loading the model…', ready: 'GPU ready', stopping: 'Shutting down…', error: 'GPU problem',
};

export function useGpu() {
  const [gpu, setGpu] = useState<GpuView | null>(null);
  const load = () => fetch('/api/gpu').then((r) => r.json()).then(setGpu).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);
  const post = (path: string) => fetch(`/api/gpu/${path}`, { method: 'POST' }).then((r) => r.json()).then((j) => { if (!j.error) setGpu(j); load(); });
  return { gpu, start: () => post('start'), stop: () => post('stop') };
}

export const gpuBusy = (g: GpuView | null) => Boolean(g && ['creating', 'connecting', 'installing', 'loading', 'stopping'].includes(g.phase));

export function GpuPanel({ gpu, start, stop }: { gpu: GpuView; start: () => void; stop: () => void; compact?: boolean }) {
  const [, tick] = useState(0);
  const [details, setDetails] = useState(false);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const elapsed = gpu.startedAt ? Math.floor((Date.now() - gpu.startedAt) / 1000) : 0;
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const idleIn = gpu.idleStopAt ? Math.max(0, Math.ceil((gpu.idleStopAt - Date.now()) / 60_000)) : null;
  const at = STEPS.indexOf(gpu.phase as any);
  return (
    <div className={`gpu ${gpu.phase}`}>
      <div className="gpu-head">
        <Icon name="cpu" size={13} /><b>{LABEL[gpu.phase]}</b>
        {gpuBusy(gpu) && <span className="mono muted">{mmss}</span>}
        <span className="spacer" />
        {gpu.phase === 'off' || gpu.phase === 'error'
          ? <button className="btn primary sm" onClick={start}>{gpu.phase === 'error' ? 'Try again' : 'Start GPU'}</button>
          : gpu.phase !== 'stopping' && <button className="btn ghost sm" onClick={stop} title="Destroys the machine: nothing bills after this">Stop</button>}
      </div>
      {at >= 0 && gpu.phase !== 'ready' && (
        <div className="gpu-steps">{STEPS.slice(0, 4).map((st, i) => (
          <div key={st} className={i < at ? 'done' : i === at ? 'now' : ''}><span className="bar" /><span className="step-name">{STEP_NAME[st]}</span></div>
        ))}</div>
      )}
      {NOW[gpu.phase] && <p className="gpu-now">{NOW[gpu.phase][0]} <span className="muted">({NOW[gpu.phase][1]})</span></p>}
      {gpu.phase === 'off' && <p className="muted">Rents an L40S on Brev (~$1.06/h), installs vLLM and loads your model: about 10 minutes. It's destroyed when you stop, or after {gpu.autoStopMin} idle minutes.</p>}
      {gpu.phase === 'ready' && <p className="muted">{gpu.type ?? gpu.name} · ${gpu.sessionCost.toFixed(2)} so far{idleIn !== null ? ` · auto-stops in ${idleIn} min if idle` : ''}</p>}
      {gpu.error && <p className="bad-text">{gpu.error}</p>}
      {gpu.log.length > 0 && gpu.phase !== 'off' && (
        <>
          <button className="linkish" onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Details'}</button>
          {details && <div className="gpu-log mono">{gpu.log.slice(-12).map((l, i) => <div key={i}>{l}</div>)}</div>}
        </>
      )}
    </div>
  );
}
