// Side questions from anywhere. Select text in an agent message, a step, a diff or a code block (or hover a message
// and press "?", or ⌘K) and a floating window opens with that part quoted. It runs a temporary, read-only side session
// (POST /ask-thread) next to the main one, so the main agent keeps working. Close discards it; Save to notes keeps it.
// One window is open at a time; up to 3 more wait as small pills at the bottom of the screen.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useAgent, type State } from './useAgent';
import { Icon } from './icons';
import { Markdown } from './Markdown';
import { useApp } from './useSettings';
import { useT, serverText, useLang } from './i18n';

type Win = { key: string; quote: string; code: boolean; sideId: string | null; shrunk: boolean; title: string; kept: boolean; error?: string };
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
  const w = 400, h = 480;
  const fallback = { x: Math.max(16, window.innerWidth - w - 24), y: Math.max(16, window.innerHeight - h - 80), w, h };
  try { const g = JSON.parse(localStorage.getItem('askWin') ?? 'null'); if (g && [g.x, g.y, g.w, g.h].every(Number.isFinite)) return clampGeo(g); } catch { /* private mode */ }
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

  const send = (key: string, quote: string, question: string) => {
    patch(key, { title: question.slice(0, 60), error: undefined, sideId: 'pending' });
    fetch(`/api/threads/${threadId}/ask-thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: askPrompt(quote, question) }) })
      .then((r) => r.json())
      .then((j) => patch(key, j.id ? { sideId: j.id } : { sideId: null, error: j.error ?? 'Could not reach the server' }))
      .catch(() => patch(key, { sideId: null, error: 'Could not reach the server' }));
  };

  // A new window becomes the open one; the one that was open shrinks to a pill. Past 3 pills, the oldest goes.
  const open = ({ quote = '', code = false, question }: { quote?: string; code?: boolean; question?: string }) => {
    const key = crypto.randomUUID();
    const q = trimQuote(quote);
    setWins((ws) => {
      let next = ws.map((w) => ({ ...w, shrunk: true }));
      while (next.length >= MAX_PILLS + 1) { discard(next[0]); next = next.slice(1); }
      return [...next, { key, quote: q, code, sideId: null, shrunk: false, title: question?.slice(0, 60) || q.slice(0, 60), kept: false }];
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
        <AskWindow key={w.key} win={w} onSend={(q) => send(w.key, w.quote, q)} onClose={() => close(w.key)} onSave={() => save(w)}
          onShrink={() => patch(w.key, { shrunk: true })} />
      ))}
      {pills.length > 0 && (
        <div className="ask-pills">
          {pills.map((w) => (
            <button key={w.key} className="ask-pill" onClick={() => restore(w.key)} title={t('Open this question again', 'Rouvrir cette question')}>
              <Icon name="quiz" size={11} /><span>{w.title || t('Side question', 'Question à part')}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
  return { open, layer };
}

function AskWindow({ win, onSend, onClose, onSave, onShrink }: {
  win: Win; onSend: (question: string) => void; onClose: () => void; onSave: () => void; onShrink: () => void;
}) {
  const t = useT();
  const fr = useLang() === 'fr';
  const [geo, setGeo] = useState<Geo>(loadGeo);
  const [phone, setPhone] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const r = () => { setPhone(window.innerWidth < 600); if (window.innerWidth >= 600) setGeo((g) => clampGeo(g)); }; // the phone sheet ignores it
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  useEffect(() => { try { localStorage.setItem('askWin', JSON.stringify(geo)); } catch { /* private mode */ } }, [geo]);
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
    <div ref={box} className={`ask-win ${phone ? 'sheet-mode' : ''}`} hidden={win.shrunk} role="dialog" aria-label={t('Side question', 'Question à part')}
      style={phone ? undefined : { left: geo.x, top: geo.y, width: geo.w, height: geo.h }}>
      <div className="ask-head" onPointerDown={down('move')} onPointerMove={move} onPointerUp={up}>
        <span className="ask-title">{t('Side question', 'Question à part')}</span>
        <span className="muted ask-sub">{t('the main agent keeps working', 'l’agent principal continue')}</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onShrink} title={t('Shrink', 'Réduire')} aria-label={t('Shrink', 'Réduire')}><Icon name="minus" size={13} /></button>
        <button className="icon-btn" onClick={onClose} title={t('Close and discard (Esc)', 'Fermer et effacer (Échap)')} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button>
      </div>
      {asked ? <AskChat sideId={win.sideId!} code={win.code} /> : <AskFirst win={win} onSend={onSend} />}
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

// Before the first question: the quote, three quick questions and a box for your own.
function AskFirst({ win, onSend }: { win: Win; onSend: (q: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const pending = win.sideId === 'pending';
  const chips = [t('Explain it simpler', 'Explique plus simplement'), t('Why this way?', 'Pourquoi comme ça ?'), t('Show me an example', 'Montre-moi un exemple')];
  const go = (q: string) => { if (q.trim() && !pending) onSend(q.trim()); };
  return (
    <div className="ask-body">
      {win.quote ? <Quote text={win.quote} code={win.code} /> : <div className="muted">{t('Ask anything about the project or what the agent is doing. It reads, but changes nothing.', 'Pose une question sur le projet ou sur ce que fait l’agent. Il lit, mais ne change rien.')}</div>}
      {win.quote && (
        <div className="ask-chips">
          {chips.map((c) => <button key={c} className="btn ghost sm" disabled={pending} onClick={() => go(c)}>{c}</button>)}
        </div>
      )}
      <span className="spacer" />
      <AskBox value={text} onChange={setText} onSend={() => go(text)} busy={pending} placeholder={win.quote ? t('Or ask your own question…', 'Ou pose ta propre question…') : t('Ask your question…', 'Pose ta question…')} />
    </div>
  );
}

function AskBox({ value, onChange, onSend, busy, placeholder }: { value: string; onChange: (s: string) => void; onSend: () => void; busy: boolean; placeholder: string }) {
  const t = useT();
  return (
    <div className="ask-box">
      <textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) onSend(); } }} />
      <button className="btn primary round" disabled={busy || !value.trim()} onClick={onSend} title={t('Send', 'Envoyer')} aria-label={t('Send', 'Envoyer')}>
        {busy ? <span className="spin" /> : <Icon name="arrow" size={14} />}
      </button>
    </div>
  );
}

// The side session's conversation, in a lighter view than the main chat, with follow-ups.
function AskChat({ sideId, code }: { sideId: string; code: boolean }) {
  const { state, run } = useAgent(sideId);
  const t = useT();
  const fr = useLang() === 'fr';
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.running]);
  const send = () => { if (!text.trim() || state.running) return; run(text.trim()); setText(''); };
  return (
    <div className="ask-body chat">
      <div className="ask-scroll">
        {state.timeline.map((e, i) => <AskEntry key={i} e={e} state={state} fr={fr} code={code} />)}
        {state.running && <div className="ask-thinking muted"><span className="spin" /> {t('Thinking', 'Réflexion')}</div>}
        <div ref={end} />
      </div>
      <AskBox value={text} onChange={setText} onSend={send} busy={state.running} placeholder={t('Ask a follow-up…', 'Pose une autre question…')} />
    </div>
  );
}

function AskEntry({ e, state, fr, code }: { e: State['timeline'][number]; state: State; fr: boolean; code: boolean }) {
  if (e.kind === 'user') {
    const { quote, question } = parseAsk(e.text);
    return <div className="ask-you">{quote && <Quote text={quote} code={code} />}{question && <div className="bubble-user">{question}</div>}</div>;
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
