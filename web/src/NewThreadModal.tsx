// Pick a folder on this computer to start a thread in (the server lists folders; the browser can't).
import { useEffect, useState } from 'react';
import { get, send, shortPath } from './api';
import { useApp } from './useSettings';
import { Icon } from './icons';

type Listing = { path: string; parent: string | null; name: string; folders: string[]; error?: string };

export function NewThreadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { settings, me, refreshThreads } = useApp();
  const [dir, setDir] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const browse = (path?: string) => get<Listing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then((l) => !l.error && setDir(l));
  useEffect(() => { browse(); }, []);

  const start = async (folder: string) => {
    setBusy(true);
    const t = await send<{ id: string }>('/api/threads', { folder });
    refreshThreads();
    onCreated(t.id);
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>New thread</span><button className="icon-btn" onClick={onClose}><Icon name="x" size={13} /></button></div>
        <div className="modal-body">
          <div className="label">Recent folders</div>
          <div className="folder-list">
            {(settings?.recentFolders ?? []).map((f) => (
              <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                <Icon name="folder" size={13} /><span>{f.split('/').pop()}</span><span className="muted mono">{shortPath(f, me?.home)}</span>
                {f === me?.sandbox && <span className="pill">sandbox</span>}
              </button>
            ))}
          </div>

          <div className="label">Browse</div>
          {dir && (
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
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!dir || busy} onClick={() => dir && start(dir.path)}>Start in {dir?.name ?? '…'}</button>
        </div>
      </div>
    </div>
  );
}
