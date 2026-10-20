import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './useSettings';
import { Sidebar } from './Sidebar';
import { ThreadView, landOnChat, type Layout } from './ThreadView';
import { NewThreadModal } from './NewThreadModal';
import { SettingsModal } from './SettingsModal';
import { Welcome, AboveComposer, StarterIdeas, DefaultsNote, defaultsNoted } from './Welcome';
import { PublicWelcome } from './PublicWelcome';
import { Tour, tourDone } from './Tour';
import { Landing, landed, markLanded, REPLAY, ONBOARDED } from './Landing';
import { Onboarding } from './Onboarding';
import { Resizer, storedNumber, store } from './Resizer';
import { useT } from './i18n';
import { leaveDemo } from './api';
import { ConfirmHost, confirmAsk } from './Confirm';
import { Icon } from './icons';

const guided = (id: string) => { try { return localStorage.getItem(`guide:${id}`) === '1'; } catch { return false; } };

export function App() {
  return <AppProvider><Shell /></AppProvider>;
}

function Shell() {
  const { threads, threadsLoaded, me } = useApp();
  const t = useT();
  // Online demo: say where the visitor is before anything else (once per sandbox).
  const [welcomed, setWelcomed] = useState(() => { try { return localStorage.getItem('demoWelcomed') === '1'; } catch { return false; } });
  const welcome = me?.public && !welcomed ? <PublicWelcome onDone={() => { setWelcomed(true); store('demoWelcomed', 1); }} /> : null;
  const [active, setActive] = useState<string | null>(() => { try { return localStorage.getItem('thread'); } catch { return null; } });
  const [modal, setModal] = useState<null | 'new' | 'settings'>(null);
  const [noting, setNoting] = useState(false); // the one-time note about the defaults, after the first new thread
  const [sideW, setSideW] = useState(() => storedNumber('sideW', 248));
  const [railed, setRailed] = useState(() => { try { return localStorage.getItem('rail') === '1'; } catch { return false; } });
  useEffect(() => store('sideW', Math.round(sideW)), [sideW]);
  useEffect(() => store('rail', railed ? 1 : 0), [railed]);
  // Studio (map first, one floating panel) is the default; classic keeps the sidebar + chat + map columns.
  const [layout, setLayout] = useState<Layout>(() => { try { return localStorage.getItem('layout') === 'classic' ? 'classic' : 'studio'; } catch { return 'studio'; } });
  useEffect(() => store('layout', layout), [layout]);
  // Narrow windows always get the slim rail.
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 1100);
  useEffect(() => { const r = () => setNarrow(window.innerWidth <= 1100); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setRailed((r) => !r); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const select = (id: string | null) => {
    if (id) setHome(false);
    setActive(id);
    try { id ? localStorage.setItem('thread', id) : localStorage.removeItem('thread'); } catch { /* private mode */ }
  };
  // Remembered thread was deleted → fall back to the most recent one.
  useEffect(() => {
    if (threads.length && active && !threads.some((t) => t.id === active)) select(threads[0].id);
    if (threads.length && !active && !home) select(threads[0].id);
  }, [threads]);

  // First visit on this computer (nothing opened yet): the landing page, then the tutorial in Welcome.
  const [showLanding, setShowLanding] = useState(() => !landed());
  // The logo: back to the landing page while the tutorial isn't finished, to the app's home screen once it is.
  // Finished = a first session was started from the tutorial (or, for older installs, there are sessions already).
  const [onboarded, setOnboarded] = useState(() => { try { return localStorage.getItem(ONBOARDED) === '1'; } catch { return false; } });
  const [landingOpen, setLandingOpen] = useState(false); // the landing page, opened from the logo
  const [forceOnboard, setForceOnboard] = useState(false); // the tutorial again, after "Take a ride" from that landing page
  const [touring, setTouring] = useState(() => !tourDone()); // the walkthrough, once, the first time you're in a session
  const [home, setHome] = useState(false); // the app's home screen (start a project or the guided demo)
  // Settings → About → Reset onboarding: show the landing page and the first-launch questions again.
  const [replay, setReplay] = useState(() => { try { return localStorage.getItem(REPLAY) === '1'; } catch { return false; } });
  // The server doesn't have the open thread (its file is gone): forget it quietly, open another or the welcome screen.
  const forget = () => select(threads.find((x) => x.id !== active)?.id ?? null);

  // The guided demo's tip already says where the mode and model are, so the defaults note is only for real projects.
  const created = (id: string) => {
    try { localStorage.setItem(ONBOARDED, '1'); } catch { /* private mode */ }
    setOnboarded(true); setForceOnboard(false);
    if (replay) { try { localStorage.removeItem(REPLAY); } catch { /* private mode */ } setReplay(false); } landOnChat(); select(id); if (!defaultsNoted() && !guided(id)) setNoting(true); };
  const nav = { active, onSelect: select, onNew: () => setModal('new'), onSettings: () => setModal('settings'), onLogo: () => onLogo() };
  const modals = (
    <>
      {modal === 'new' && <NewThreadModal onClose={() => setModal(null)} onCreated={(id) => { created(id); setModal(null); }} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {active && !home && touring && !modal && <Tour key={active} onDone={() => setTouring(false)} />}
      {active && !modal && !welcome && !touring && (
        <AboveComposer>
          {noting && <DefaultsNote onDone={() => setNoting(false)} />}
          <StarterIdeas key={active} id={active} />
        </AboveComposer>
      )}
      {welcome}
      <ConfirmHost />
    </>
  );
  // A blank frame until we know which screen to show: without it, a remembered session flashes before the landing
  // page or the tutorial takes over.
  const mayLand = !landed() || replay || forceOnboard || landingOpen;
  if (!threadsLoaded && (!active || mayLand) && !me?.public) return <div className="ob" />;
  const firstRun = threadsLoaded && !me?.public && (replay || forceOnboard || (!active && threads.length === 0));
  const done = Boolean(me?.public) || (onboarded && !replay) || (!replay && !forceOnboard && threads.length > 0);
  const toHome = () => { setLandingOpen(false); setHome(true); select(null); };
  const onLogo = () => (done ? toHome() : (setLandingOpen(true), setShowLanding(true)));
  if (landingOpen || (firstRun && showLanding)) return (
    <Landing onLogo={done ? toHome : undefined}
      onStart={() => { markLanded(); setShowLanding(false); setLandingOpen(false); if (!done) setForceOnboard(true); }} />
  );
  // First run: full screen, one question at a time, then a project or the guided demo.
  if (firstRun) return <><Onboarding onCreated={created} onBrowse={() => setModal('new')} onLogo={onLogo} />{modals}</>;
  if (layout === 'studio' && active && !home) return (
    <div className="shell studio-shell with-head">
      <AppHeader onNew={() => setModal('new')} onSettings={() => setModal('settings')} onLogo={onLogo} />
      <ThreadView key={active} id={active} onOpenSettings={() => setModal('settings')} onMissing={forget} layout="studio" nav={nav} onLayout={setLayout} />
      {modals}
    </div>
  );

  return (
    <div className="shell" style={{ gridTemplateColumns: railed || narrow ? '52px minmax(0, 1fr)' : `${sideW}px 0 minmax(0, 1fr)` }}>
      <Sidebar {...nav} railed={railed || narrow} onToggle={() => setRailed(!railed)} onLayout={() => setLayout('studio')} />
      {!railed && !narrow && <Resizer onDrag={(dx) => setSideW((w) => Math.max(200, Math.min(360, w + dx)))} onReset={() => setSideW(248)} title={t('Drag to resize', 'Glisse pour redimensionner')} />}
      {active && !home ? <ThreadView key={active} id={active} onOpenSettings={() => setModal('settings')} onMissing={forget} /> : (
        <Welcome onCreated={created} onBrowse={() => setModal('new')} />
      )}
      {modals}
    </div>
  );
}

// The bar across the top of a session: where you are, a new session, settings (the only Settings button in a session).
// Keeps the map from feeling closed in.
function AppHeader({ onNew, onSettings, onLogo }: { onNew: () => void; onSettings: () => void; onLogo: () => void }) {
  const t = useT();
  const { me } = useApp();
  return (
    <header className="app-head">
      <button className="app-brand" onClick={onLogo} title={t('Home', 'Accueil')}><span className="logo" /><b>codetandem</b></button>
      <span className="spacer" />
      <button className="app-head-btn primary" onClick={onNew}><Icon name="plus" size={14} />{t('New session', 'Nouvelle session')}</button>
      {me?.public && <button className="app-head-btn" onClick={() => confirmAsk({ title: t('Leave the demo?', 'Quitter la démo ?'), body: t('Your sandbox and its files are deleted.', 'Ton bac à sable et ses fichiers sont supprimés.'), ok: t('Leave', 'Quitter'), danger: true }).then((yes) => yes && leaveDemo())}>{t('Leave demo', 'Quitter la démo')}</button>}
      {!me?.public && <button className="app-head-btn head-settings" onClick={onSettings} aria-label={t('Settings', 'Réglages')}><Icon name="gear" size={18} /><span>{t('Settings', 'Réglages')}</span></button>}
    </header>
  );
}
