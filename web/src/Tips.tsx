// Contextual tips: one small pointer card at a time, shown the first time something becomes relevant, next to
// the thing it explains. Each tip shows once (remembered in this browser). A newer tip replaces the current one.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { State } from './useAgent';
import { useT } from './i18n';
import { tourDone } from './Tour';

// (No tip for the agent's dot or a checkpoint: the tour's map stop and the checkpoint card already say it.)
type Key = 'approve' | 'edit' | 'done' | 'follow';
type Anchor = string[] | (() => DOMRect | null); // selectors (first visible wins) or a live rectangle

// Things without a DOM element (the agent's dot on the canvas) register a function that returns where they are.
const anchors: Record<string, () => DOMRect | null> = {};
export const setAnchor = (name: string, at: (() => DOMRect | null) | null) => { if (at) anchors[name] = at; else delete anchors[name]; };

const SEEN = 'tips-seen';
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '[]'); } catch { return []; } };
const markSeen = (k: Key) => { try { localStorage.setItem(SEEN, JSON.stringify([...new Set([...readSeen(), k])])); } catch { /* private window */ } };

const visible = (el: Element | null) => { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; };
function locate(a: Anchor): DOMRect | null {
  if (typeof a === 'function') return a();
  for (const sel of a) for (const el of document.querySelectorAll(sel)) { const r = visible(el); if (r) return r; }
  return null;
}

export function Tips({ state, following, replaying, shared, sandbox }: { state: State; following: boolean; replaying: boolean; shared: boolean; sandbox?: boolean }) {
  const t = useT();
  const [tip, setTip] = useState<{ key: Key; text: string; anchor: Anchor } | null>(null);
  const seen = useRef(new Set(readSeen()));
  const shownAt = useRef(0), tipRef = useRef(tip);
  tipRef.current = tip;
  // While a tip is up, look again now and then for one that had to wait its turn.
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!tip) return; const iv = setInterval(() => setTick((n) => n + 1), 2500); return () => clearInterval(iv); }, [tip]);
  // Only things that happen while you watch: opening an old thread doesn't replay its tips.
  // (The saved events load in the first moment after mount; work after that is happening now.)
  const live = useRef(false), mounted = useRef(Date.now());
  if (state.running && !replaying && Date.now() - mounted.current > 1500) live.current = true;
  // The walkthrough of the interface comes first: no tip until it's over.
  const [toured, setToured] = useState(tourDone);
  useEffect(() => { const f = () => setToured(true); window.addEventListener('tour-done', f); return () => window.removeEventListener('tour-done', f); }, []);
  const off = replaying || shared || !toured;

  const fire = (key: Key, text: string, anchor: Anchor) => {
    if (off || seen.current.has(key)) return;
    if (!locate(anchor)) return; // not on screen yet: try again on the next change
    // Give each tip a few seconds before a newer one takes its place (unless the newer one needs you now).
    if (tipRef.current && Date.now() - shownAt.current < 5000 && key !== 'approve') return;
    seen.current.add(key); markSeen(key);
    shownAt.current = Date.now();
    setTip({ key, text, anchor });
  };

  const edited = state.steps.some((s) => s.change);
  const last = state.timeline.at(-1);
  const finished = !state.running && last?.kind === 'done' && edited && !last.text.slice(-300).includes('?'); // a turn that ends on a question isn't done

  useEffect(() => {
    const where = sandbox ? t('in your sandbox', 'dans ton bac à sable') : t('on your computer', 'sur ton ordinateur');
    if (state.approval) fire('approve', t(`The agent wants to run this ${where}. Read it first: Run it lets it go ahead, Deny says no to just this one.`,
      `L’agent veut lancer ceci ${where}. Lis d’abord : « Lancer » le laisse faire, « Refuser » dit non juste cette fois.`), ['.approval']);
  }, [state.approval?.id, tick, tip]);
  useEffect(() => {
    if (live.current && edited) fire('edit', t('Click a step to see exactly what changed, and why.', 'Clique sur une étape pour voir exactement ce qui a changé, et pourquoi.'),
      ['.studio-tabs .tab-steps', '.stage-tools .steps', '.work']);
  }, [edited, state.steps.length, tick, tip]);
  useEffect(() => {
    if (live.current && finished) fire('done', t('Done. Replay it on the map, or hover any message and press ? to ask about it.', 'Fini. Revois-le sur la carte, ou survole un message et appuie sur ? pour poser une question.'),
      ['.stage-tools .replay-tool', '.ask-msg']);
  }, [finished, tick, tip]);
  useEffect(() => {
    if (live.current && !following) fire('follow', t('You have the camera now. Follow gives it back to the agent.', 'Tu as la caméra. « Suivre » la rend à l’agent.'), ['.stage-tools .follow-tool']);
  }, [following, tick, tip]);
  useEffect(() => { if (off) setTip(null); }, [off]);

  if (!tip) return null;
  return <TipCard key={tip.key} text={tip.text} anchor={tip.anchor} onDone={() => setTip(null)} gotIt={t('Got it', 'Compris')} />;
}

