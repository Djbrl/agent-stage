// The one-click GPU, as seen from the UI: phase, progress log, and the start/stop buttons.
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { useT, useLang, tr } from './i18n';

export type GpuView = {
  phase: 'off' | 'creating' | 'connecting' | 'installing' | 'loading' | 'ready' | 'stopping' | 'error';
  managed: boolean; name?: string; type?: string; startedAt?: number; error?: string; log: string[];
  idleStopAt?: number; autoStopMin: number; sessionCost: number;
};
const STEPS = ['creating', 'connecting', 'installing', 'loading', 'ready'] as const;
// The words, in plain language, and how long each step usually takes.
const words = (fr: boolean) => {
  const t = tr(fr);
  return {
    step: { creating: t('Rent GPU', 'Louer le GPU'), connecting: t('Connect', 'Connexion'), installing: t('Install', 'Installation'), loading: t('Load model', 'Chargement') } as Record<string, string>,
    now: {
      creating: [t('Brev is finding a free L40S and starting it.', 'Brev cherche un L40S libre et le démarre.'), t('usually 5–7 min', 'souvent 5 à 7 min')],
      connecting: [t('The machine is up; opening a secure connection to it.', 'La machine est prête ; ouverture d’une connexion sécurisée.'), t('under a minute', 'moins d’une minute')],
      installing: [t('Installing vLLM, the program that serves the model.', 'Installation de vLLM, le programme qui fait tourner le modèle.'), t('about 1 min', 'environ 1 min')],
      loading: [t('Downloading the model (≈30 GB) and loading it onto the GPU.', 'Téléchargement du modèle (≈30 Go) et chargement sur le GPU.'), t('2–5 min', '2 à 5 min')],
      stopping: [t('Deleting the machine so nothing keeps billing.', 'Suppression de la machine pour que rien ne soit plus facturé.'), t('a few seconds', 'quelques secondes')],
    } as Record<string, [string, string]>,
    label: {
      off: t('GPU off', 'GPU éteint'), creating: t('Renting a GPU…', 'Location d’un GPU…'), connecting: t('Connecting…', 'Connexion…'), installing: t('Installing vLLM…', 'Installation de vLLM…'),
      loading: t('Loading the model…', 'Chargement du modèle…'), ready: t('GPU ready', 'GPU prêt'), stopping: t('Shutting down…', 'Arrêt…'), error: t('GPU problem', 'Problème de GPU'),
    } as Record<GpuView['phase'], string>,
  };
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
  const t = useT();
  const w = words(useLang() === 'fr');
  const NOW = w.now;
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const elapsed = gpu.startedAt ? Math.floor((Date.now() - gpu.startedAt) / 1000) : 0;
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const idleIn = gpu.idleStopAt ? Math.max(0, Math.ceil((gpu.idleStopAt - Date.now()) / 60_000)) : null;
  const at = STEPS.indexOf(gpu.phase as any);
  return (
    <div className={`gpu ${gpu.phase}`}>
      <div className="gpu-head">
        <Icon name="cpu" size={13} /><b>{w.label[gpu.phase]}</b>
        {gpuBusy(gpu) && <span className="mono muted">{mmss}</span>}
        <span className="spacer" />
        {gpu.phase === 'off' || gpu.phase === 'error'
          ? <button className="btn primary sm" onClick={start}>{gpu.phase === 'error' ? t('Try again', 'Réessayer') : t('Start GPU', 'Démarrer le GPU')}</button>
          : gpu.phase !== 'stopping' && <button className="btn ghost sm" onClick={stop} title={t('Deletes the machine: nothing is billed after this', 'Supprime la machine : plus rien n’est facturé ensuite')}>{t('Stop', 'Arrêter')}</button>}
      </div>
      {at >= 0 && gpu.phase !== 'ready' && (
        <div className="gpu-steps">{STEPS.slice(0, 4).map((st, i) => (
          <div key={st} className={i < at ? 'done' : i === at ? 'now' : ''}><span className="bar" /><span className="step-name">{w.step[st]}</span></div>
        ))}</div>
      )}
      {NOW[gpu.phase] && <p className="gpu-now">{NOW[gpu.phase][0]} <span className="muted">({NOW[gpu.phase][1]})</span></p>}
      {gpu.phase === 'off' && <p className="muted">{t(`Rents an L40S on Brev (~$1.06/h), installs vLLM and loads your model: about 10 minutes. It’s deleted when you stop, or after ${gpu.autoStopMin} idle minutes.`, `Loue un L40S sur Brev (~1,06 $/h), installe vLLM et charge ton modèle : environ 10 minutes. Il est supprimé quand tu l’arrêtes, ou après ${gpu.autoStopMin} minutes sans activité.`)}</p>}
      {gpu.phase === 'ready' && <p className="muted">{gpu.type ?? gpu.name} · ${gpu.sessionCost.toFixed(2)} {t('so far', 'jusqu’ici')}{idleIn !== null ? t(` · turns off in ${idleIn} min if idle`, ` · s’éteint dans ${idleIn} min sans activité`) : ''}</p>}
      {gpu.error && <p className="bad-text">{gpu.error}</p>}
      {gpu.log.length > 0 && gpu.phase !== 'off' && (
        <>
          <button className="linkish" onClick={() => setDetails(!details)}>{details ? t('Hide details', 'Masquer les détails') : t('Details', 'Détails')}</button>
          {details && <div className="gpu-log mono">{gpu.log.slice(-12).map((l, i) => <div key={i}>{l}</div>)}</div>}
        </>
      )}
    </div>
  );
}
