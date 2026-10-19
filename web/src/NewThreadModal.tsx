// Pick a folder on this computer to start a thread in: the Finder dialog (opened by the server), a recent one, or none.
import { useEffect, useState } from 'react';
import { get, send, shortPath, baseName } from './api';
import { useT } from './i18n';
import { useApp } from './useSettings';
import { Icon } from './icons';
import { useDismiss } from './dismiss';

type Listing = { path: string; parent: string | null; name: string; folders: string[]; error?: string };

export function NewThreadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { settings, me, refreshThreads } = useApp();
  const t = useT();
  useDismiss(true, onClose);
  const [dir, setDir] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [browsing, setBrowsing] = useState(false); // the in-page browser is the fallback; the Finder dialog comes first
  const browse = (path?: string) => get<Listing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then((l) => !l.error && setDir(l));
  useEffect(() => { browse(); }, []);

  // A session file someone shared (thread menu → Share this session): it opens as a replay.
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      let data: unknown;
      try { data = JSON.parse(await file.text()); } catch { throw new Error(t('This file is not a session file.', 'Ce fichier n’est pas un fichier de session.')); }
      const th = await send<{ id: string }>('/api/threads/import', data);
      refreshThreads();
      onCreated(th.id);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const start = async (folder: string | null) => {
    setBusy(true); setErr('');
    try {
      const th = await send<{ id: string }>('/api/threads', { folder, scratch: folder === null });
      refreshThreads();
      onCreated(th.id);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>{t('New thread', 'Nouveau fil')}</span><button className="icon-btn" onClick={onClose} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button></div>
        <div className="modal-body">
          {me?.public ? <>
            <div className="label">{t('Project', 'Projet')}</div>
            <div className="folder-list">
              {(me.samples ?? []).map((f) => (
                <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                  <Icon name="folder" size={13} /><span>{baseName(f)}</span>
                </button>
              ))}
              <button className="folder-row" disabled={busy} onClick={() => start(null)}><Icon name="plus" size={13} /><span>{t('Empty project', 'Projet vide')}</span></button>
            </div>
            <p className="hint">{t('This is your own private sandbox: the agent can edit files, run commands and use a browser inside it. It’s deleted when you leave.', 'C’est ton bac à sable privé : l’agent peut y modifier des fichiers, lancer des commandes et utiliser un navigateur. Il est supprimé quand tu pars.')}</p>
          </> : <>
          <div className="label">{t('Project', 'Projet')}</div>
          <div className="open-pick">
            <button className="btn" disabled={busy} onClick={() => send<{ path?: string }>('/api/pick-folder', {}).then((r) => { if (r.path) start(r.path); }, (e) => setErr(e.message))}>
              <Icon name="folder" size={13} /> {t('Open folder…', 'Ouvrir un dossier…')}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => start(null)} title={t('Creates an empty folder in ~/agent-stage-projects', 'Crée un dossier vide dans ~/agent-stage-projects')}>{t('Empty project', 'Projet vide')}</button>
          </div>
          {(settings?.recentFolders ?? []).length > 0 && <div className="label">{t('Recent folders', 'Dossiers récents')}</div>}
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
                {dir.parent && <button className="btn ghost sm" onClick={() => browse(dir.parent!)}>↑ {t('Up', 'Remonter')}</button>}
                <span className="mono">{shortPath(dir.path, me?.home)}</span>
              </div>
              <div className="folder-list scroll">
                {dir.folders.map((f) => (
                  <button key={f} className="folder-row" onClick={() => browse(`${dir.path}/${f}`)}><Icon name="folder" size={13} /><span>{f}</span></button>
                ))}
                {dir.folders.length === 0 && <div className="muted pad">{t('No sub-folders.', 'Aucun sous-dossier.')}</div>}
              </div>
            </div>
          )}
          <p className="hint">{t('The agent can read and edit files in this folder. Shell commands still ask first.', 'L’agent peut lire et modifier les fichiers de ce dossier. Les commandes demandent toujours ton accord.')}</p>
          </>}
        </div>
        <div className="modal-foot">
          {!browsing && !me?.public && <button className="btn ghost sm" onClick={() => setBrowsing(true)}>{t('Browse here instead', 'Parcourir ici')}</button>}
          <label className={`btn ghost sm ${busy ? 'disabled' : ''}`} title={t('Open a session file someone shared with you, to replay it on the map', 'Ouvre un fichier de session partagé avec toi, pour le rejouer sur la carte')}>
            {t('Open a shared session…', 'Ouvrir une session partagée…')}
            <input type="file" accept=".json,application/json" hidden disabled={busy} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span style={{ flex: 1 }} />
          {err && <span className="problem">{err}</span>}
          <button className="btn ghost" onClick={onClose}>{t('Cancel', 'Annuler')}</button>
          {browsing && <button className="btn primary" disabled={!dir || busy} onClick={() => dir && start(dir.path)}>{t('Start in', 'Commencer dans')} {dir?.name ?? '…'}</button>}
        </div>
      </div>
    </div>
  );
}
