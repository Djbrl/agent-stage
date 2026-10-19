// App-wide settings + threads, shared through context so the sidebar, composer and modals agree.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, send, type Me, type Settings, type ThreadSummary } from './api';

type Ctx = {
  settings: Settings | null; threads: ThreadSummary[]; threadsLoaded: boolean; me: Me | null;
  save: (patch: Partial<Settings>) => Promise<Settings>;
  refreshThreads: () => void;
};
const C = createContext<Ctx>(null!);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const refreshThreads = () => { get<ThreadSummary[]>('/api/threads').then((t) => { setThreads(t); setThreadsLoaded(true); }).catch(() => {}); };
  useEffect(() => {
    get<Settings>('/api/settings').then(setSettings);
    get<Me>('/api/me').then(setMe);
    refreshThreads();
    const t = setInterval(refreshThreads, 4000);
    return () => clearInterval(t);
  }, []);
  const save = async (patch: Partial<Settings>) => {
    const next = await send<Settings>('/api/settings', { ...settings, ...patch }, 'PUT');
    setSettings(next);
    return next;
  };
  return <C.Provider value={{ settings, threads, threadsLoaded, me, save, refreshThreads }}>{children}</C.Provider>;
}
