// Left rail, like the desktop coding apps: new thread, threads grouped by folder, account + settings.
import { useApp } from './useSettings';
import { ago, fmtTokens, shortPath } from './api';
import { Icon } from './icons';

export type Nav = { active: string | null; onSelect: (id: string) => void; onNew: () => void; onSettings: () => void };

export function Sidebar({ active, onSelect, onNew, onSettings, railed, onToggle, embedded, onLayout }: Nav & { railed: boolean; onToggle: () => void; embedded?: boolean; onLayout?: () => void }) {
  const { threads, me, settings } = useApp();
  const groups = new Map<string, typeof threads>();
  for (const t of threads) groups.set(t.folder, [...(groups.get(t.folder) ?? []), t]);
  const provider = settings?.providers.find((p) => p.id === settings.activeProvider);
  const total = threads.reduce((a, t) => a + t.tokens, 0);

  if (railed) return (
    <nav className="sidebar rail">
      <button className="rail-btn" onClick={onToggle} title="Show threads (⌘B)" aria-label="Show threads"><span className="logo" /></button>
      <button className="rail-btn" onClick={onNew} title="New thread" aria-label="New thread"><Icon name="plus" size={15} /></button>
      <span className="spacer" />
      {!me?.public && <button className="rail-btn" onClick={onSettings} title="Settings" aria-label="Settings"><Icon name="gear" size={15} /></button>}
      <span className="avatar sm">{(me?.name ?? '?').slice(0, 1).toUpperCase()}</span>
    </nav>
  );

  return (
    <nav className={`sidebar ${embedded ? 'embedded' : ''}`}>
      {!embedded && <div className="side-brand"><span className="logo" />agent-stage{onLayout && <button className="icon-btn" onClick={onLayout} title="Map-first layout" aria-label="Map-first layout"><Icon name="map" size={14} /></button>}<button className="icon-btn" onClick={onToggle} title="Hide threads (⌘B)" aria-label="Hide threads"><Icon name="sidebar" size={14} /></button></div>}
      <button className="side-new" onClick={onNew}><Icon name="plus" size={13} /> New thread</button>

      <div className="side-scroll">
        {threads.length === 0 && <div className="side-empty">{me?.public ? 'No threads yet. Press New thread and pick a sample project.' : 'No threads yet. Start one in any folder on your computer.'}</div>}
        {[...groups].map(([folder, list]) => (
          <div key={folder} className="side-group">
            <div className="side-folder" title={shortPath(folder, me?.home)}>{folder.split('/').pop()}</div>
            {list.map((t) => (
              <button key={t.id} className={`side-thread ${t.id === active ? 'on' : ''}`} onClick={() => onSelect(t.id)}>
                {t.running && <span className="spin" />}
                <span className="side-title">{t.title}</span>
                {t.engine === 'claude-code' && <span className="side-engine" title="Claude Code engine">CC</span>}
                <span className="side-ago">{ago(t.updatedAt)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <div className="side-account">
          <span className="avatar">{(me?.name ?? '?').slice(0, 1).toUpperCase()}</span>
          <div className="who"><div>{me?.name ?? '…'}</div><div className="muted">{me?.public ? 'Online demo · private sandbox' : 'Local · this computer'}</div></div>
          {!me?.public && <button className="icon-btn" onClick={onSettings} title="Settings" aria-label="Settings"><Icon name="gear" size={15} /></button>}
        </div>
      </div>
    </nav>
  );
}
