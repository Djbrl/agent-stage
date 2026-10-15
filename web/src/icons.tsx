// Tiny inline icon set (16px, stroke-based) so the UI has no icon dependency.
const P = {
  read: 'M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8Z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  write: 'M3 13h3l7-7-3-3-7 7v3Z M9 4l3 3',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Z M14 14l-3.5-3.5',
  list: 'M5 4h9 M5 8h9 M5 12h9 M2 4h.01 M2 8h.01 M2 12h.01',
  terminal: 'M3 4l4 4-4 4 M8 12h5',
  check: 'M3 8.5l3 3 7-7',
  x: 'M4 4l8 8 M12 4l-8 8',
  stop: 'M4 4h8v8H4z',
  arrow: 'M8 13V3 M4 7l4-4 4 4',
  plus: 'M8 3v10 M3 8h10',
  spark: 'M8 2v3 M8 11v3 M2 8h3 M11 8h3 M4 4l2 2 M10 10l2 2 M4 12l2-2 M10 6l2-2',
  chevron: 'M6 4l4 4-4 4',
  shield: 'M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4l5-2Z',
  play: 'M5 3.5v9l7-4.5z',
  target: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  fit: 'M2.5 6V2.5H6 M10 2.5h3.5V6 M13.5 10v3.5H10 M6 13.5H2.5V10',
  collapse: 'M6 3l5 5-5 5 M2.5 2.5v11',
  sidebar: 'M2.5 3h11v10h-11z M6 3v10',
  map: 'M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5z M6 2.5v9.5 M10 4v9.5',
  folder: 'M2 4.5h4l1.5 1.5H14v6.5H2z',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4',
  undo: 'M5 3L2.5 5.5 5 8 M2.5 5.5H10a3.5 3.5 0 0 1 0 7H6',
  cpu: 'M4 4h8v8H4z M6 1.5v2.5 M10 1.5v2.5 M6 12v2.5 M10 12v2.5 M1.5 6H4 M1.5 10H4 M12 6h2.5 M12 10h2.5',
};
export type IconName = keyof typeof P;

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {P[name].split(' M').map((d, i) => <path key={i} d={i ? `M${d}` : d} />)}
    </svg>
  );
}

export const TOOL_ICON: Record<string, IconName> = {
  list_files: 'list', read_file: 'read', write_file: 'write', edit_file: 'write', search: 'search', run_command: 'terminal', checkpoint: 'shield',
};

const EXT_COLOR: Record<string, string> = {
  js: '#e8c547', ts: '#4f8fe8', tsx: '#4f8fe8', jsx: '#e8c547', json: '#9b8afb', md: '#8b95a5',
  css: '#e46fa6', html: '#ef7d4e', py: '#5aa9e6', txt: '#8b95a5',
};
export function extColor(path: string) {
  return EXT_COLOR[path.split('.').pop() ?? ''] ?? '#8b95a5';
}
