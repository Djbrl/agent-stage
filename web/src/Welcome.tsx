// First launch: the empty state (level, language, open a project or try the guided demo), plus the two small
// things that sit above the composer of a new thread: starter ideas for the guided demo and a one-time note
// about the defaults (Learn mode, the active model).
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { get, send, baseName, shortPath } from './api';
import { useApp } from './useSettings';
import { useT } from './i18n';
import { Icon } from './icons';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

// Create a thread: a folder, or an empty project (guide: with the demo's intro and starter ideas).
export function useStartThread(onCreated: (id: string) => void) {
  const { refreshThreads } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = async (folder: string | null, guide = false) => {
    setBusy(true); setErr('');
    try {
      const t = await send<{ id: string }>('/api/threads', { folder, scratch: folder === null, guide });
      if (guide) write(`guide:${t.id}`, '1');
      refreshThreads();
      onCreated(t.id);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return { start, busy, setBusy, err, setErr };
}

const LEVELS = [
  { id: 'beginner', en: 'New to coding', fr: 'Je débute' },
  { id: 'intermediate', en: 'I know the basics', fr: 'Je connais les bases' },
  { id: 'advanced', en: 'Experienced', fr: 'J’ai de l’expérience' },
] as const;

export function Welcome({ onCreated, onBrowse }: { onCreated: (id: string) => void; onBrowse: () => void }) {
  const { settings, save, me } = useApp();
  const t = useT();
  const { start, busy, setBusy, err, setErr } = useStartThread(onCreated);
  const learn = settings?.learn;
  // First visit: the language follows the browser's, until it's picked here.
  useEffect(() => {
    if (!learn || read('langPicked')) return;
    write('langPicked', '1');
    const fr = navigator.language?.toLowerCase().startsWith('fr');
    if (fr !== (learn.language === 'fr')) void save({ learn: { ...learn, language: fr ? 'fr' : 'en' } });
  }, [Boolean(learn)]);
  if (!settings || !learn) return <div className="welcome" />;
  const set = (patch: Partial<typeof learn>) => { if (patch.language) write('langPicked', '1'); void save({ learn: { ...learn, ...patch } }); };
  // Their own folder: the Finder dialog (opened by the server). Elsewhere, the in-page picker.
  const open = async () => {
    if (me?.public) return onBrowse();
    setBusy(true); setErr('');
    const r = await send<{ path?: string; error?: string }>('/api/pick-folder', {}).catch(() => ({ error: 'failed' } as { path?: string; error?: string }));
    setBusy(false);
    if (r.path) return start(r.path);
    if (r.error) onBrowse();
  };
  const recent = (settings.recentFolders ?? []).slice(0, 3);
  return (
    <div className="welcome">
      <div className="welcome-card onboard">
        <span className="logo big" />
        <h1>{t('Stay in the loop.', 'Garde la main.')}</h1>
        <p className="muted">{t('The agent codes. You follow every step and learn as it goes.', 'L’agent code. Tu suis chaque étape et tu apprends en route.')}</p>
        <div className="onboard-chips" role="group" aria-label={t('Your level', 'Ton niveau')}>
          {LEVELS.map((l) => (
            <button key={l.id} className={learn.level === l.id ? 'on' : ''} aria-pressed={learn.level === l.id} onClick={() => set({ level: l.id })}>{t(l.en, l.fr)}</button>
          ))}
        </div>
        <div className="onboard-chips" role="group" aria-label={t('Language', 'Langue')}>
          {(['en', 'fr'] as const).map((l) => (
            <button key={l} className={learn.language === l ? 'on' : ''} aria-pressed={learn.language === l} onClick={() => set({ language: l })}>{l === 'en' ? 'English' : 'Français'}</button>
          ))}
        </div>
        <button className="btn primary onboard-open" disabled={busy} onClick={open}><Icon name="folder" size={13} /> {t('Open a project', 'Ouvrir un projet')}</button>
        {recent.length > 0 && !me?.public && (
          <div className="folder-list onboard-recent">
            {recent.map((f) => (
              <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                <Icon name="folder" size={13} /><span>{baseName(f)}</span><span className="muted mono">{shortPath(f, me?.home)}</span>
              </button>
            ))}
          </div>
        )}
        <button className="btn ghost sm" disabled={busy} onClick={() => start(null, true)}>{t('Try a guided demo', 'Essayer une démo guidée')}</button>
        {err && <span className="problem">{err}</span>}
      </div>
    </div>
  );
}

// Sits just above the visible composer (whichever layout drew it). Renders nothing while there's no composer.
export function AboveComposer({ children }: { children: ReactNode }) {
  const [box, setBox] = useState<{ left: number; bottom: number; width: number } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = [...document.querySelectorAll<HTMLElement>('.agent-panel .composer')].find((c) => c.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      const next = r ? { left: Math.round(r.left), bottom: Math.round(window.innerHeight - r.top + 8), width: Math.round(r.width) } : null;
      setBox((b) => (b?.left === next?.left && b?.bottom === next?.bottom && b?.width === next?.width ? b : next));
      raf = window.setTimeout(tick, 250);
    };
    tick();
    return () => clearTimeout(raf);
  }, []);
  if (!box) return null;
  return <div className="above-composer" style={{ left: box.left, bottom: box.bottom, width: box.width }}>{children}</div>;
}

const IDEAS = [
  { en: 'A CLI that renames my photos by date', fr: 'Un CLI qui renomme mes photos par date' },
  { en: 'A small REST API, with tests', fr: 'Une petite API REST, avec des tests' },
  { en: 'A web page that shows the weather', fr: 'Une page web qui affiche la météo' },
];

// Guided demo: three starter ideas until the first message is sent. Clicking one sends it as the task.
export function StarterIdeas({ id }: { id: string }) {
  const t = useT();
  const [on, setOn] = useState(() => read(`guide:${id}`) === '1');
  const done = () => { write(`guide:${id}`, null); setOn(false); };
  useEffect(() => {
    if (!on) return;
    const check = () => get<{ events: { type: string }[] }>(`/api/threads/${id}/log?from=0`).then((r) => { if (r.events?.some((e) => e.type === 'user')) done(); }).catch(() => {});
    const timer = setInterval(check, 1500);
    return () => clearInterval(timer);
  }, [on, id]);
  if (!on) return null;
  return (
    <div className="starter-ideas">
      {IDEAS.map((i) => {
        const text = t(i.en, i.fr);
        return <button key={i.en} className="btn ghost sm" onClick={() => { done(); void send(`/api/threads/${id}/task`, { task: text }); }}>{text}</button>;
      })}
    </div>
  );
}

// Once, after the first thread: what was picked for them, and where to change it.
export function DefaultsNote({ onDone }: { onDone: () => void }) {
  const { settings } = useApp();
  const t = useT();
  const model = settings?.providers.find((p) => p.id === settings.activeProvider)?.name ?? '';
  useEffect(() => { write('defaultsNoted', '1'); const hide = setTimeout(onDone, 20_000); return () => clearTimeout(hide); }, []);
  return (
    <div className="defaults-note" role="status">
      <span><b>{t('Learn mode', 'Mode Learn')}{model && ` · ${model}`}.</b> {t('Change either anytime, under the input box.', 'Tu peux changer l’un ou l’autre à tout moment, sous la zone de saisie.')}</span>
      <button className="icon-btn" onClick={onDone} aria-label={t('Dismiss', 'Fermer')}><Icon name="x" size={11} /></button>
    </div>
  );
}
export const defaultsNoted = () => read('defaultsNoted') === '1';
