// Start a session: open a project folder (the Finder dialog, opened by the server), a recent one, or an empty project.
import { useState } from 'react';
import { get, send, shortPath, baseName } from './api';
import { useT, useLang, serverText } from './i18n';
import { useApp } from './useSettings';
import { Icon } from './icons';
import { useDismiss } from './dismiss';

export function NewThreadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { settings, me, refreshThreads } = useApp();
  const t = useT();
  const fr = useLang() === 'fr';
  useDismiss(true, onClose);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Not offered: the app's own default folder (nobody chose it) and temporary folders, which the system deletes.
  const recents = (settings?.recentFolders ?? []).filter((f) => f !== me?.sandbox && !/^(\/private)?\/(tmp|var\/folders)\//.test(f));

  const start = async (folder: string | null) => {
    setBusy(true); setErr('');
    try {
      const th = await send<{ id: string }>('/api/threads', { folder, scratch: folder === null });
      refreshThreads();
      onCreated(th.id);
    } catch (e: any) { setErr(serverText(e.message, fr)); setBusy(false); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal start-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>{t('New session', 'Nouvelle session')}</span><button className="icon-btn" onClick={onClose} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button></div>
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
          <div className="start-choices">
            <button className="start-choice" disabled={busy} onClick={() => send<{ path?: string }>('/api/pick-folder', {}).then((r) => { if (r.path) start(r.path); }, (e) => setErr(e.message))}>
              <Icon name="folder" size={18} />
              <span><b>{t('Open a project folder', 'Ouvrir un dossier de projet')}</b>
                <span className="muted">{t('Pick a folder on this computer. The agent only works inside it.', 'Choisis un dossier sur cet ordinateur. L’agent ne travaille que dedans.')}</span></span>
            </button>
            <button className="start-choice" disabled={busy} onClick={() => start(null)}>
              <Icon name="plus" size={18} />
              <span><b>{t('Start an empty project', 'Commencer un projet vide')}</b>
                <span className="muted">{t('A new empty folder, made for you in ~/agent-stage-projects.', 'Un nouveau dossier vide, créé pour toi dans ~/agent-stage-projects.')}</span></span>
            </button>
          </div>
          {recents.length > 0 && <div className="label">{t('Recent projects', 'Projets récents')}</div>}
          <div className="folder-list">
            {recents.map((f) => (
              <button key={f} className="folder-row" disabled={busy} onClick={() => start(f)}>
                <Icon name="folder" size={13} /><span className="recent-name">{baseName(f)}</span><span className="recent-path">{shortPath(f, me?.home)}</span>
              </button>
            ))}
          </div>
          {err && <p className="problem">{err}</p>}
          </>}
        </div>
      </div>
    </div>
  );
}
