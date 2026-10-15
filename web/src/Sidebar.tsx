// Left rail, like the desktop coding apps: new thread, threads grouped by folder, account + settings.
import { useApp } from './useSettings';
import { ago, fmtTokens, shortPath } from './api';
import { Icon } from './icons';

export function Sidebar({ active, onSelect, onNew, onSettings }: {
  active: string | null; onSelect: (id: string) => void; onNew: () => void; onSettings: () => void;
}) {
  const { threads, me, settings } = useApp();
  const groups = new Map<string, typeof threads>();
  for (const t of threads) groups.set(t.folder, [...(groups.get(t.folder) ?? []), t]);
  const provider = settings?.providers.find((p) => p.id === settings.activeProvider);
  const total = threads.reduce((a, t) => a + t.tokens, 0);

  return (
    <nav className="sidebar">
      <div className="side-brand"><span className="logo" />agent-stage</div>
      <button className="side-new" onClick={onNew}><Icon name="plus" size={13} /> New thread</button>

      <div className="side-scroll">
        {threads.length === 0 && <div className="side-empty">No threads yet. Start one in any folder on your computer.</div>}
        {[...groups].map(([folder, list]) => (
          <div key={folder} className="side-group">
            <div className="side-folder" title={folder}><Icon name="folder" size={12} />{folder.split('/').pop()}<span className="side-path">{shortPath(folder, me?.home)}</span></div>
            {list.map((t) => (
              <button key={t.id} className={`side-thread ${t.id === active ? 'on' : ''}`} onClick={() => onSelect(t.id)}>
                {t.running ? <span className="spin" /> : <span className="side-dot" />}
                <span className="side-title">{t.title}</span>
                <span className="side-ago">{ago(t.updatedAt)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <div className="side-usage"><span>{fmtTokens(total)} tokens</span><span className="muted">· {provider?.name ?? '…'}</span></div>
        <div className="side-account">
          <span className="avatar">{(me?.name ?? '?').slice(0, 1).toUpperCase()}</span>
          <div className="who"><div>{me?.name ?? '…'}</div><div className="muted">Local · this computer</div></div>
          <button className="icon-btn" onClick={onSettings} title="Settings"><Icon name="gear" size={15} /></button>
        </div>
      </div>
    </nav>
  );
}
