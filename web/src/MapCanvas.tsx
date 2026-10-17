// The project map, after Rundown's: folders circle-packed (stable, no physics), files sized by
// lines and coloured by how recently the agent touched them, one agent marker gliding between
// writes, and a camera that follows the work until you take over. Drawn on a single canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy';
import type { State } from './useAgent';
import { boxOfPts, camToView, isCut, shouldMove, viewFor, viewToCam, DIRECTOR, type Safe } from './director';

type MapFile = { path: string; lines: number; mtime: number };
type MapData = { files: MapFile[]; edges: { from: string; to: string }[] };
type Pt = { x: number; y: number };
type Circle = Pt & { r: number };
type Tree = { name: string; path: string; children?: Tree[]; lines?: number };
type Cam = { x: number; y: number; k: number };

// Colours per theme (Rundown's: "prism" for dark, its default for light). The draw loop picks the palette that
// matches <html data-theme> on every frame, so switching theme needs no reload.
type Pal = {
  hot: string; warm: string; red: string; amber: string; accent: string; ink: string; halo: string; importOut: string; importIn: string;
  read: string; ripple: string; markerRing: string; markerIdle: string; shadow: string;
  line: string; // rgb of the neutral strokes and fills, used with alpha
  text: string; // rgb of secondary labels
  accentRgb: string; readRgb: string;
  folderFill: number; folderStroke: number; folderLabel: number; hub: number; hubLabel: number; fileFill: number; fileStroke: number; labelMid: number; labelLow: number;
};
const PAL: Record<'dark' | 'light', Pal> = {
  dark: {
    hot: '#ff6a2b', warm: '#ffa66e', red: '#ff5c8a', amber: '#ffd66e', accent: '#a9b4ff', ink: '#eef0ff', halo: 'rgba(40,40,90,0.5)',
    importOut: 'rgba(159,208,255,0.8)', importIn: 'rgba(110,231,183,0.8)', read: '#5fd4e6', ripple: '#ffb36b', markerRing: '#1c1c46', markerIdle: '#c9c4ff',
    shadow: 'rgba(5,5,20,0.55)', line: '160,170,255', text: '214,218,255', accentRgb: '169,180,255', readRgb: '95,212,230',
    folderFill: 0.035, folderStroke: 0.2, folderLabel: 0.75, hub: 0.35, hubLabel: 0.75, fileFill: 0.16, fileStroke: 0.32, labelMid: 0.9, labelLow: 0.8,
  },
  light: {
    hot: '#ff5b1f', warm: '#ffa66e', red: '#e11d48', amber: '#a35f00', accent: '#2563eb', ink: '#121214', halo: 'rgba(249,249,247,0.92)',
    importOut: 'rgba(37,99,235,0.7)', importIn: 'rgba(31,157,85,0.7)', read: '#0e8fb0', ripple: '#ff8c50', markerRing: '#ffffff', markerIdle: '#9a9aa3',
    shadow: 'rgba(18,18,20,0.18)', line: '18,18,20', text: '18,18,20', accentRgb: '37,99,235', readRgb: '14,143,176',
    folderFill: 0.03, folderStroke: 0.1, folderLabel: 0.62, hub: 0.22, hubLabel: 0.6, fileFill: 0.1, fileStroke: 0.16, labelMid: 0.8, labelLow: 0.64,
  },
};
let C: Pal = PAL.dark;
export const mapPalette = () => PAL[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;
const GLIDE = 650, RIPPLE = 700, ERROR_MS = 2600, SIGHT = 1500, TWEEN = 650, MOVE = 700;
const radius = (lines: number) => Math.min(22, 3.5 + Math.sqrt(lines) * 0.55);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], t))).join(',')})`;
}

// ── layout ──────────────────────────────────────────────────────────────────
function buildTree(files: MapFile[]): Tree {
  const root: Tree = { name: '', path: '', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) { node.children!.push({ name: part, path: f.path, lines: f.lines }); return; }
      let next = node.children!.find((c) => c.children && c.name === part);
      if (!next) { next = { name: part, path: parts.slice(0, i + 1).join('/'), children: [] }; node.children!.push(next); }
      node = next;
    });
  }
  // A folder whose only child is a folder becomes one circle: "web" + "src" → "web/src".
  const merge = (t: Tree): Tree => {
    if (!t.children) return t;
    let n = t;
    while (n.path && n.children && n.children.length === 1 && n.children[0].children) {
      const c = n.children[0];
      n = { name: `${n.name}/${c.name}`, path: c.path, children: c.children };
    }
    return { ...n, children: n.children!.map(merge) };
  };
  return merge(root);
}

function layout(files: MapFile[]) {
  const root = hierarchy(buildTree(files))
    .sum((d) => (d.children ? 0 : 1))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.data.name.localeCompare(b.data.name));
  // Reserve a little more room than the dot needs, so small edits don't re-layout.
  pack<Tree>().radius((d) => Math.ceil(radius(d.data.lines ?? 1) * 1.15) + 4).padding((d) => (d.children ? 9 : 0))(root);
  const nodes = root.descendants() as HierarchyCircularNode<Tree>[];
  const files_: Record<string, Circle> = {};
  const folders: Array<Circle & { name: string; depth: number }> = [];
  for (const n of nodes) {
    if (n.data.children) { if (n.depth > 0) folders.push({ x: n.x, y: n.y, r: n.r, name: n.data.name, depth: n.depth }); }
    else files_[n.data.path] = { x: n.x, y: n.y, r: radius(n.data.lines ?? 1) };
  }
  const R = Math.max(nodes[0]?.r ?? 40, 40);
  const cx = nodes[0]?.x ?? 0, cy = nodes[0]?.y ?? 0;
  // "Islands" outside the project for things that aren't files.
  const islands: Record<string, Circle & { label: string }> = {
    $workspace: { x: cx + R + 60, y: cy - 30, r: 11, label: 'scan & search' },
    $terminal: { x: cx + R + 60, y: cy + 30, r: 11, label: 'terminal' },
    $browser: { x: cx + R + 60, y: cy + 90, r: 11, label: 'browser' },
  };
  return { files: files_, folders, islands, root: { x: cx, y: cy, r: R }, bounds: { x: cx - R, y: cy - R, w: 2 * R + 160, h: 2 * R } };
}

// ── component ───────────────────────────────────────────────────────────────
export type MapApi = { fit: () => void; follow: () => void };

export function ProjectMap({ state, onSelect, selected, mapUrl, insets, readmap, following, onFollowChange, api, lit = [] }: {
  state: State; onSelect: (path: string) => void; selected: string | null; mapUrl: string;
  insets: { right: number; bottom: number; top: number; left?: number }; readmap: boolean;
  following: boolean; onFollowChange: (f: boolean) => void; api?: { current: MapApi | null }; lit?: string[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<MapData>({ files: [], edges: [] });
  const setFollowing = onFollowChange;
  const live = useRef({ state, selected, following, data, onSelect, insets, lit });
  live.current = { state, selected, following, data, onSelect, insets, lit };

  // Re-read the map whenever the agent finishes a step, or an Undo puts files back.
  const doneSteps = state.steps.filter((s) => s.endedAt).length;
  useEffect(() => {
    fetch(mapUrl).then((r) => r.json()).then(setData).catch(() => {});
  }, [doneSteps, state.running, state.undone.length, mapUrl]);

  const layoutKey = data.files.map((f) => `${f.path}:${Math.ceil(radius(f.lines) * 1.15)}`).join('|');
  const lay = useMemo(() => layout(data.files), [layoutKey]);

  const target = useMemo(() => {
    for (let i = state.steps.length - 1; i >= 0; i--) {
      const s = state.steps[i];
      if (s.name === 'write_file' || s.name === 'edit_file') return s.target;
      if ((s.name === 'run_command' || s.name === 'open_on_computer') && i === state.steps.length - 1) return '$terminal';
      if (s.name.startsWith('browser_') && i === state.steps.length - 1) return '$browser';
      if ((s.name === 'list_files' || s.name === 'search') && i === state.steps.length - 1) return '$workspace';
    }
    return state.steps.length ? '$workspace' : null;
  }, [state.steps]);

  // Mutable animation state, shared with the draw loop.
  const v = useRef({
    cam: { x: 0, y: 0, k: 1 } as Cam, camAnim: null as null | { from: Cam; to: Cam; t0: number },
    fitted: false, w: 0, h: 0, hover: null as string | null, userAt: 0,
    pos: {} as Record<string, Circle>, tween: null as null | { from: Record<string, Circle>; t0: number },
    marker: null as null | { from: Pt; to: Pt; t0: number; target: string },
    ripples: {} as Record<string, number>, lastChange: {} as Record<string, number>,
    lay: lay, target: target as string | null,
    fitAll: () => {},
    fitNow: () => {},
  }).current;

  // New layout → glide files to their new places.
  if (v.lay !== lay) {
    v.tween = Object.keys(v.pos).length ? { from: { ...v.pos }, t0: performance.now() } : null;
    v.lay = lay;
  }
  v.target = target;

  // Edits → ripple once, and remember when (drives the hot → warm colour). Rebuilt from the steps each
  // time, so rewinding a replay un-colours files that hadn't been touched yet.
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const s of state.steps) if (s.change && s.endedAt) next[s.target] = s.endedAt;
    for (const [path, at] of Object.entries(next)) if (v.lastChange[path] !== at) v.ripples[path] = performance.now();
    v.lastChange = next;
    if (!state.steps.length) { v.ripples = {}; v.marker = null; }
  }, [state.steps]);

  // ── draw loop + input (mounted once) ──────────────────────────────────────
  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext('2d')!;
    let raf = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      const r = wrap.current!.getBoundingClientRect();
      v.w = r.width; v.h = r.height;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
      // Panel sizes settle after first paint: keep re-fitting until the user takes the camera.
      if (v.fitted && !v.userAt && !live.current.state.running) v.cam = fit(v.lay.bounds);
    };
    const safe = (): Safe => ({ w: v.w, h: v.h, left: live.current.insets.left ?? 0, top: live.current.insets.top, right: live.current.insets.right, bottom: live.current.insets.bottom });
    // Fit a box into the part of the canvas no floating panel covers.
    const fit = (b: { x: number; y: number; w: number; h: number }, pad = 48): Cam => {
      const s = safe(), w = s.w - s.left - s.right, h = s.h - s.top - s.bottom;
      const k = clamp(Math.min((w - pad * 2) / Math.max(b.w, 60), (h - pad * 2) / Math.max(b.h, 60)), 0.3, 3);
      return viewToCam({ x: b.x + b.w / 2, y: b.y + b.h / 2, k }, s);
    };
    const moveTo = (to: Cam) => { v.camAnim = { from: { ...v.cam }, to, t0: performance.now() }; };
    v.fitAll = () => { if (Object.keys(v.lay.files).length) moveTo(fit(v.lay.bounds)); };
    v.fitNow = () => { if (v.w) { v.camAnim = null; v.cam = fit(v.lay.bounds); v.fitted = true; } };
    if (api) api.current = { fit: () => { takeOver(); v.fitAll(); }, follow: () => { v.userAt = 0; setFollowing(true); lastDirect = 0; outSince = 1; } };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current!);
    resize();
    const where = (key: string): Circle | undefined => v.pos[key] ?? v.lay.files[key] ?? v.lay.islands[key];

    // The director: frame the area of the agent's last few moves; hold still while the marker stays in the
    // middle of the view; wait a beat so a burst of edits lands as one move; glide short moves, cut long ones.
    let lastDirect = 0, outSince = 0, busyUntil = 0;
    const cutTo = (to: Cam) => {
      cv.style.opacity = '0.25';
      busyUntil = performance.now() + 450;
      setTimeout(() => { v.camAnim = null; v.cam = to; cv.style.opacity = '1'; }, 180);
    };
    const direct = (now: number) => {
      if (!live.current.following || !v.marker || !live.current.state.running || now - lastDirect < 150 || v.camAnim || now < busyUntil) return;
      lastDirect = now;
      const st = live.current.state;
      const recent: string[] = [];
      for (let i = st.steps.length - 1; i >= 0 && recent.length < 4; i--) {
        const t = st.steps[i].target;
        if ((st.steps[i].change || t.startsWith('$')) && !recent.includes(t)) recent.push(t);
      }
      const pts = [v.marker.to, ...recent.map((t) => where(t)).filter(Boolean).map((c) => ({ x: c!.x, y: c!.y }))];
      const box = boxOfPts(pts);
      if (!box) return;
      const s = safe(), cur = camToView(v.cam, s), want = viewFor(box, s);
      if (!shouldMove(cur, s, [v.marker.to], want)) { outSince = 0; return; }
      if (!outSince) outSince = now;
      if (now - outSince < DIRECTOR.settleMs) return;
      outSince = 0;
      const to = viewToCam(want, s);
      if (isCut(cur, want, s)) cutTo(to); else moveTo(to);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { state: st, selected: sel, data } = live.current;
      const lay = v.lay;

      if (!v.fitted && Object.keys(lay.files).length && v.w) { v.cam = fit(lay.bounds); v.fitted = true; }
      if (v.tween) {
        const t = ease(clamp((now - v.tween.t0) / TWEEN, 0, 1));
        const next: Record<string, Circle> = {};
        for (const [key, c] of Object.entries(lay.files)) {
          const a = v.tween.from[key] ?? { ...c, r: 0 };
          next[key] = { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t), r: lerp(a.r, c.r, t) };
        }
        v.pos = next;
        if (t >= 1) v.tween = null;
      } else v.pos = lay.files;
      if (v.camAnim) {
        const t = ease(clamp((now - v.camAnim.t0) / MOVE, 0, 1)), { from, to } = v.camAnim;
        const k = Math.exp(lerp(Math.log(from.k), Math.log(to.k), t));
        const c0 = { x: (v.w / 2 - from.x) / from.k, y: (v.h / 2 - from.y) / from.k };
        const c1 = { x: (v.w / 2 - to.x) / to.k, y: (v.h / 2 - to.y) / to.k };
        const cx = lerp(c0.x, c1.x, t), cy = lerp(c0.y, c1.y, t);
        v.cam = { k, x: v.w / 2 - cx * k, y: v.h / 2 - cy * k };
        if (t >= 1) v.camAnim = null;
      }

      const tgt = v.target ? where(v.target) : undefined;
      if (tgt && (!v.marker || v.marker.target !== v.target)) {
        const cur = v.marker ? markerPos(v.marker, now) : tgt;
        v.marker = { from: cur, to: { x: tgt.x, y: tgt.y }, t0: now, target: v.target! };
      } else if (tgt && v.marker) v.marker.to = { x: tgt.x, y: tgt.y };
      direct(now);

      C = mapPalette();
      const { k, x, y } = v.cam;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, v.w, v.h);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
      const px = 1 / k;

      // folders
      for (const f of lay.folders) {
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        if (f.depth <= 2) { ctx.fillStyle = rgba(C.line, C.folderFill); ctx.fill(); }
        ctx.strokeStyle = rgba(C.line, C.folderStroke); ctx.lineWidth = px; ctx.stroke();
        if (f.r * k > 46) label(ctx, f.name.toUpperCase(), f.x, f.y - f.r + 15 * px, px, 9.5, rgba(C.text, C.folderLabel), 'center', 600);
      }

      // islands
      for (const [key, is] of Object.entries(lay.islands)) {
        ctx.beginPath(); ctx.arc(is.x, is.y, is.r, 0, Math.PI * 2);
        ctx.setLineDash([2 * px, 3 * px]); ctx.strokeStyle = rgba(C.line, C.hub); ctx.lineWidth = px; ctx.stroke(); ctx.setLineDash([]);
        const on = v.marker?.target === key;
        label(ctx, is.label, is.x + is.r + 7 * px, is.y + 3.5 * px, px, 10.5, on ? C.ink : rgba(C.text, C.hubLabel), 'left', 500);
      }

      // import lines, only for the hovered/selected file
      const focus = v.hover ?? sel;
      if (focus) for (const e of data.edges) {
        const out = e.from === focus, inn = e.to === focus;
        if (!out && !inn) continue;
        const a = v.pos[e.from], b = v.pos[e.to];
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2 - (b.y - a.y) * 0.12, (a.y + b.y) / 2 + (b.x - a.x) * 0.12, b.x, b.y);
        ctx.strokeStyle = out ? C.importOut : C.importIn; ctx.lineWidth = 1.6 * px; ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.6 * px, 0, Math.PI * 2); ctx.fillStyle = out ? C.importOut : C.importIn; ctx.fill();
      }

      // trail: last 7 writes, curved, fading in toward the marker
      const writes = st.steps.filter((s) => s.change).map((s) => s.target);
      const trail: Pt[] = writes.filter((p, i) => p !== writes[i - 1]).slice(-7).map((p) => v.pos[p]).filter(Boolean);
      if (!st.running) trail.length = 0; // the trail only means something while the agent is moving
      if (v.marker && trail.length) trail.push(markerPos(v.marker, now));
      for (let i = 1; i < trail.length; i++) {
        const w = i / (trail.length - 1), a = trail[i - 1], b = trail[i];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, b.x, b.y);
        ctx.strokeStyle = rgba(C.accentRgb, 0.08 + 0.4 * w); ctx.lineWidth = (1.2 + 1.6 * w) * px; ctx.stroke();
      }

      // reads: dotted line of sight from the marker, fading over 1.5s (last 4)
      if (v.marker) {
        const m = markerPos(v.marker, now);
        for (const r of st.steps.filter((s) => s.name === 'read_file' && s.endedAt && Date.now() - s.endedAt < SIGHT).slice(-4)) {
          const p = v.pos[r.target];
          if (!p) continue;
          const a = 1 - (Date.now() - r.endedAt!) / SIGHT;
          ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(p.x, p.y);
          ctx.setLineDash([2 * px, 4 * px]); ctx.strokeStyle = rgba(C.readRgb, 0.75 * a); ctx.lineWidth = 1.4 * px; ctx.stroke(); ctx.setLineDash([]);
        }
      }

      // files
      const labels: Array<{ text: string; x: number; y: number; pri: number; strong: boolean }> = [];
      for (const [path, c] of Object.entries(v.pos)) {
        const status = st.files[path];
        const changedAt = v.lastChange[path];
        let col = '';
        if (status === 'error') col = C.red;
        else if (changedAt && status === 'written') { // an Undo sets it back to idle
          const age = Date.now() - changedAt;
          col = age < 300_000 ? mix(C.hot, C.warm, Math.pow(age / 300_000, 1.5)) : C.warm;
        } else if (status === 'read') col = C.read;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        if (col) { ctx.fillStyle = col; ctx.fill(); }
        else { ctx.fillStyle = rgba(C.line, C.fileFill); ctx.fill(); ctx.strokeStyle = rgba(C.line, C.fileStroke); ctx.lineWidth = px; ctx.stroke(); }
        if (path === sel || path === v.hover) { ctx.strokeStyle = C.ink; ctx.lineWidth = (path === sel ? 1.6 : 1.1) * px; ctx.stroke(); }
        if (live.current.lit.includes(path)) {
          const t = (now % 1200) / 1200;
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r + (4 + 6 * t) * px, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(C.text, 0.9 - 0.6 * t); ctx.lineWidth = 2 * px; ctx.stroke();
        }
        if (st.planned.includes(path)) {
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 5 * px, 0, Math.PI * 2);
          ctx.setLineDash([3 * px, 3 * px]); ctx.lineDashOffset = -now / 60 * px;
          ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6 * px; ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
        }

        const rip = v.ripples[path];
        if (rip && now - rip < RIPPLE) {
          const t = (now - rip) / RIPPLE;
          ring(ctx, c, c.r + (3 + easeOut(t) * 26) * px, C.ripple, (1 - t) * 0.75, 2 * px);
        }
        const active = v.marker?.target === path;
        const pri = path === sel || path === v.hover || live.current.lit.includes(path) ? 4 : active ? 3 : changedAt ? 2 : k > 1.5 && c.r * k > 7 ? 1 : 0;
        if (pri > 0) labels.push({ text: path.split('/').pop()!, x: c.x + c.r + 5 * px, y: c.y + 4 * px, pri, strong: pri >= 3 });
      }

      // planned-but-not-yet-created files: ghost dots on the right edge of the project, labelled
      st.planned.filter((p) => !v.pos[p]).forEach((p, i) => {
        const empty = !Object.keys(v.pos).length;
        const gx = empty ? lay.root.x - 30 : lay.root.x + lay.root.r * 0.75, gy = (empty ? lay.root.y - 20 : lay.root.y - lay.root.r * 0.6) + i * 22;
        ctx.beginPath(); ctx.arc(gx, gy, 6, 0, Math.PI * 2);
        ctx.setLineDash([2 * px, 3 * px]); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.4 * px; ctx.stroke(); ctx.setLineDash([]);
        labels.push({ text: `${p} (planned)`, x: gx + 10, y: gy + 4 * px, pri: 3, strong: false });
      });

      // labels, highest priority first, skipping collisions (screen space)
      const taken: Array<[number, number, number, number]> = [];
      const dots: Array<[number, number, number, number]> = Object.values(v.pos).map((c) => { const sx = c.x * k + x, sy = c.y * k + y, r = c.r * k; return [sx - r, sy - r, sx + r, sy + r]; });
      for (const l of labels.sort((a, b) => b.pri - a.pri)) {
        ctx.font = `${l.strong ? 600 : 500} ${12 * px}px Inter, system-ui, sans-serif`;
        const w = ctx.measureText(l.text).width * k, sx = l.x * k + x, sy = l.y * k + y;
        const box: [number, number, number, number] = [sx - 2, sy - 12, sx + w + 2, sy + 4];
        const hits = (b: [number, number, number, number]) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1];
        if (taken.some(hits) || (l.pri < 2 && dots.some(hits))) continue;
        taken.push(box);
        label(ctx, l.text, l.x, l.y, px, 11.5, l.strong ? C.ink : l.pri >= 2 ? rgba(C.text, C.labelMid) : rgba(C.text, C.labelLow), 'left', l.strong ? 600 : 500);
      }

      // agent marker + one ring (error > waiting > thinking)
      if (v.marker) {
        const m = markerPos(v.marker, now);
        const last = st.steps.at(-1);
        const err = Boolean(last?.ok === false && last.endedAt && Date.now() - last.endedAt < ERROR_MS);
        const waiting = Boolean(st.approval) || st.timeline.some((t) => t.kind === 'checkpoint' && !t.answer);
        const busy = last && last.endedAt === undefined;
        const thinking = st.running && !busy && !waiting;
        if (err) {
          const t = (now % 1100) / 1100;
          ring(ctx, m, (10 + 26 * easeOut(t)) * px, C.red, 0.8 * (1 - t), 2.4 * px);
        } else if (waiting) {
          const b = (now % 1800) / 1800;
          ring(ctx, m, (11 + b * 9) * px, C.amber, Math.sin(b * Math.PI) * 0.85, 2 * px);
        } else if (thinking) {
          const b = (now % 2400) / 2400;
          ring(ctx, m, (11 + b * 9) * px, C.accent, Math.sin(b * Math.PI) * 0.7, 2 * px);
        }
        ctx.save();
        ctx.shadowColor = C.shadow; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
        ctx.beginPath(); ctx.arc(m.x, m.y, (st.running || err || waiting ? 9 : 6) * px, 0, Math.PI * 2);
        ctx.fillStyle = err ? C.red : st.running ? C.accent : mix(C.accent, C.markerIdle, 0.55); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = C.markerRing; ctx.lineWidth = 3 * px; ctx.stroke();
        const doing: Record<string, string> = { read_file: 'Reading…', write_file: 'Writing…', edit_file: 'Editing…', run_command: 'Running…', search: 'Searching…', list_files: 'Scanning…' };
        const verb = waiting ? 'Waiting for you' : err ? 'Failed' : !st.running ? 'Idle' : busy ? doing[last!.name] ?? 'Working…' : 'Thinking…';
        if (st.running || err || waiting) label(ctx, `Agent · ${verb}`, m.x + 12 * px, m.y - 13 * px, px, 12, err ? C.red : waiting ? C.amber : C.ink, 'left', 600);
      }
      drawReadmap(now);
    };

    // Readmap: the whole project at a glance, lit by what the agent READS (the big camera follows edits).
    // The rectangle is the main camera's view, so it doubles as a minimap.
    const drawReadmap = (now: number) => {
      const mc = mini.current;
      if (!mc || !mc.offsetParent) return;
      const W = 200, H = 140, mctx = mc.getContext('2d')!;
      if (mc.width !== W * dpr) { mc.width = W * dpr; mc.height = H * dpr; }
      const { state: st } = live.current;
      const b = v.lay.bounds, pad = 10;
      const k = Math.min((W - pad * 2) / Math.max(b.w, 40), (H - pad * 2) / Math.max(b.h, 40));
      const ox = W / 2 - (b.x + b.w / 2) * k, oy = H / 2 - (b.y + b.h / 2) * k;
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, W, H);
      mctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
      const reads = st.steps.filter((x) => x.name === 'read_file' || x.name === 'search' || x.name === 'list_files');
      const readAt: Record<string, number> = {};
      reads.forEach((x, i) => { if (x.name === 'read_file') readAt[x.target] = i; });
      for (const f of v.lay.folders) {
        mctx.beginPath(); mctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        mctx.strokeStyle = rgba(C.line, C.folderStroke); mctx.lineWidth = 1 / k; mctx.stroke();
      }
      const lastRead = [...st.steps].reverse().find((x) => x.name === 'read_file')?.target;
      for (const [path, c] of Object.entries(v.pos)) {
        const r = readAt[path];
        mctx.beginPath(); mctx.arc(c.x, c.y, Math.max(c.r, 2.5 / k), 0, Math.PI * 2);
        mctx.fillStyle = r === undefined ? rgba(C.line, 0.3) : rgba(C.readRgb, 0.45 + 0.55 * ((r + 1) / reads.length));
        mctx.fill();
        if (path === lastRead) {
          const t = (now % 1400) / 1400;
          mctx.beginPath(); mctx.arc(c.x, c.y, c.r + (3 + 10 * t) / k, 0, Math.PI * 2);
          mctx.strokeStyle = rgba(C.readRgb, 0.8 * (1 - t)); mctx.lineWidth = 1.5 / k; mctx.stroke();
        }
      }
      // main camera's view
      const vx = -v.cam.x / v.cam.k, vy = -v.cam.y / v.cam.k;
      mctx.strokeStyle = rgba(C.text, 0.5); mctx.lineWidth = 1 / k;
      mctx.strokeRect(vx, vy, v.w / v.cam.k, v.h / v.cam.k);
      const wrote = st.steps.filter((x) => x.change).length;
      const el = mc.parentElement?.querySelector('.rm-count');
      if (el) el.textContent = `read ${reads.length} · wrote ${wrote}`;
    };
    raf = requestAnimationFrame(frame);

    // ── input: wheel zoom about the cursor, drag to pan, click to select ───
    const toWorld = (sx: number, sy: number) => ({ x: (sx - v.cam.x) / v.cam.k, y: (sy - v.cam.y) / v.cam.k });
    const takeOver = () => { v.userAt = Date.now(); v.camAnim = null; setFollowing(false); };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); takeOver();
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const f = Math.pow(2, -e.deltaY * 0.002 * (e.ctrlKey ? 10 : 1));
      const k = clamp(v.cam.k * f, 0.2, 8), p = toWorld(sx, sy);
      v.cam = { k, x: sx - p.x * k, y: sy - p.y * k };
    };
    let drag: null | { x: number; y: number; cx: number; cy: number; moved: boolean } = null;
    const hit = (sx: number, sy: number) => {
      const p = toWorld(sx, sy);
      let best: string | null = null, bd = Infinity;
      for (const [path, c] of Object.entries(v.pos)) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < Math.max(c.r, 6 / v.cam.k) && d < bd) { best = path; bd = d; }
      }
      return best;
    };
    const onDown = (e: MouseEvent) => { drag = { x: e.clientX, y: e.clientY, cx: v.cam.x, cy: v.cam.y, moved: false }; };
    const onMove = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { takeOver(); drag.moved = true; }
        if (drag.moved) v.cam = { ...v.cam, x: drag.cx + dx, y: drag.cy + dy };
      }
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      v.hover = inside ? hit(e.clientX - r.left, e.clientY - r.top) : null;
      if (inside) cv.style.cursor = drag?.moved ? 'grabbing' : v.hover ? 'pointer' : 'grab';
    };
    const onUp = (e: MouseEvent) => {
      if (drag && !drag.moved) {
        const r = cv.getBoundingClientRect(), h = hit(e.clientX - r.left, e.clientY - r.top);
        if (h) live.current.onSelect(h);
      }
      drag = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'f' || e.key === 'F') { v.userAt = 0; setFollowing(true); }
      if (e.key === '0') { takeOver(); v.fitAll(); }
    };
    const idle = setInterval(() => { if (!live.current.following && v.userAt && Date.now() - v.userAt > DIRECTOR.idleMs) { v.userAt = 0; setFollowing(true); } }, 5000);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); clearInterval(idle);
      cv.removeEventListener('wheel', onWheel); cv.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // First real layout → fit it straight away (don't wait for an animation frame).
  useEffect(() => { if (!v.fitted) v.fitNow(); }, [lay]);
  useEffect(() => { const t = setTimeout(() => { if (!v.userAt && !state.running) v.fitNow(); }, 450); return () => clearTimeout(t); }, [lay, state.running]);
  // A panel opened over the map (steps sheet): glide the framing into the space that's left.
  useEffect(() => { if (v.fitted && !v.userAt && !state.running) v.fitAll(); }, [insets.right, insets.left]);

  // Following again with no agent on the map → show the whole project.
  useEffect(() => { if (following && !v.marker) v.fitAll(); }, [following]);

  return (
    <div className="map-wrap" ref={wrap}>
      <canvas ref={canvas} />
      {data.files.length === 0 && !state.planned.length && <div className="map-empty">Empty workspace. Give the agent a task to start.</div>}
      {readmap && Object.keys(lay.files).length > 0 && (
        <div className="readmap" title="Lit by what the agent reads. The box is your view.">
          <div className="rm-head"><span>Reads</span><span className="rm-count mono" /></div>
          <canvas ref={mini} style={{ width: 200, height: 140 }} />
        </div>
      )}
    </div>
  );
}

function markerPos(m: { from: Pt; to: Pt; t0: number }, now: number): Pt {
  const t = ease(clamp((now - m.t0) / GLIDE, 0, 1));
  return { x: lerp(m.from.x, m.to.x, t), y: lerp(m.from.y, m.to.y, t) };
}

function ring(ctx: CanvasRenderingContext2D, p: Pt, r: number, color: string, alpha: number, width: number) {
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.globalAlpha = Math.max(0, alpha); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.globalAlpha = 1;
}

// Text sized in screen pixels, with a dark halo so it reads over lines and dots.
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, size: number, color: string, align: CanvasTextAlign, weight: number) {
  ctx.font = `${weight} ${size * px}px Inter, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.halo; ctx.lineWidth = 2.5 * px; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