// The card: beside its anchor, placed below, above, right or left (whichever fits), kept on screen, with a
// small pointer toward the anchor. It follows the anchor as things move and leaves when the anchor goes.
function TipCard({ text, anchor, onDone, gotIt }: { text: string; anchor: Anchor; onDone: () => void; gotIt: string }) {
  const card = useRef<HTMLDivElement>(null);
  const seenAt = useRef(Date.now());
  const [pos, setPos] = useState<{ left: number; top: number; side: 'below' | 'above' | 'left' | 'right'; arrow: number } | null>(null);
  const place = () => {
    const r = locate(anchor), el = card.current;
    // The anchor can blink out for a moment (a camera cut, a re-render): leave only when it's really gone.
    if (!r) { if (Date.now() - seenAt.current > 1500) onDone(); return; }
    seenAt.current = Date.now();
    const W = window.innerWidth, H = window.innerHeight, gap = 12, m = 10;
    const cw = el?.offsetWidth ?? 260, ch = el?.offsetHeight ?? 90;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let side: 'below' | 'above' | 'left' | 'right' = 'below', left = cx - cw / 2, top = r.bottom + gap;
    if (r.bottom + gap + ch > H - m) {
      if (r.top - gap - ch >= m) { side = 'above'; top = r.top - gap - ch; }
      else if (r.right + gap + cw <= W - m) { side = 'right'; left = r.right + gap; top = cy - ch / 2; }
      else if (r.left - gap - cw >= m) { side = 'left'; left = r.left - gap - cw; top = cy - ch / 2; }
      else { side = 'above'; top = Math.max(m, r.top - gap - ch); }
    }
    left = Math.max(m, Math.min(W - cw - m, left));
    top = Math.max(m, Math.min(H - ch - m, top));
    const arrow = side === 'below' || side === 'above' ? Math.max(14, Math.min(cw - 14, cx - left)) : Math.max(14, Math.min(ch - 14, cy - top));
    setPos((p) => (p && p.left === left && p.top === top && p.side === side && p.arrow === arrow ? p : { left, top, side, arrow }));
  };
  useLayoutEffect(place, []);
  useEffect(() => {
    const iv = setInterval(place, 250);
    // Any click elsewhere also puts the tip away (after the click that may have fired it).
    const away = (e: PointerEvent) => { if (!card.current?.contains(e.target as Node)) onDone(); };
    const t0 = setTimeout(() => window.addEventListener('pointerdown', away, true), 400);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    window.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    return () => { clearInterval(iv); clearTimeout(t0); window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); window.removeEventListener('resize', place); };
  }, []);
  return (
    <div ref={card} className={`tip tip-${pos?.side ?? 'below'}`} role="status" onClick={onDone}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--arrow' as any]: `${pos?.arrow ?? 20}px` }}>
      <span className="tip-text">{text}</span>
      <button className="btn ghost sm tip-ok" onClick={onDone}>{gotIt}</button>
    </div>
  );
}
