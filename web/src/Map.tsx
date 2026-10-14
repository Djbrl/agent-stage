// The project map: folders as columns, files as tiles, one marker that walks to whatever the agent touches.
import type { State } from './useAgent';

const TILE_W = 168, TILE_H = 34, GAP = 10, COL_GAP = 40, HEAD = 34, PAD = 32;

export function ProjectMap({ state }: { state: State }) {
  const groups = new Map<string, string[]>();
  for (const f of Object.keys(state.files).sort()) {
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  const cols = [...groups.entries()].sort(([a], [b]) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));

  const pos: Record<string, { x: number; y: number }> = {};
  cols.forEach(([, files], c) => files.forEach((f, r) => {
    pos[f] = { x: PAD + c * (TILE_W + COL_GAP), y: PAD + HEAD + r * (TILE_H + GAP) };
  }));
  const tallest = Math.max(1, ...cols.map(([, f]) => f.length));
  const width = Math.max(560, PAD * 2 + cols.length * (TILE_W + COL_GAP));
  const height = PAD * 2 + HEAD + tallest * (TILE_H + GAP) + 90;
  pos.$terminal = { x: PAD, y: height - 70 };
  pos.$workspace = { x: PAD + TILE_W + COL_GAP, y: height - 70 };

  const m = state.marker ? pos[state.marker] : null;
  const failing = state.steps.at(-1)?.ok === false;

  return (
    <svg className="map" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMin meet">
      {cols.map(([dir, files], c) => (
        <text key={dir} className="dir" x={PAD + c * (TILE_W + COL_GAP)} y={PAD + 14}>
          {dir === '.' ? 'workspace /' : `${dir} /`}
        </text>
      ))}
      {Object.keys(state.files).map((f) => (
        <g key={f} className={`tile ${state.files[f]} ${state.marker === f ? 'active' : ''}`} transform={`translate(${pos[f].x},${pos[f].y})`}>
          <rect width={TILE_W} height={TILE_H} rx={8} />
          <text x={12} y={22}>{f.split('/').pop()}</text>
        </g>
      ))}
      {(['$terminal', '$workspace'] as const).map((k) => (
        <g key={k} className={`tile special ${state.marker === k ? 'active' : ''}`} transform={`translate(${pos[k].x},${pos[k].y})`}>
          <rect width={TILE_W} height={TILE_H} rx={8} />
          <text x={12} y={22}>{k === '$terminal' ? '▸ terminal' : '⌕ scan workspace'}</text>
        </g>
      ))}
      {m && (
        <g className={`marker ${failing ? 'fail' : ''} ${state.running ? 'live' : ''}`} style={{ transform: `translate(${m.x + TILE_W - 6}px, ${m.y + TILE_H / 2}px)` }}>
          <circle r={14} className="halo" />
          <circle r={7} />
        </g>
      )}
      {Object.keys(state.files).length === 0 && (
        <text className="empty" x={width / 2} y={height / 2 - 30} textAnchor="middle">Empty workspace. Give the agent a task →</text>
      )}
    </svg>
  );
}
