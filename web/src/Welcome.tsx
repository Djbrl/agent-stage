// The start screen when no session is open (open a project or try the guided demo); the first run gets the full-screen
// Onboarding in Onboarding.tsx instead. Also the two small
// things that sit above the composer of a new thread: starter ideas for the guided demo and a one-time note
// about the defaults (Guide me, the active model).
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { get, send, baseName, shortPath } from './api';
import { useApp } from './useSettings';
import { useT, useLang, modeName } from './i18n';
import { Icon } from './icons';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

// Create a session (a thread): a folder, or an empty project (guide: with the demo's intro and starter ideas).
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

export function Welcome({ onCreated, onBrowse }: { onCreated: (id: string) => void; onBrowse: () => void }) {
  const { settings, me } = useApp();
  const t = useT();
  const { start, busy, setBusy, err, setErr } = useStartThread(onCreated);
  if (!settings) return <div className="welcome" />;
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
        <p className="muted">{t('Open one of your projects, or start from an empty one with the guided demo.', 'Ouvre un de tes projets, ou pars d’un projet vide avec la démo guidée.')}</p>
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
  useEffect(() => { if (on) write('defaultsNoted', '1'); }, [on]); // this tip says where the mode and model are
  if (!on) return null;
  // One tip, not a pile: where to start, the ideas, and what the buttons under the input do.
  return (
    <div className="idea-tip" role="status">
      <b>{t('Pick an idea to start, or type your own.', 'Choisis une idée pour démarrer, ou écris la tienne.')}</b>
      <div className="starter-ideas">
        {IDEAS.map((i) => {
          const text = t(i.en, i.fr);
          return <button key={i.en} onClick={() => { done(); void send(`/api/threads/${id}/task`, { task: text }); }}>{text}<Icon name="arrow" size={12} className="idea-go" /></button>;
        })}
      </div>
      <div className="idea-legend">
        <span><i className="lg guide"><Icon name="guide" size={13} /></i>{t('Guide me: it asks before it writes', 'Guide-moi : il demande avant d’écrire')}</span>
        <span><i className="lg build"><Icon name="build" size={13} /></i>{t('Just build it', 'Fais-le')}</span>
        <span><i className="lg spark"><Icon name="spark" size={13} /></i>{t('The model', 'Le modèle')}</span>
      </div>
      <button className="icon-btn idea-x" onClick={done} aria-label={t('Hide', 'Masquer')}><Icon name="x" size={12} /></button>
    </div>
  );
}

// Once, after the first thread: what was picked for them, and where to change it.
export function DefaultsNote({ onDone }: { onDone: () => void }) {
  const { settings } = useApp();
  const t = useT();
  const fr = useLang() === 'fr';
  const model = settings?.providers.find((p) => p.id === settings.activeProvider)?.name ?? '';
  useEffect(() => { write('defaultsNoted', '1'); const hide = setTimeout(onDone, 20_000); return () => clearTimeout(hide); }, []);
  return (
    <div className="defaults-note" role="status">
      <span><b>{modeName('learn', fr)}{model && ` · ${model}`}.</b> {t('Change either anytime, under the input box.', 'Tu peux changer l’un ou l’autre à tout moment, sous la zone de saisie.')}</span>
      <button className="icon-btn" onClick={onDone} aria-label={t('Dismiss', 'Fermer')}><Icon name="x" size={11} /></button>
    </div>
  );
}
export const defaultsNoted = () => read('defaultsNoted') === '1';
