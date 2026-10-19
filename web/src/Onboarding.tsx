// First run, full screen, one thing at a time: hello, then one question per screen (coding with AI, coding in
// general, language), each answer saying what it changes, then where to start (a project or the guided demo).
// A lane at the top shows how far along you are; Back is always there.
import { useState } from 'react';
import { send, baseName, shortPath } from './api';
import { useApp } from './useSettings';
import { useT } from './i18n';
import { Icon } from './icons';
import { useStartThread } from './Welcome';

type Learn = { level: 'beginner' | 'intermediate' | 'advanced'; frequency: 'light' | 'normal' | 'frequent'; language: 'en' | 'fr'; ai?: 'none' | 'chat' | 'agents' };

const Bike = ({ w = 44 }: { w?: number }) => (
  <svg width={w} height={Math.round(w * 0.6)} viewBox="0 0 120 72" aria-hidden="true">
    <g fill="none" stroke="#141414" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="26" cy="50" r="17" /><circle cx="94" cy="50" r="17" /><path d="M26 50 L44 27 L60 50 L74 27 L94 50 M44 27 L84 23 L89 17" />
    </g>
    <circle cx="42" cy="11" r="9" fill="#ff5a1f" /><circle cx="72" cy="9" r="9" fill="#2f45e8" />
  </svg>
);

