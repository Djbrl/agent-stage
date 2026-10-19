import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './useSettings';
import { Sidebar } from './Sidebar';
import { ThreadView, landOnChat, type Layout } from './ThreadView';
import { NewThreadModal } from './NewThreadModal';
import { SettingsModal } from './SettingsModal';
import { Welcome, AboveComposer, StarterIdeas, DefaultsNote, defaultsNoted } from './Welcome';
import { PublicWelcome } from './PublicWelcome';
import { Resizer, storedNumber, store } from './Resizer';

export function App() {
  return <AppProvider><Shell /></AppProvider>;
}

function Shell() {
  const { threads, me } = useApp();
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
    setActive(id);
    try { id ? localStorage.setItem('thread', id) : localStorage.removeItem('thread'); } catch { /* private mode */ }
  };
  // Remembered thread was deleted → fall back to the most recent one.
  useEffect(() => {
    if (threads.length && active && !threads.some((t) => t.id === active)) select(threads[0].id);
    if (threads.length && !active) select(threads[0].id);
  }, [threads]);

  const created = (id: string) => { landOnChat(); select(id); if (!defaultsNoted()) setNoting(true); };
  const nav = { active, onSelect: select, onNew: () => setModal('new'), onSettings: () => setModal('settings') };
  const modals = (
    <>
      {modal === 'new' && <NewThreadModal onClose={() => setModal(null)} onCreated={(id) => { created(id); setModal(null); }} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {active && !modal && !welcome && (
        <AboveComposer>
          {noting && <DefaultsNote onDone={() => setNoting(false)} />}
          <StarterIdeas key={active} id={active} />
        </AboveComposer>
      )}
      {welcome}
    </>
  );
  if (layout === 'studio' && active) return (
    <div className="shell studio-shell">
      <ThreadView key={active} id={active} onOpenSettings={() => setModal('settings')} layout="studio" nav={nav} onLayout={setLayout} />
      {modals}
    </div>
  );

  return (
    <div className="shell" style={{ gridTemplateColumns: railed || narrow ? '52px minmax(0, 1fr)' : `${sideW}px 0 minmax(0, 1fr)` }}>
      <Sidebar {...nav} railed={railed || narrow} onToggle={() => setRailed(!railed)} onLayout={() => setLayout('studio')} />
      {!railed && !narrow && <Resizer onDrag={(dx) => setSideW((w) => Math.max(200, Math.min(360, w + dx)))} onReset={() => setSideW(248)} />}
      {active ? <ThreadView key={active} id={active} onOpenSettings={() => setModal('settings')} /> : (
        <Welcome onCreated={created} onBrowse={() => setModal('new')} />
      )}
      {modals}
    </div>
  );
}
