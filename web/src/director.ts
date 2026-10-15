// The director: what the camera frames and when (the same rules as Rundown's director). It frames the work, not a
// point: the area of the agent's last few moves, at a zoom chosen from how spread out they are. It holds still while
// the marker stays in the middle of the view (the dead zone), glides for a short move and cuts for a long one.
export type P = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** Canvas size in CSS px and how much of each side is covered by floating UI. */
export type Safe = { w: number; h: number; left: number; top: number; right: number; bottom: number };
/** Camera as a centre point in world units + zoom. */
export type View = { x: number; y: number; k: number };

export const DIRECTOR = { dead: 0.6, fit: 0.42, minK: 0.9, maxK: 2.2, around: 60, cut: 1.2, zoomOff: 2.2, settleMs: 450, idleMs: 60_000 };

export function boxOfPts(pts: P[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
const middle = (s: Safe, f: number) => ({ w: Math.max(60, s.w - s.left - s.right) * f, h: Math.max(60, s.h - s.top - s.bottom) * f });
const safeCenter = (s: Safe) => ({ x: s.left + (s.w - s.left - s.right) / 2, y: s.top + (s.h - s.top - s.bottom) / 2 });

export function viewFor(box: Box, s: Safe, o = DIRECTOR): View {
  const m = middle(s, o.fit);
  const k = Math.max(o.minK, Math.min(o.maxK, m.w / Math.max(2 * o.around, box.x1 - box.x0), m.h / Math.max(2 * o.around, box.y1 - box.y0)));
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, k };
}
export const toScreen = (v: View, s: Safe, p: P) => { const c = safeCenter(s); return { x: c.x + (p.x - v.x) * v.k, y: c.y + (p.y - v.y) * v.k }; };
export function inDeadZone(v: View, s: Safe, pts: P[], o = DIRECTOR) {
  const m = middle(s, o.dead), c = safeCenter(s);
  return pts.every((p) => { const q = toScreen(v, s, p); return Math.abs(q.x - c.x) <= m.w / 2 && Math.abs(q.y - c.y) <= m.h / 2; });
}
export function shouldMove(v: View, s: Safe, markers: P[], want: View, o = DIRECTOR) {
  if (!markers.length) return false;
  return !inDeadZone(v, s, markers, o) || v.k * o.zoomOff < want.k;
}
export function isCut(from: View, to: View, s: Safe, o = DIRECTOR) {
  const diag = Math.hypot(s.w - s.left - s.right, s.h - s.top - s.bottom);
  return Math.hypot(to.x - from.x, to.y - from.y) * Math.min(from.k, to.k) > o.cut * diag || Math.max(from.k / to.k, to.k / from.k) > 3;
}
// Our canvas camera is a translate (x, y) + scale k; convert to/from a centred View for the safe area.
export const camToView = (c: { x: number; y: number; k: number }, s: Safe): View => { const m = safeCenter(s); return { x: (m.x - c.x) / c.k, y: (m.y - c.y) / c.k, k: c.k }; };
export const viewToCam = (v: View, s: Safe) => { const m = safeCenter(s); return { x: m.x - v.x * v.k, y: m.y - v.y * v.k, k: v.k }; };