export function Onboarding({ onCreated, onBrowse }: { onCreated: (id: string) => void; onBrowse: () => void }) {
  const { settings, save, me } = useApp();
  const t = useT();
  const { start, busy, setBusy, err, setErr } = useStartThread(onCreated);
  const [step, setStep] = useState(0);
  const learn = settings?.learn as Learn | undefined;
  if (!settings || !learn) return <div className="ob" />;
  const set = (patch: Partial<Learn>) => { try { if (patch.language) localStorage.setItem('langPicked', '1'); } catch { /* private mode */ } void save({ learn: { ...learn, ...patch } }); };
  const STEPS = 5;
  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1));
  const pick = (patch: Partial<Learn>) => { set(patch); setTimeout(next, 260); };
  const open = async () => {
    if (me?.public) return onBrowse();
    setBusy(true); setErr('');
    const r = await send<{ path?: string; error?: string }>('/api/pick-folder', {}).catch(() => ({ error: 'failed' } as { path?: string; error?: string }));
    setBusy(false);
    if (r.path) return start(r.path);
    if (r.error) onBrowse();
  };
  const recent = (settings.recentFolders ?? []).slice(0, 3);

  const Q = ({ kicker, title, choices }: { kicker: string; title: string; choices: { on: boolean; label: string; does: string; tone: string; onPick: () => void }[] }) => (
    <div className="ob-q">
      <span className="ob-kicker">{kicker}</span>
      <h1>{title}</h1>
      <div className={`ob-choices n${choices.length}`}>
        {choices.map((c) => (
          <button key={c.label} className={`ob-choice ob-${c.tone}${c.on ? ' on' : ''}`} aria-pressed={c.on} onClick={c.onPick}>
            <b>{c.label}</b><span>{c.does}</span><i className="ob-tick" aria-hidden="true"><Icon name="check" size={14} /></i>
          </button>
        ))}
      </div>
    </div>
  );

  const screens = [
    <div className="ob-hello" key="hello">
      <div className="ob-bike"><Bike w={120} /></div>
      <h1>{t('Code in tandem.', 'Coder en tandem.')}</h1>
      <p>{t('You steer, the agent pedals. Three quick questions so it explains things your way.', 'Tu guides, l’agent pédale. Trois questions rapides pour qu’il t’explique les choses à ta façon.')}</p>
      <button className="ob-go" onClick={next}>{t('Let’s go', 'C’est parti')} <Icon name="arrow" size={16} className="ob-arrow" /></button>
    </div>,
    <Q key="ai" kicker={t('Question 1 of 3', 'Question 1 sur 3')} title={t('Have you coded with AI before?', 'As-tu déjà codé avec l’IA ?')} choices={[
      { on: learn.ai === 'none', tone: 'lime', label: t('Never yet', 'Jamais encore'), does: t('It says what it’s about to do, and why, before every move.', 'Il dit ce qu’il va faire, et pourquoi, avant chaque geste.'), onPick: () => pick({ ai: 'none' }) },
      { on: learn.ai === 'chat', tone: 'sun', label: t('I ask chatbots for code', 'Je demande du code à des chatbots'), does: t('It shows what changes when an agent works in your real files.', 'Il montre ce qui change quand un agent travaille dans tes vrais fichiers.'), onPick: () => pick({ ai: 'chat' }) },
      { on: learn.ai === 'agents', tone: 'orange', label: t('I use coding agents', 'J’utilise des agents de code'), does: t('It focuses on reviewing and steering an agent, and catching its mistakes.', 'Il se concentre sur relire et piloter un agent, et repérer ses erreurs.'), onPick: () => pick({ ai: 'agents' }) },
    ]} />,
    <Q key="level" kicker={t('Question 2 of 3', 'Question 2 sur 3')} title={t('And coding in general?', 'Et la programmation en général ?')} choices={[
      { on: learn.level === 'beginner', tone: 'lime', label: t('I’m new to it', 'Je débute'), does: t('Every new term explained in plain words, with more context.', 'Chaque nouveau terme expliqué simplement, avec plus de contexte.'), onPick: () => pick({ level: 'beginner' }) },
      { on: learn.level === 'intermediate', tone: 'sun', label: t('I know the basics', 'Je connais les bases'), does: t('Focus on how the parts of a project fit together.', 'L’accent sur comment les parties d’un projet s’emboîtent.'), onPick: () => pick({ level: 'intermediate' }) },
      { on: learn.level === 'advanced', tone: 'orange', label: t('I’m experienced', 'J’ai de l’expérience'), does: t('Assumptions, failure modes and trade-offs, without the basics.', 'Hypothèses, cas d’échec et compromis, sans les bases.'), onPick: () => pick({ level: 'advanced' }) },
    ]} />,
    <Q key="lang" kicker={t('Question 3 of 3', 'Question 3 sur 3')} title={t('Which language?', 'Quelle langue ?')} choices={[
      { on: learn.language === 'en', tone: 'blue', label: 'English', does: t('The app and the tutor speak English. Code stays in English.', 'L’app et le tuteur parlent anglais. Le code reste en anglais.'), onPick: () => pick({ language: 'en' }) },
      { on: learn.language === 'fr', tone: 'blue', label: 'Français', does: t('The app and the tutor speak French. Code stays in English.', 'L’app et le tuteur parlent français. Le code reste en anglais.'), onPick: () => pick({ language: 'fr' }) },
    ]} />,
    <div className="ob-q" key="start">
      <span className="ob-kicker">{t('All set', 'C’est prêt')}</span>
      <h1>{t('Where do we ride?', 'On roule où ?')}</h1>
      <div className="ob-choices n2">
        <button className="ob-choice ob-blue big" disabled={busy} onClick={open}>
          <Icon name="folder" size={28} /><b>{t('Open a project', 'Ouvrir un projet')}</b><span>{t('Pick a folder on this computer. Nothing changes until you say yes.', 'Choisis un dossier sur cet ordinateur. Rien ne change avant ton oui.')}</span>
        </button>
        <button className="ob-choice ob-lime big" disabled={busy} onClick={() => start(null, true)}>
          <Icon name="play" size={28} /><b>{t('Try the guided demo', 'Essayer la démo guidée')}</b><span>{t('An empty project and three ideas to start from. Takes a minute.', 'Un projet vide et trois idées pour démarrer. Ça prend une minute.')}</span>
        </button>
      </div>
      {recent.length > 0 && !me?.public && (
        <div className="ob-recent">
          <span>{t('Recent', 'Récents')}</span>
          {recent.map((f) => <button key={f} disabled={busy} onClick={() => start(f)} title={shortPath(f, me?.home)}><Icon name="folder" size={13} />{baseName(f)}</button>)}
        </div>
      )}
      {err && <span className="problem">{err}</span>}
    </div>,
  ];

  return (
    <div className="ob">
      <header className="ob-top">
        <span className="ob-brand"><Bike w={36} /><b>codetandem</b></span>
        <div className="ob-lane" aria-hidden="true">
          <i style={{ width: `${(step / (STEPS - 1)) * 100}%` }} />
          <span style={{ left: `${(step / (STEPS - 1)) * 100}%` }}><Bike w={26} /></span>
        </div>
        <span className="ob-count">{step + 1}/{STEPS}</span>
      </header>
      <main className="ob-stage" key={step}>{screens[step]}</main>
      <footer className="ob-foot">
        {step > 0 ? <button className="ob-back" onClick={() => setStep(step - 1)}><Icon name="chevron" size={14} className="flip" /> {t('Back', 'Retour')}</button> : <span />}
        {step > 0 && step < STEPS - 1 && <button className="ob-skip" onClick={next}>{t('Skip', 'Passer')}</button>}
      </footer>
    </div>
  );
}
