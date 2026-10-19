// Scratchpad: side questions and sketches from anywhere. Select text in an agent message, a step, a diff or a code
// block (or hover a message and press "?", or ⌘K, or the Scratchpad button) and a floating window opens with that
// part quoted. You can draw in it, or mark up a screenshot, and send the sketch with your question. It runs a temporary, read-only side session
// (POST /ask-thread) next to the main one, so the main agent keeps working. Close discards it; Save to notes keeps it.
// One window is open at a time; up to 3 more wait as small pills at the bottom of the screen.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useAgent, type State } from './useAgent';
import { SketchPad, emptySketch, isBlank, sketchToPng, sketchFromImage, type Sketch } from './Sketch';
import { Icon } from './icons';
import { Markdown } from './Markdown';
import { useApp } from './useSettings';
import { useT, serverText, useLang } from './i18n';

type Win = { key: string; quote: string; code: boolean; sideId: string | null; shrunk: boolean; title: string; kept: boolean; error?: string;
  sketch: Sketch; drawing: boolean; sending?: boolean; sent?: boolean };
type Geo = { x: number; y: number; w: number; h: number };

// Where a selection may start an ask: agent messages, step detail, diffs and code. Never inputs or the window itself.
const ASKABLE = '.agent-panel .timeline, .sheet, .diff, pre, .explain';
const MAX_PILLS = 3;
const MAX_QUOTE = 1500;

// The prompt the side agent gets, and back: the window shows the quote and the question, not the raw prompt.
const HEAD = 'About this part:\n';
export function askPrompt(quote: string, question: string) {
  if (!quote) return question;
  return `${HEAD}${quote.split('\n').map((l) => `> ${l}`).join('\n')}\n\n${question}`;
}
export function parseAsk(text: string): { quote: string; question: string } {
  if (!text.startsWith(HEAD)) return { quote: '', question: text };
  const rest = text.slice(HEAD.length);
  const cut = rest.indexOf('\n\n');
  const block = cut < 0 ? rest : rest.slice(0, cut);
  return { quote: block.split('\n').map((l) => l.replace(/^> ?/, '')).join('\n'), question: cut < 0 ? '' : rest.slice(cut + 2) };
}

const trimQuote = (s: string) => { const q = s.replace(/\n{3,}/g, '\n\n').trim(); return q.length > MAX_QUOTE ? `${q.slice(0, MAX_QUOTE)}…` : q; };
const typing = (el: Element | null) => Boolean(el && (el.closest('input, textarea, select, [contenteditable="true"]')));
const isCode = (n: Node | null) => Boolean((n instanceof Element ? n : n?.parentElement)?.closest('pre, code, .diff, .output'));
function askableSelection(): { text: string; code: boolean; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const el = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement) ?? null;
  if (!el?.closest(ASKABLE) || el.closest('.ask-win, .composer') || typing(el)) return null;
  return { text, code: isCode(sel.anchorNode), rect: sel.getRangeAt(0).getBoundingClientRect() };
}

