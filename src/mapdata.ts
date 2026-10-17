// What the map needs from disk: every file with its size, and which files import which.
// Imports never move anything on the map; they only draw lines on hover.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, dirname, posix } from 'node:path';

export type MapFile = { path: string; lines: number; mtime: number };
export type MapData = { files: MapFile[]; edges: { from: string; to: string }[] };

const CODE = /\.(m?[jt]sx?|py|css|html|json|md)$/;
const SPEC = [
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+(\.[\w.]*)\s+import/gm, // python relative
];
// Generated or installed, not written by anyone: hidden from the map (and from the file list the agent sees).
const GENERATED = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', 'venv', 'target']);
export const isGenerated = (name: string) => name.startsWith('.') || GENERATED.has(name) || /\.(pyc|pyo|map)$/.test(name);
const TRY = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '/index.ts', '/index.tsx', '/index.js'];

async function walk(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (isGenerated(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

export async function buildMap(root: string, cap = 400): Promise<MapData> {
  const paths = (await walk(root)).slice(0, cap);
  const set = new Set(paths);
  const files: MapFile[] = [];
  const edges: MapData['edges'] = [];
  for (const p of paths) {
    const full = join(root, p);
    const st = await stat(full);
    let text = '';
    if (st.size < 512_000) text = await readFile(full, 'utf8').catch(() => '');
    files.push({ path: p, lines: text ? text.split('\n').length : 1, mtime: st.mtimeMs });
    if (!CODE.test(p) || !text) continue;
    const seen = new Set<string>();
    for (const re of SPEC) for (const [, spec] of text.matchAll(re)) {
      if (!spec.startsWith('.')) continue;
      const base = spec.startsWith('.') && /^\.+\w/.test(spec) && p.endsWith('.py')
        ? posix.join(dirname(p), '../'.repeat(spec.match(/^\.+/)![0].length - 1), spec.replace(/^\.+/, '').replace(/\./g, '/'))
        : posix.join(dirname(p), spec);
      const hit = TRY.map((x) => posix.normalize(base + x)).find((c) => set.has(c));
      if (hit && hit !== p && !seen.has(hit)) { seen.add(hit); edges.push({ from: p, to: hit }); }
    }
  }
  return { files, edges };
}
