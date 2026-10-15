// Pick a folder on this computer to start a thread in: the Finder dialog (opened by the server), a recent one, or none.
import { useEffect, useState } from 'react';
import { get, send, shortPath, engineOf, ENGINE_LABEL, type Engine, type EngineStatus } from './api';
import { useApp } from './useSettings';
import { Icon } from './icons';

type Listing = { path: string; parent: string | null; name: string; folders: string[]; error?: string };

export function NewThreadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { settings, me, refreshThreads } = useApp();
  const [dir, setDir] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false); // the in-page browser is the fallback; the Finder dialog comes first
  const [mode, setMode] = useState<'build' | 'learn'>('build');
  const [engines, setEngines] = useState<EngineStatus | null>(null);
  useEffect(() => { get<EngineStatus>('/api/engines').then(setEngines); }, []);
  const active = settings?.providers.find((p) => p.id === settings.activeProvider);
  const [engine, setEngine] = useState<Engine>(active ? engineOf(active) : 'native');
  // The model used for the chosen engine: the active one if it matches, else that engine's first usable model.
  const providerFor = (e: Engine) => {
    const ps = settings?.providers.filter((p) => engineOf(p) === e) ?? [];
    return (active && engineOf(active) === e ? active : ps.find((p) => p.apiKey || p.kind === 'mock') ?? ps[0])?.id;
  };
  const browse = (path?: string) => get<Listing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then((l) => !l.error && setDir(l));
  useEffect(() => { browse(); }, []);

  const start = async (folder: string | null) => {
    setBusy(true);
    const t = await send<{ id: string }>('/api/threads', { folder, scratch: folder === null, mode, providerId: providerFor(engine) });
    refreshThreads();
    onCreated(t.id);
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>New thread</span><button className="icon-btn" onClick={onClose}><Icon name="x" size={13} /></button></div>
        <div className="modal-body">
          <div className="label">Mode</div>
          <div className="mode-pick">
            <button className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}><b>Build</b><span className="muted">The agent does the work. You watch, steer and approve.</span></button>
            <button className={mode === 'learn' ? 'on' : ''} onClick={() => setMode('learn')}><b>Learn</b><span className="muted">You design, the agent teaches. It can only write code after you approve each step.</span></button>
          </div>
          <div className="label">Engine</div>
          <div className="engine-pick">
            {(['native', 'claude-code', 'codex'] as const).map((e) => {
              const st = engines?.[e];
              const off = !st?.ready;
              return (
                <button key={e} className={engine === e ? 'on' : ''} disabled={off} onClick={() => e !== 'codex' && setEngine(e)} title={st?.reason}>
                  <b>{ENGINE_LABEL[e]}</b>
                  <span className="muted">{e === 'native' ? 'Open models: your GPU, Ollama, NVIDIA…' : e === 'claude-code' ? (off ? st?.reason : 'Anthropic’s agent, with your API key') : 'Coming soon'}</span>
                </button>
              );
            })}
          </div>
          <div className="label">Project</div>
          <div className="open-pick">
            <button className="btn" disabled={busy} onClick={() => send<{ path?: string }>('/api/pick-folder', {}).then((r) => r.path && start(r.path))}>
              <Icon name="folder" size={13} /> Open folder…
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => start(null)} title="Creates an empty folder in ~/agent-stage-projects">Start without a folder</button>
          </div>
          <div className="label">Recent folders</div>
          <div className="folder-list">
            {(settings?.recentFolders ?? []).map((f) => (
              <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                <Icon name="folder" size={13} /><span>{f.split('/').pop()}</span><span className="muted mono">{shortPath(f, me?.home)}</span>
                {f === me?.sandbox && <span className="pill">sandbox</span>}
              </button>
            ))}
          </div>

          {dir && browsing && (
            <div className="browser">
              <div className="crumbs">
                {dir.parent && <button className="btn ghost sm" onClick={() => browse(dir.parent!)}>↑ Up</button>}
                <span className="mono">{shortPath(dir.path, me?.home)}</span>
              </div>
              <div className="folder-list scroll">
                {dir.folders.map((f) => (
                  <button key={f} className="folder-row" onClick={() => browse(`${dir.path}/${f}`)}><Icon name="folder" size={13} /><span>{f}</span></button>
                ))}
                {dir.folders.length === 0 && <div className="muted pad">No sub-folders.</div>}
              </div>
            </div>
          )}
          <p className="hint">The agent can read and edit files in this folder. Shell commands still ask first.</p>
        </div>
        <div className="modal-foot">
          {!browsing && <button className="btn ghost sm" onClick={() => setBrowsing(true)}>Browse here instead</button>}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {browsing && <button className="btn primary" disabled={!dir || busy} onClick={() => dir && start(dir.path)}>Start in {dir?.name ?? '…'}</button>}
        </div>
      </div>
    </div>
  );
}
