// Pick a folder on this computer to start a thread in: the Finder dialog (opened by the server), a recent one, or none.
import { useEffect, useState } from 'react';
import { get, send, shortPath, baseName, engineOf, ENGINE_LABEL, type Engine, type EngineStatus } from './api';
import { useApp } from './useSettings';
import { Icon } from './icons';
import { useDismiss } from './dismiss';

type Listing = { path: string; parent: string | null; name: string; folders: string[]; error?: string };

export function NewThreadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { settings, me, refreshThreads } = useApp();
  useDismiss(true, onClose);
  const [dir, setDir] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
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

  // A session file someone shared (thread menu → Share this session): it opens as a replay.
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      let data: unknown;
      try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not a session file.'); }
      const t = await send<{ id: string }>('/api/threads/import', data);
      refreshThreads();
      onCreated(t.id);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const start = async (folder: string | null) => {
    setBusy(true); setErr('');
    try {
      const t = await send<{ id: string }>('/api/threads', { folder, scratch: folder === null, mode, providerId: providerFor(engine) });
      refreshThreads();
      onCreated(t.id);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>New thread</span><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={13} /></button></div>
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
                  <span className="muted">{e === 'native' ? 'Our own agent loop: your GPU, Claude API, Ollama, NVIDIA…' : e === 'claude-code' ? (off ? st?.reason : 'Anthropic’s agent, with your API key') : 'Coming soon'}</span>
                </button>
              );
            })}
          </div>
          {me?.public ? <>
            <div className="label">Project</div>
            <div className="folder-list">
              {(me.samples ?? []).map((f) => (
                <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                  <Icon name="folder" size={13} /><span>{baseName(f)}</span>
                </button>
              ))}
              <button className="folder-row" disabled={busy} onClick={() => start(null)}><Icon name="plus" size={13} /><span>Empty project</span></button>
            </div>
            <p className="hint">This is your own private sandbox: the agent can edit files, run commands and use a browser inside it. It's deleted when you leave.</p>
          </> : <>
          <div className="label">Project</div>
          <div className="open-pick">
            <button className="btn" disabled={busy} onClick={() => send<{ path?: string }>('/api/pick-folder', {}).then((r) => { if (r.path) start(r.path); }, (e) => setErr(e.message))}>
              <Icon name="folder" size={13} /> Open folder…
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => start(null)} title="Creates an empty folder in ~/agent-stage-projects">Start without a folder</button>
          </div>
          <div className="label">Recent folders</div>
          <div className="folder-list">
            {(settings?.recentFolders ?? []).map((f) => (
              <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                <Icon name="folder" size={13} /><span>{baseName(f)}</span><span className="muted mono">{shortPath(f, me?.home)}</span>
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
          </>}
        </div>
        <div className="modal-foot">
          {!browsing && !me?.public && <button className="btn ghost sm" onClick={() => setBrowsing(true)}>Browse here instead</button>}
          <label className={`btn ghost sm ${busy ? 'disabled' : ''}`} title="Open a session file someone shared with you, to replay it on the map">
            Open a shared session…
            <input type="file" accept=".json,application/json" hidden disabled={busy} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span style={{ flex: 1 }} />
          {err && <span className="problem">{err}</span>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {browsing && <button className="btn primary" disabled={!dir || busy} onClick={() => dir && start(dir.path)}>Start in {dir?.name ?? '…'}</button>}
        </div>
      </div>
    </div>
  );
}
