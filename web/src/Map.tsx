// The project map: folders as columns of file cards, plus the agent marker and a fading trail of where it has been.
import type { State } from './useAgent';
import { lineDiff, diffStats } from './diff';
import { Icon, extColor } from './icons';

const W = 196, H = 40, GAP = 10, COL = 44, HEAD = 30, PAD = 40;

export function ProjectMap({ state, onSelect, selected }: { state: State; onSelect: (path: string) => void; selected: string | null }) {
  const groups = new Map<string, string[]>();
  for (const f of Object.keys(state.files).sort()) {
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  const cols = [...groups.entries()].sort(([a], [b]) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));

  const pos: Record<string, { x: number; y: number }> = {};
  cols.forEach(([, files], c) => files.forEach((f, r) => {
    pos[f] = { x: PAD + c * (W + COL), y: PAD + HEAD + r * (H + GAP) };
  }));
  const tallest = Math.max(2, ...cols.map(([, f]) => f.length));
  const width = Math.max(720, PAD * 2 + Math.max(2, cols.length) * (W + COL) - COL);
  const sysY = PAD + HEAD + tallest * (H + GAP) + 36;
  const height = sysY + H + PAD;
  pos.$workspace = { x: PAD, y: sysY };
  pos.$terminal = { x: PAD + W + COL, y: sysY };

  const center = (k: string) => pos[k] && { x: pos[k].x + W / 2, y: pos[k].y + H / 2 };
  const trail = state.trail.map(center).filter(Boolean) as { x: number; y: number }[];
  const m = state.marker ? pos[state.marker] : null;
  const lastStep = state.steps.at(-1);
  const failing = lastStep?.ok === false;
  const verb = !lastStep ? '' : lastStep.endedAt === undefined
    ? { read_file: 'reading', write_file: 'writing', edit_file: 'editing', run_command: 'running', search: 'searching', list_files: 'scanning' }[lastStep.name] ?? 'working'
    : failing ? 'failed' : 'done';

  return (
    <svg className="map" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {cols.map(([dir], c) => (
        <text key={dir} className="dir" x={PAD + c * (W + COL)} y={PAD + 12}>{dir === '.' ? '/' : `/${dir}`}</text>
      ))}
      <text className="dir" x={PAD} y={sysY - 14}>system</text>

      {trail.length > 1 && (
        <polyline className="trail" points={trail.map((p) => `${p.x},${p.y}`).join(' ')} />
      )}

      {Object.keys(state.files).map((f) => {
        const ch = state.changes[f];
        const st = ch && diffStats(lineDiff(ch.before, ch.after));
        const name = f.split('/').pop()!;
        const ext = name.includes('.') ? name.split('.').pop()!.slice(0, 4) : '·';
        return (
          <g key={f} className={`card ${state.files[f]} ${state.marker === f ? 'active' : ''} ${selected === f ? 'selected' : ''}`}
            transform={`translate(${pos[f].x},${pos[f].y})`} onClick={() => onSelect(f)}>
            <rect width={W} height={H} rx={8} />
            <rect x={10} y={12} width={26} height={16} rx={4} className="ext" style={{ fill: extColor(f) }} />
            <text x={23} y={23.5} className="ext-label" textAnchor="middle">{ext.toUpperCase()}</text>
            <text x={46} y={24.5} className="name">{name.length > 17 ? name.slice(0, 16) + '…' : name}</text>
            {st && (st.add || st.del) ? (
              <text x={W - 10} y={24.5} textAnchor="end" className="stat">
                <tspan className="add">+{st.add}</tspan>{st.del ? <tspan className="del"> −{st.del}</tspan> : null}
              </text>
            ) : state.files[f] === 'error' ? <text x={W - 10} y={24.5} textAnchor="end" className="stat del">failed</text> : null}
          </g>
        );
      })}

      {(['$workspace', '$terminal'] as const).map((k) => (
        <g key={k} className={`card system ${state.marker === k ? 'active' : ''}`} transform={`translate(${pos[k].x},${pos[k].y})`}>
          <rect width={W} height={H} rx={8} />
          <g transform="translate(14,13)" className="sys-icon"><Icon name={k === '$terminal' ? 'terminal' : 'search'} /></g>
          <text x={38} y={24.5} className="name">{k === '$terminal' ? 'Terminal' : 'Scan & search'}</text>
        </g>
      ))}

      {m && (
        <g className={`agent ${failing ? 'fail' : ''} ${state.running ? 'live' : ''}`} style={{ transform: `translate(${m.x + W + 2}px, ${m.y + H / 2}px)` }}>
          <circle r={16} className="ring" />
          <circle r={9} className="core" />
          <g transform="translate(16,-30)">
            <rect className="bubble" width={verb.length * 7 + 20} height={22} rx={11} />
            <text className="bubble-text" x={10} y={15}>{verb}</text>
          </g>
        </g>
      )}

      {Object.keys(state.files).length === 0 && (
        <text className="empty" x={width / 2} y={PAD + 70} textAnchor="middle">Empty workspace. Give the agent a task to start.</text>
      )}
    </svg>
  );
}
