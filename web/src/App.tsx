import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './useSettings';
import { Sidebar } from './Sidebar';
import { ThreadView, landOnChat, type Layout } from './ThreadView';
import { NewThreadModal } from './NewThreadModal';
import { SettingsModal } from './SettingsModal';
import { Icon } from './icons';
import { Tour } from './Tour';
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
  const [touring, setTouring] = useState(false);
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
  // First visit with a thread open → tour. "?" brings it back.
  useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem('toured') === '1'; } catch { /* private mode */ }
    if (!seen && active) { const t = setTimeout(() => setTouring(true), 900); return () => clearTimeout(t); }
  }, [active]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '?' && tag !== 'TEXTAREA' && tag !== 'INPUT') setTouring(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const endTour = () => { setTouring(false); try { localStorage.setItem('toured', '1'); } catch { /* ignore */ } };
  const select = (id: string | null) => {
    setActive(id);
    try { id ? localStorage.setItem('thread', id) : localStorage.removeItem('thread'); } catch { /* private mode */ }
  };
  // Remembered thread was deleted → fall back to the most recent one.
  useEffect(() => {
    if (threads.length && active && !threads.some((t) => t.id === active)) select(threads[0].id);
    if (threads.length && !active) select(threads[0].id);
  }, [threads]);

  const nav = { active, onSelect: select, onNew: () => setModal('new'), onSettings: () => setModal('settings') };
  const modals = (
    <>
      {modal === 'new' && <NewThreadModal onClose={() => setModal(null)} onCreated={(id) => { landOnChat(); select(id); setModal(null); }} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onTour={() => { setModal(null); setTouring(true); }} />}
      {touring && active && !modal && !welcome && <Tour onDone={endTour} />}
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
        <div className="welcome">
          <div className="welcome-card">
            <span className="logo big" />
            <h1>Watch your agent work.</h1>
            <p className="muted">Pick a folder, give it a task, and follow it across your project on the map. Stop it, steer it, ask it things, and approve every command.</p>
            <button className="btn primary" onClick={() => setModal('new')}><Icon name="plus" size={12} /> New thread</button>
          </div>
        </div>
      )}
      {modals}
    </div>
  );
}
