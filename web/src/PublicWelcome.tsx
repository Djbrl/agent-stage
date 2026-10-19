// Online demo only: a one-time card that tells a visitor where they are before anything else.
// Three short steps, each with a small drawing; the fine print sits behind "Limits".
import { useState, type ReactNode } from 'react';
import { useHealth } from './useHealth';
import { useApp } from './useSettings';
import { useT } from './i18n';

// A private box, just for you.
const Sandbox = () => (
  <svg viewBox="0 0 220 120" aria-hidden="true">
    <rect x="50" y="18" width="120" height="84" rx="14" fill="var(--chalk)" stroke="var(--ink)" strokeWidth="3" />
    <rect x="66" y="36" width="88" height="10" rx="5" fill="var(--lime)" />
    <rect x="66" y="54" width="60" height="10" rx="5" fill="var(--line-strong)" />
    <rect x="66" y="72" width="74" height="10" rx="5" fill="var(--line-strong)" />
    <circle cx="170" cy="22" r="17" fill="var(--blue)" />
    <path d="M163 23v-4a7 7 0 0 1 14 0v4" fill="none" stroke="#fff" strokeWidth="2.5" />
    <rect x="160" y="22" width="20" height="13" rx="3" fill="#fff" />
  </svg>
);
// The agent's marker moving between files on the map.
const MapDraw = () => (
  <svg viewBox="0 0 220 120" aria-hidden="true">
    <circle cx="80" cy="60" r="44" fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="4 5" />
    <circle cx="62" cy="48" r="12" fill="var(--chalk)" stroke="var(--line-strong)" strokeWidth="2" />
    <circle cx="96" cy="74" r="15" fill="var(--chalk)" stroke="var(--line-strong)" strokeWidth="2" />
    <circle cx="160" cy="44" r="20" fill="var(--chalk)" stroke="var(--line-strong)" strokeWidth="2" />
    <path d="M96 74 C 120 70, 130 50, 160 44" fill="none" stroke="var(--orange)" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
    <circle cx="160" cy="44" r="7" fill="var(--orange)" />
    <circle cx="96" cy="74" r="5" fill="var(--blue)" />
  </svg>
);
// New session → a sample project → your task.
const StartDraw = () => (
  <svg viewBox="0 0 220 120" aria-hidden="true">
    <rect x="8" y="44" width="56" height="32" rx="16" fill="var(--blue)" />
    <path d="M30 60h12M36 54v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <path d="M70 60h12" stroke="var(--line-strong)" strokeWidth="3" strokeLinecap="round" />
    <rect x="86" y="44" width="56" height="32" rx="8" fill="var(--chalk)" stroke="var(--ink)" strokeWidth="2.5" />
    <path d="M98 54h12l4 4h16v10H98z" fill="var(--sun)" />
    <path d="M148 60h12" stroke="var(--line-strong)" strokeWidth="3" strokeLinecap="round" />
    <rect x="164" y="44" width="48" height="32" rx="16" fill="var(--lime)" />
    <path d="M188 68V52M181 58l7-7 7 7" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function PublicWelcome({ onDone }: { onDone: () => void }) {
  const { health } = useHealth();
  const { settings, me } = useApp();
  const t = useT();
  const [step, setStep] = useState(0);
  const net = Boolean(me?.internet);
  const live = health && !health.model.mock && health.model.state === 'ok';
  const claude = Boolean(settings?.providers.some((p) => p.id === 'claude'));
  const steps: { art: ReactNode; title: string; text: ReactNode }[] = [
    { art: <Sandbox />, title: t('Your own private sandbox', 'Ton bac à sable privé'),
      text: t('A fresh computer, started just for you. Nobody else sees it, and it’s deleted 20 minutes after you leave.', 'Un ordinateur tout neuf, lancé juste pour toi. Personne d’autre ne le voit, et il est supprimé 20 minutes après ton départ.') },
    { art: <MapDraw />, title: claude || live ? t('A real agent, a real model', 'Un vrai agent, un vrai modèle') : t('A scripted demo for now', 'Une démo scriptée pour l’instant'),
      text: claude ? t('Claude Sonnet 5.5 does your tasks. You watch every file it reads and edits on the map.', 'Claude Sonnet 5.5 fait tes tâches. Tu vois sur la carte chaque fichier qu’il lit et modifie.')
        : live ? t('An open model (Qwen3-Coder) on our NVIDIA GPU does your tasks. You watch every step on the map.', 'Un modèle ouvert (Qwen3-Coder) sur notre GPU NVIDIA fait tes tâches. Tu suis chaque étape sur la carte.')
        : t('The live model is off, so a fixed example plays whatever you ask. It shows how the map works.', 'Le modèle en direct est éteint : un exemple fixe se joue quoi que tu demandes. Ça montre comment marche la carte.') },
    { art: <StartDraw />, title: t('Start here', 'Pour commencer'),
      text: <>{t('Press New session, pick', 'Clique sur Nouvelle session, choisis')} <i>todo-app</i> {t('or', 'ou')} <i>stats-py</i>, {t('then describe a task. It asks before running commands.', 'puis décris une tâche. Il demande avant de lancer des commandes.')}</> },
  ];
  const last = step === steps.length - 1;
  const s = steps[step];
  return (
    <div className="modal-back">
      <div className="modal welcome-demo stepped">
        <div className="wd-art">{s.art}</div>
        <div className="modal-body">
          <h2>{s.title}</h2>
          <p className="wd-text">{s.text}</p>
          {last && (
            <details className="wd-limits">
              <summary>{t('Limits', 'Limites')}</summary>
              <ul>
                <li>{net ? t('Public websites only (npm, pip, git clone); nothing else outside the sandbox.', 'Sites publics seulement (npm, pip, git clone) ; rien d’autre hors du bac à sable.') : t('No internet: no npm or pip installs, no outside websites.', 'Pas d’internet : pas d’installation npm ou pip, pas de sites extérieurs.')}</li>
                <li>{t('1 CPU, 1.5 GB of memory, 1 GB of disk.', '1 CPU, 1,5 Go de mémoire, 1 Go de disque.')}</li>
                <li>{t('400k model tokens', '400k tokens de modèle')}{claude ? t(' and $5 of Claude', ' et 5 $ de Claude') : ''}{t(' per visitor; 5 visitors at a time.', ' par visiteur ; 5 visiteurs à la fois.')}</li>
              </ul>
            </details>
          )}
        </div>
        <div className="modal-foot">
          <div className="wd-dots">{steps.map((_, i) => <button key={i} className={i === step ? 'on' : ''} onClick={() => setStep(i)} aria-label={t(`Step ${i + 1}`, `Étape ${i + 1}`)} />)}</div>
          <span style={{ flex: 1 }} />
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>{t('Back', 'Retour')}</button>}
          {last ? <button className="btn primary" onClick={onDone}>{t('Let’s go', 'C’est parti')}</button>
            : <button className="btn primary" onClick={() => setStep(step + 1)}>{t('Next', 'Suivant')}</button>}
        </div>
      </div>
    </div>
  );
}
