import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './useSettings';
import { Sidebar } from './Sidebar';
import { ThreadView } from './ThreadView';
import { NewThreadModal } from './NewThreadModal';
import { SettingsModal } from './SettingsModal';
import { Icon } from './icons';

export function App() {
  return <AppProvider><Shell /></AppProvider>;
}

function Shell() {
  const { threads } = useApp();
  const [active, setActive] = useState<string | null>(() => { try { return localStorage.getItem('thread'); } catch { return null; } });
  const [modal, setModal] = useState<null | 'new' | 'settings'>(null);
  const select = (id: string | null) => {
    setActive(id);
    try { id ? localStorage.setItem('thread', id) : localStorage.removeItem('thread'); } catch { /* private mode */ }
  };
  // Remembered thread was deleted → fall back to the most recent one.
  useEffect(() => {
    if (threads.length && active && !threads.some((t) => t.id === active)) select(threads[0].id);
    if (threads.length && !active) select(threads[0].id);
  }, [threads]);

  return (
    <div className="shell">
      <Sidebar active={active} onSelect={select} onNew={() => setModal('new')} onSettings={() => setModal('settings')} />
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
      {modal === 'new' && <NewThreadModal onClose={() => setModal(null)} onCreated={(id) => { select(id); setModal(null); }} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
    </div>
  );
}
