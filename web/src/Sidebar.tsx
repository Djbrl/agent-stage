// Left rail, like the desktop coding apps: new session, sessions grouped by folder, account + settings.
import { useApp } from './useSettings';
import { ago, shortPath, baseName } from './api';
import { Icon } from './icons';
import { useT, useLang } from './i18n';

export type Nav = { active: string | null; onSelect: (id: string) => void; onNew: () => void; onSettings: () => void };

export function Sidebar({ active, onSelect, onNew, onSettings, railed, onToggle, embedded, onLayout }: Nav & { railed: boolean; onToggle: () => void; embedded?: boolean; onLayout?: () => void }) {
  const { threads, me } = useApp();
  const t = useT();
  const fr = useLang() === 'fr';
  const groups = new Map<string, typeof threads>();
  const SHARED = '\0shared'; // imported sessions each have their own empty folder: one group for all of them
  for (const th of threads) { const k = th.shared ? SHARED : th.folder; groups.set(k, [...(groups.get(k) ?? []), th]); }
  const titleOf = (title: string) => (!title || title === 'New thread' ? t('New session', 'Nouvelle session') : title);

  if (railed) return (
    <nav className="sidebar rail">
      <button className="rail-btn" onClick={onToggle} title={t('Show sessions (⌘B)', 'Afficher les sessions (⌘B)')} aria-label={t('Show sessions', 'Afficher les sessions')}><span className="logo" /></button>
      <button className="rail-btn" onClick={onNew} title={t('New session', 'Nouvelle session')} aria-label={t('New session', 'Nouvelle session')}><Icon name="plus" size={15} /></button>
      <span className="spacer" />
      {!me?.public && <button className="rail-btn" onClick={onSettings} title={t('Settings', 'Réglages')} aria-label={t('Settings', 'Réglages')}><Icon name="gear" size={15} /></button>}
      <span className="avatar sm">{(me?.name ?? '?').slice(0, 1).toUpperCase()}</span>
    </nav>
  );

  return (
    <nav className={`sidebar ${embedded ? 'embedded' : ''}`}>
      {!embedded && <div className="side-brand"><span className="logo" />Codetandem{onLayout && <button className="icon-btn" onClick={onLayout} title={t('Map-first layout', 'Disposition carte d’abord')} aria-label={t('Map-first layout', 'Disposition carte d’abord')}><Icon name="map" size={14} /></button>}<button className="icon-btn" onClick={onToggle} title={t('Hide sessions (⌘B)', 'Masquer les sessions (⌘B)')} aria-label={t('Hide sessions', 'Masquer les sessions')}><Icon name="sidebar" size={14} /></button></div>}
      <button className="side-new" onClick={onNew}><Icon name="plus" size={13} /> {t('New session', 'Nouvelle session')}</button>

      <div className="side-scroll">
        {threads.length === 0 && <div className="side-empty">{me?.public ? t('No sessions yet. Press New session and pick a sample project.', 'Pas encore de session. Clique sur Nouvelle session et choisis un projet d’exemple.') : t('No sessions yet. Start one in any folder on your computer.', 'Pas encore de session. Commences-en une dans n’importe quel dossier de ton ordinateur.')}</div>}
        {[...groups].map(([folder, list]) => (
          <div key={folder} className="side-group">
            <div className="side-folder" title={folder === SHARED ? undefined : shortPath(folder, me?.home)}>{folder === SHARED ? t('Shared sessions', 'Sessions partagées') : baseName(folder)}</div>
            {list.map((th) => (
              <button key={th.id} className={`side-thread ${th.id === active ? 'on' : ''}`} onClick={() => onSelect(th.id)}>
                {th.running && <span className="spin" />}
                <span className="side-title">{titleOf(th.title)}</span>
                {th.engine === 'claude-code' && <span className="side-engine" title={t('Runs on the Claude Code agent', 'Tourne avec l’agent Claude Code')}>CC</span>}
                <span className="side-ago">{ago(th.updatedAt, fr)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <div className="side-account">
          <span className="avatar">{(me?.name ?? '?').slice(0, 1).toUpperCase()}</span>
          <div className="who"><div>{me?.name ?? '…'}</div><div className="muted">{me?.public ? t('Online demo · private sandbox', 'Démo en ligne · bac à sable privé') : t('Local · this computer', 'Local · cet ordinateur')}</div></div>
          {!me?.public && !embedded && <button className="icon-btn" onClick={onSettings} title={t('Settings', 'Réglages')} aria-label={t('Settings', 'Réglages')}><Icon name="gear" size={15} /></button>}
        </div>
      </div>
    </nav>
  );
}