const loadGeo = (): Geo => {
  const w = 480, h = 620;
  const fallback = { x: Math.max(16, window.innerWidth - w - 24), y: Math.max(16, window.innerHeight - h - 80), w, h };
  try { const g = JSON.parse(localStorage.getItem('scratchWin') ?? 'null'); if (g && [g.x, g.y, g.w, g.h].every(Number.isFinite)) return clampGeo(g); } catch { /* private mode */ }
  return fallback;
};
const clampGeo = (g: Geo): Geo => {
  const w = Math.max(300, Math.min(g.w, window.innerWidth - 16)), h = Math.max(260, Math.min(g.h, window.innerHeight - 16));
  return { w, h, x: Math.max(8, Math.min(g.x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(g.y, window.innerHeight - h - 8)) };
};

// The layer: selection button, ⌘K, the windows and the pills. ThreadView renders `layer` and calls `open`.
export function useAsk(threadId: string) {
  const [wins, setWins] = useState<Win[]>([]);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const { refreshThreads } = useApp();
  const patch = (key: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...p } : w)));
  const discard = (w: Win) => { if (w.sideId && !w.kept) fetch(`/api/threads/${w.sideId}`, { method: 'DELETE' }).catch(() => {}); };

  // The window's sketch as an uploaded PNG (none when the page is blank or closed), then a fresh page.
  const pack = async (key: string): Promise<string[]> => {
    const w = winsRef.current.find((x) => x.key === key);
    if (!w || !w.drawing || isBlank(w.sketch)) return [];
    const r = await fetch('/api/sketches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: await sketchToPng(w.sketch) }) }).then((x) => x.json());
    if (!r.name) throw new Error(r.error ?? 'Could not save the sketch');
    return [r.name];
  };
  const post = (url: string, body: object) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const fail = (key: string) => (e: Error) => patch(key, { sending: false, error: e.message || 'Could not reach the server' });

  const send = async (key: string, quote: string, question: string) => {
    patch(key, { title: question.slice(0, 60), error: undefined, sideId: 'pending' });
    try {
      const images = await pack(key);
      const j = await post(`/api/threads/${threadId}/ask-thread`, { question: askPrompt(quote, question), images });
      patch(key, j.id ? { sideId: j.id, sketch: emptySketch(), drawing: false } : { sideId: null, error: j.error ?? 'Could not reach the server' });
    } catch (e: any) { patch(key, { sideId: null, error: e.message || 'Could not reach the server' }); }
  };
  // A follow-up in the side session, with a new sketch if there is one.
  const follow = async (key: string, sideId: string, question: string) => {
    patch(key, { sending: true, error: undefined });
    try {
      const images = await pack(key);
      const j = await post(`/api/threads/${sideId}/task`, { task: question, images });
      patch(key, j.error ? { sending: false, error: j.error } : { sending: false, sketch: emptySketch(), drawing: false });
    } catch (e: any) { fail(key)(e); }
  };
  // Make it a task: the note (and sketch) goes to the main session as a real request.
  const toTask = async (key: string, quote: string, question: string) => {
    patch(key, { sending: true, error: undefined });
    try {
      const images = await pack(key);
      const j = await post(`/api/threads/${threadId}/task`, { task: askPrompt(quote, question), images });
      if (j.error) patch(key, { sending: false, error: j.error });
      else { patch(key, { sending: false, sent: true }); setTimeout(() => close(key), 900); }
    } catch (e: any) { fail(key)(e); }
  };

  // A new window becomes the open one; the one that was open shrinks to a pill. Past 3 pills, the oldest goes.
  const open = ({ quote = '', code = false, question, draw = false }: { quote?: string; code?: boolean; question?: string; draw?: boolean }) => {
    const key = crypto.randomUUID();
    const q = trimQuote(quote);
    setWins((ws) => {
      let next = ws.map((w) => ({ ...w, shrunk: true }));
      while (next.length >= MAX_PILLS + 1) { discard(next[0]); next = next.slice(1); }
      return [...next, { key, quote: q, code, sideId: null, shrunk: false, title: question?.slice(0, 60) || q.slice(0, 60), kept: false, sketch: emptySketch(), drawing: draw }];
    });
    if (question) send(key, q, question);
    window.getSelection()?.removeAllRanges();
  };
  const close = (key: string) => setWins((ws) => { const w = ws.find((x) => x.key === key); if (w) discard(w); return ws.filter((x) => x.key !== key); });
  const restore = (key: string) => setWins((ws) => ws.map((w) => ({ ...w, shrunk: w.key !== key })));
  const save = (w: Win) => w.sideId && fetch(`/api/threads/${w.sideId}/keep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then((r) => { if (r.ok) { patch(w.key, { kept: true }); refreshThreads(); } });

  // Leaving the session discards its unsaved side questions.
  useEffect(() => () => winsRef.current.forEach(discard), []);

  // The floating "Ask about this" button follows the selection.
  const [pick, setPick] = useState<{ text: string; code: boolean; x: number; y: number } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = askableSelection();
        if (!s || s.rect.bottom < 0 || s.rect.top > window.innerHeight) { setPick(null); return; }
        setPick({ text: s.text, code: s.code, x: Math.min(window.innerWidth - 150, Math.max(8, s.rect.right - 60)), y: Math.min(window.innerHeight - 40, s.rect.bottom + 8) });
      }, 120);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !typing(document.activeElement)) {
        e.preventDefault();
        const s = askableSelection();
        open({ quote: s?.text, code: s?.code });
        setPick(null);
      }
    };
    document.addEventListener('selectionchange', check);
    document.addEventListener('scroll', check, true); // the chat scrolls while the agent works: follow the selection
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('selectionchange', check); document.removeEventListener('scroll', check, true); window.removeEventListener('keydown', key); };
  }, [threadId]);

  const t = useT();
  const pills = wins.filter((w) => w.shrunk);
  const layer = (
    <>
      {pick && (
        <button className="ask-pick" style={{ left: pick.x, top: pick.y }} onMouseDown={(e) => e.preventDefault()}
          onClick={() => { open({ quote: pick.text, code: pick.code }); setPick(null); }}>
          <Icon name="quiz" size={12} />{t('Ask about this', 'Demander')}
        </button>
      )}
      {wins.map((w) => (
        <AskWindow key={w.key} win={w} onSend={(q) => send(w.key, w.quote, q)} onFollow={(q) => w.sideId && follow(w.key, w.sideId, q)}
          onTask={(q) => toTask(w.key, w.quote, q)} onSketch={(sk) => patch(w.key, { sketch: sk })} onDraw={(on) => patch(w.key, { drawing: on })}
          onClose={() => close(w.key)} onSave={() => save(w)} onShrink={() => patch(w.key, { shrunk: true })} />
      ))}
      {pills.length > 0 && (
        <div className="ask-pills">
          {pills.map((w) => (
            <button key={w.key} className="ask-pill" onClick={() => restore(w.key)} title={t('Open this question again', 'Rouvrir cette question')}>
              <Icon name="write" size={11} /><span>{w.title || t('Scratchpad', 'Brouillon')}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
  return { open, layer };
}

type WinProps = { win: Win; onSend: (q: string) => void; onFollow: (q: string) => void; onTask: (q: string) => void;
  onSketch: (s: Sketch) => void; onDraw: (on: boolean) => void; onClose: () => void; onSave: () => void; onShrink: () => void };
function AskWindow({ win, onSend, onFollow, onTask, onSketch, onDraw, onClose, onSave, onShrink }: WinProps) {
  const t = useT();
  const fr = useLang() === 'fr';
  const [geo, setGeo] = useState<Geo>(loadGeo);
  const [phone, setPhone] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const r = () => { setPhone(window.innerWidth < 600); if (window.innerWidth >= 600) setGeo((g) => clampGeo(g)); }; // the phone sheet ignores it
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  useEffect(() => { try { localStorage.setItem('scratchWin', JSON.stringify(geo)); } catch { /* private mode */ } }, [geo]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!win.shrunk) box.current?.querySelector('textarea')?.focus(); }, [win.shrunk, win.sideId]);

  // Esc closes the open window, unless you're typing somewhere else in the app.
  useEffect(() => {
    if (win.shrunk) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const a = document.activeElement;
      if (typing(a) && !box.current?.contains(a)) return;
      e.preventDefault(); onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [win.shrunk]);

  // Paste a screenshot: it becomes the page to draw on (only when you're in this window, or nowhere in particular).
  useEffect(() => {
    if (win.shrunk) return;
    const paste = (e: ClipboardEvent) => {
      const a = document.activeElement;
      if (a && a !== document.body && !box.current?.contains(a)) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      void sketchFromImage(f, win.sketch).then((sk) => { onSketch(sk); onDraw(true); });
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [win.shrunk, win.sketch]);

  // Drag by the header, resize by the corner (pointer capture keeps it smooth over the map).
  const drag = useRef<{ x: number; y: number; g: Geo; mode: 'move' | 'size' } | null>(null);
  const down = (mode: 'move' | 'size') => (e: RPointerEvent) => {
    if (phone || (mode === 'move' && (e.target as HTMLElement).closest('button'))) return;
    drag.current = { x: e.clientX, y: e.clientY, g: geo, mode };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add('ask-dragging');
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    setGeo(clampGeo(d.mode === 'move' ? { ...d.g, x: d.g.x + dx, y: d.g.y + dy } : { ...d.g, w: d.g.w + dx, h: d.g.h + dy }));
  };
  const up = () => { drag.current = null; document.body.classList.remove('ask-dragging'); };

  const asked = win.sideId && win.sideId !== 'pending';
  return (
    <div ref={box} className={`ask-win ${phone ? 'sheet-mode' : ''}`} hidden={win.shrunk} role="dialog" aria-label={t('Scratchpad', 'Brouillon')}
      style={phone ? undefined : { left: geo.x, top: geo.y, width: geo.w, height: geo.h }}>
      <div className="ask-head" onPointerDown={down('move')} onPointerMove={move} onPointerUp={up}>
        <span className="ask-title"><Icon name="write" size={13} />{t('Scratchpad', 'Brouillon')}</span>
        <span className="muted ask-sub">{t('the main agent keeps working', 'l’agent principal continue')}</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onShrink} title={t('Shrink', 'Réduire')} aria-label={t('Shrink', 'Réduire')}><Icon name="minus" size={13} /></button>
        <button className="icon-btn" onClick={onClose} title={t('Close and discard (Esc)', 'Fermer et effacer (Échap)')} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button>
      </div>
      {win.sent ? <div className="ask-body sent"><Icon name="check" size={18} /><span>{t('Sent to your session', 'Envoyé à ta session')}</span></div>
        : asked ? <AskChat sideId={win.sideId!} code={win.code} win={win} onFollow={onFollow} onTask={onTask} onSketch={onSketch} onDraw={onDraw} />
        : <AskFirst win={win} onSend={onSend} onTask={onTask} onSketch={onSketch} onDraw={onDraw} />}
      {win.error && <div className="ask-error">{serverText(win.error, fr)}</div>}
      {asked && (
        <div className="ask-foot">
          {win.kept ? <span className="muted">{t('Saved in your sessions', 'Gardée dans tes sessions')}</span>
            : <button className="btn ghost sm" onClick={onSave} title={t('Keep this conversation in your sessions', 'Garder cette conversation dans tes sessions')}>{t('Save to notes', 'Garder dans mes notes')}</button>}
        </div>
      )}
      {!phone && <div className="ask-resize" onPointerDown={down('size')} onPointerMove={move} onPointerUp={up} aria-hidden />}
    </div>
  );
}

function Quote({ text, code }: { text: string; code: boolean }) {
  return <blockquote className={`ask-quote ${code ? 'code' : ''}`}>{text}</blockquote>;
}

// Before the first question: the quote, three quick questions, the page to draw on, and a box for your own.
function AskFirst({ win, onSend, onTask, onSketch, onDraw }: Pick<WinProps, 'win' | 'onSend' | 'onTask' | 'onSketch' | 'onDraw'>) {
  const t = useT();
  const [text, setText] = useState('');
  const pending = win.sideId === 'pending' || Boolean(win.sending);
  const sketched = win.drawing && !isBlank(win.sketch);
  const chips = [t('Explain it simpler', 'Explique plus simplement'), t('Why this way?', 'Pourquoi comme ça ?'), t('Show me an example', 'Montre-moi un exemple')];
  const fallback = t('Here’s my sketch. What do you make of it?', 'Voici mon croquis. Qu’en penses-tu ?');
  const go = (q: string) => { if ((q.trim() || sketched) && !pending) onSend(q.trim() || fallback); };
  return (
    <div className="ask-body">
      {win.quote ? <Quote text={win.quote} code={win.code} />
        : !win.drawing && <div className="muted">{t('Ask anything about the project or what the agent is doing, or sketch what you mean. It reads, but changes nothing, and the main agent keeps working.', 'Pose une question sur le projet ou sur ce que fait l’agent, ou dessine ce que tu veux dire. Il lit mais ne change rien, et l’agent principal continue.')}</div>}
      {win.quote && !win.drawing && (
        <div className="ask-chips">
          {chips.map((c) => <button key={c} className="btn ghost sm" disabled={pending} onClick={() => go(c)}>{c}</button>)}
        </div>
      )}
      {win.drawing && <SketchPad value={win.sketch} onChange={onSketch} />}
      <span className="spacer" />
      <AskBox value={text} onChange={setText} onSend={() => go(text)} busy={pending} canSend={sketched} drawing={win.drawing} onDraw={onDraw}
        placeholder={win.drawing ? t('Say what your sketch is about…', 'Dis de quoi parle ton croquis…') : win.quote ? t('Or ask your own question…', 'Ou pose ta propre question…') : t('Ask your question…', 'Pose ta question…')} />
      <TaskButton disabled={pending || (!text.trim() && !sketched)} onClick={() => onTask(text.trim() || fallback)} />
    </div>
  );
}

// Make it a task: what you wrote (and drew) goes to the main session as a real request.
function TaskButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <div className="ask-task">
      <button className="btn ghost sm" disabled={disabled} onClick={onClick}
        title={t('Send this to the main session as a real request, sketch included', 'Envoyer à la session principale comme vraie demande, croquis compris')}>
        {t('Make it a task instead', 'En faire une tâche')} <Icon name="arrow" size={11} />
      </button>
    </div>
  );
}

function AskBox({ value, onChange, onSend, busy, placeholder, canSend = false, drawing, onDraw }: { value: string; onChange: (s: string) => void; onSend: () => void; busy: boolean; placeholder: string;
  canSend?: boolean; drawing: boolean; onDraw: (on: boolean) => void }) {
  const t = useT();
  return (
    <div className="ask-box">
      <button className={`icon-btn ask-draw ${drawing ? 'on' : ''}`} onClick={() => onDraw(!drawing)} aria-pressed={drawing}
        title={drawing ? t('Hide the drawing page', 'Masquer la page de dessin') : t('Draw, or mark up a screenshot', 'Dessiner, ou annoter une capture')}><Icon name="write" size={16} /></button>
      <textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) onSend(); } }} />
      <button className="btn primary round" disabled={busy || (!value.trim() && !canSend)} onClick={onSend} title={t('Send', 'Envoyer')} aria-label={t('Send', 'Envoyer')}>
        {busy ? <span className="spin" /> : <Icon name="arrow" size={14} />}
      </button>
    </div>
  );
}

// The side session's conversation, in a lighter view than the main chat, with follow-ups.
function AskChat({ sideId, code, win, onFollow, onTask, onSketch, onDraw }: { sideId: string; code: boolean } & Pick<WinProps, 'win' | 'onFollow' | 'onTask' | 'onSketch' | 'onDraw'>) {
  const { state } = useAgent(sideId);
  const t = useT();
  const fr = useLang() === 'fr';
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.running]);
  const sketched = win.drawing && !isBlank(win.sketch);
  const busy = state.running || Boolean(win.sending);
  const send = () => { if ((!text.trim() && !sketched) || busy) return; onFollow(text.trim() || t('Here’s my sketch.', 'Voici mon croquis.')); setText(''); };
  return (
    <div className="ask-body chat">
      <div className="ask-scroll">
        {state.timeline.map((e, i) => <AskEntry key={i} e={e} state={state} fr={fr} code={code} />)}
        {state.running && <div className="ask-thinking muted"><span className="spin" /> {t('Thinking', 'Réflexion')}</div>}
        <div ref={end} />
      </div>
      {win.drawing && <SketchPad value={win.sketch} onChange={onSketch} />}
      <AskBox value={text} onChange={setText} onSend={send} busy={busy} canSend={sketched} drawing={win.drawing} onDraw={onDraw} placeholder={t('Ask a follow-up…', 'Pose une autre question…')} />
      {(text.trim() || sketched) && <TaskButton disabled={busy} onClick={() => { onTask(text.trim() || t('Here’s my sketch.', 'Voici mon croquis.')); setText(''); }} />}
    </div>
  );
}

function AskEntry({ e, state, fr, code }: { e: State['timeline'][number]; state: State; fr: boolean; code: boolean }) {
  if (e.kind === 'user') {
    const { quote, question } = parseAsk(e.text);
    return <div className="ask-you">{quote && <Quote text={quote} code={code} />}<Sketches names={e.images} />{question && <div className="bubble-user">{question}</div>}</div>;
  }
  if (e.kind === 'thought') return <div className="thought"><Markdown text={e.text} /></div>;
  if (e.kind === 'done') return <div className="final"><Markdown text={serverText(e.text, fr)} /></div>;
  if (e.kind === 'error') return <div className="final bad"><div>{serverText(e.text, fr)}</div></div>;
  if (e.kind === 'actions') {
    const n = e.steps.filter((id) => state.steps.some((s) => s.id === id)).length;
    if (!n) return null;
    return <div className="ask-looked muted"><Icon name="read" size={11} /> {fr ? `A regardé le projet (${n} étape${n > 1 ? 's' : ''})` : `Looked at the project (${n} step${n > 1 ? 's' : ''})`}</div>;
  }
  return null;
}

// Sketches sent with a message, as thumbnails that open full size.
export function Sketches({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return <div className="sketches">{names.map((n) => <a key={n} href={`/api/shots/${n}`} target="_blank" rel="noreferrer"><img src={`/api/shots/${n}`} alt="" /></a>)}</div>;
}
