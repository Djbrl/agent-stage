// Scratchpad: side questions and sketches from anywhere. Select text in an agent message, a step, a diff or a code
// block (or hover a message and press "?", or ⌘K, or the Scratchpad button) and a floating window opens with that
// part quoted. You can draw in it, or mark up a screenshot, and send the sketch with your question. It runs a temporary, read-only side session
// (POST /ask-thread) next to the main one, so the main agent keeps working. Every conversation is kept as a note:
// an empty Scratchpad lists this session's notes, to reopen or delete.
// One window is open at a time; up to 3 more wait as small pills at the bottom of the screen.
import { useEffect, useRef, useState } from 'react';
import { useAgent, type State } from './useAgent';
import { SketchPad, emptySketch, isBlank, sketchToPng, sketchFromImage, type Sketch } from './Sketch';
import { Icon } from './icons';
import { Markdown } from './Markdown';
import { ago } from './api';
import { QUIZ } from './Learned';
import { useT, serverText, useLang } from './i18n';

type Win = { key: string; quote: string; code: boolean; sideId: string | null; shrunk: boolean; title: string; error?: string;
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

// Scratchpad sits right beside the chat panel, as tall as it: your chat and your scratchpad side by side.
// (No chat panel on screen, e.g. the panel is folded away: it docks on the right instead.)
function dockGeo(): Geo {
  const W = Math.min(440, window.innerWidth - 16);
  const panel = [...document.querySelectorAll<HTMLElement>('.studio-panel, .agent-panel:not(.side)')]
    .map((el) => el.getBoundingClientRect()).find((r) => r.width > 200 && r.height > 200);
  if (!panel) return { x: window.innerWidth - W - 12, y: 64, w: W, h: window.innerHeight - 80 };
  const x = panel.right + 10 + W <= window.innerWidth - 8 ? panel.right + 10 : Math.max(8, window.innerWidth - W - 8);
  return { x, y: panel.top, w: W, h: panel.height };
}

// The layer: selection button, ⌘K, the windows and the pills. ThreadView renders `layer` and calls `open`.
export function useAsk(threadId: string) {
  const [wins, setWins] = useState<Win[]>([]);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const patch = (key: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...p } : w)));

  // Always an object: a server that answers with plain text (an old copy without this route, a proxy error) becomes an error.
  const post = (url: string, body: object) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { const j = await r.json().catch(() => null); return j ?? { error: r.ok ? 'Unexpected answer from the server' : `The server said ${r.status}. Restart Tandemcode and try again.` }; });
  // The window's sketch as an uploaded PNG (none when the page is blank or closed), then a fresh page.
  const pack = async (key: string): Promise<string[]> => {
    const w = winsRef.current.find((x) => x.key === key);
    if (!w || !w.drawing || isBlank(w.sketch)) return [];
    const r = await post('/api/sketches', { data: await sketchToPng(w.sketch) });
    if (!r.name) throw new Error(r.error ?? 'Could not save the sketch');
    return [r.name];
  };
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
      while (next.length >= MAX_PILLS + 1) next = next.slice(1);
      return [...next, { key, quote: q, code, sideId: null, shrunk: false, title: question?.slice(0, 60) || q.slice(0, 60), sketch: emptySketch(), drawing: draw }];
    });
    if (question) send(key, q, question);
    window.getSelection()?.removeAllRanges();
  };
  const close = (key: string) => setWins((ws) => ws.filter((x) => x.key !== key));
  const restore = (key: string) => setWins((ws) => ws.map((w) => ({ ...w, shrunk: w.key !== key })));
  // Notes: open one again in this window, or start a fresh one.
  const openNote = (key: string, id: string, title: string) => patch(key, { sideId: id, title, quote: '', error: undefined, sketch: emptySketch(), drawing: false });
  const fresh = (key: string) => patch(key, { sideId: null, title: '', quote: '', error: undefined, sketch: emptySketch(), drawing: false });


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
          onClose={() => close(w.key)} onShrink={() => patch(w.key, { shrunk: true })} threadId={threadId}
          onOpenNote={(id, title) => openNote(w.key, id, title)} onFresh={() => fresh(w.key)} />
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
  onSketch: (s: Sketch) => void; onDraw: (on: boolean) => void; onClose: () => void; onShrink: () => void;
  threadId: string; onOpenNote: (id: string, title: string) => void; onFresh: () => void };

// The window: no title, just room. What you asked about (if anything), the answers, the page you draw on,
// then the box to type in; under it, + to draw or bring in a screenshot, and Send to your current thread.
function AskWindow({ win, onSend, onFollow, onTask, onSketch, onDraw, onClose, onShrink, threadId, onOpenNote, onFresh }: WinProps) {
  const t = useT();
  const fr = useLang() === 'fr';
  const [geo, setGeo] = useState<Geo>(dockGeo);
  const [phone, setPhone] = useState(() => window.innerWidth < 600);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  // Follow the chat panel: it can be resized, folded, or the window resized.
  useEffect(() => {
    if (win.shrunk) return;
    const place = () => { setPhone(window.innerWidth < 600); setGeo((g) => { const n = dockGeo(); return n.x === g.x && n.y === g.y && n.w === g.w && n.h === g.h ? g : n; }); };
    place();
    const iv = setInterval(place, 400);
    window.addEventListener('resize', place);
    return () => { clearInterval(iv); window.removeEventListener('resize', place); };
  }, [win.shrunk]);
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
  const bring = (f: File | undefined | null) => { if (f?.type.startsWith('image/')) void sketchFromImage(f, win.sketch).then((sk) => { onSketch(sk); onDraw(true); }); };
  useEffect(() => {
    if (win.shrunk) return;
    const paste = (e: ClipboardEvent) => {
      const a = document.activeElement;
      if (a && a !== document.body && !box.current?.contains(a)) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault(); bring(f);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [win.shrunk, win.sketch]);

  const asked = Boolean(win.sideId && win.sideId !== 'pending');
  const busy = win.sideId === 'pending' || Boolean(win.sending) || running;
  const sketched = win.drawing && !isBlank(win.sketch);
  const fallback = t('Here’s my sketch. What do you make of it?', 'Voici mon croquis. Qu’en penses-tu ?');
  const ready = Boolean(text.trim()) || sketched;
  const send = () => { if (!ready || busy) return; (asked ? onFollow : onSend)(text.trim() || fallback); setText(''); };
  const toThread = () => { if (!ready || busy) return; onTask(text.trim() || fallback); setText(''); };
  const placeholder = asked ? t('Ask a follow-up…', 'Pose une autre question…') : win.quote ? t('Ask about this…', 'Pose ta question là-dessus…') : t('Ask anything about the task…', 'Pose une question sur la tâche…');

  return (
    <div ref={box} className={`ask-win scratch ${phone ? 'sheet-mode' : ''}`} hidden={win.shrunk} role="dialog" aria-label={t('Scratchpad', 'Brouillon')}
      style={phone ? undefined : { left: geo.x, top: geo.y, width: geo.w, height: geo.h }}>
      {asked && !win.sent && <button className="btn ghost sm sp-back" onClick={onFresh} title={t('Your notes, and a new one', 'Tes notes, et une nouvelle')}><Icon name="list" size={13} />{t('Notes', 'Notes')}</button>}
      <div className="sp-corner">
        <button className="icon-btn" onClick={onShrink} title={t('Shrink', 'Réduire')} aria-label={t('Shrink', 'Réduire')}><Icon name="minus" size={13} /></button>
        <button className="icon-btn" onClick={onClose} title={t('Close (Esc). Your notes are kept.', 'Fermer (Échap). Tes notes sont gardées.')} aria-label={t('Close', 'Fermer')}><Icon name="x" size={13} /></button>
      </div>
      {win.sent ? <div className="sp-body sent"><Icon name="check" size={18} /><span>{t('Sent to your thread', 'Envoyé à ton fil')}</span></div> : <>
        <div className="sp-body">
          {asked ? <Conversation sideId={win.sideId!} code={win.code} onRunning={setRunning} />
            : win.quote ? <Quote text={win.quote} code={win.code} /> : null}
          {win.drawing && <SketchPad value={win.sketch} onChange={onSketch} />}
          {win.drawing && !asked && <p className="sp-tip">{win.sketch.bg
            ? t('Circle or underline the part you mean, then say below what should change. ⌘Z takes back a stroke.', 'Entoure ou souligne la partie qui compte, puis dis en dessous ce qui doit changer. ⌘Z annule un trait.')
            : t('Sketch a layout, a flow or an idea: boxes and arrows are plenty. ⌘Z takes back a stroke.', 'Dessine une mise en page, un parcours ou une idée : des boîtes et des flèches suffisent. ⌘Z annule un trait.')}</p>}
          {!asked && !win.quote && !win.drawing && <Notes threadId={threadId} onOpen={onOpenNote} />}
        </div>
        {win.error && <div className="ask-error">{serverText(win.error, fr)}</div>}
        <div className="sp-input">
          <textarea rows={2} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn primary round" disabled={busy || !ready} onClick={send} title={t('Ask', 'Demander')} aria-label={t('Ask', 'Demander')}>
            {busy ? <span className="spin" /> : <Icon name="arrow" size={14} />}
          </button>
        </div>
        <div className="sp-row">
          <PlusMenu drawing={win.drawing} onDraw={() => onDraw(true)} onPicture={() => file.current?.click()} />
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { bring(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="spacer" />
          <button className="btn ghost sm" disabled={busy || !ready} onClick={toThread}
            title={t('Send what you wrote (and drew) to your current thread, as a message to the main agent', 'Envoyer ce que tu as écrit (et dessiné) à ton fil, comme message à l’agent principal')}>
            {t('Send to your current thread', 'Envoyer à ton fil')} <Icon name="arrow" size={11} />
          </button>
        </div>
      </>}
    </div>
  );
}

// This session's notes, newest first: open one again, or delete it.
type Note = { id: string; title: string; updatedAt: number; sketch: string | null };
function Notes({ threadId, onOpen }: { threadId: string; onOpen: (id: string, title: string) => void }) {
  const t = useT();
  const fr = useLang() === 'fr';
  const [notes, setNotes] = useState<Note[] | null>(null);
  const load = () => fetch(`/api/threads/${threadId}/scratch-notes`).then((r) => r.json()).then((n) => setNotes(Array.isArray(n) ? n.sort((a, b) => b.updatedAt - a.updatedAt) : [])).catch(() => setNotes([]));
  useEffect(() => { void load(); }, [threadId]);
  const [asking, setAsking] = useState<string | null>(null); // the note whose × was pressed: it asks inline
  const remove = (n: Note) => { setAsking(null); fetch(`/api/threads/${n.id}`, { method: 'DELETE' }).then(load); };
  if (!notes?.length) return null;
  return (
    <div className="sp-notes">
      <div className="sp-notes-head">{t('Your notes', 'Tes notes')}</div>
      {notes.map((n) => (
        asking === n.id ? (
          <div key={n.id} className="sp-note asking">
            <span className="sp-note-q">{t('Delete this note?', 'Supprimer cette note ?')}</span>
            <button className="btn ghost sm" onClick={() => setAsking(null)}>{t('Keep', 'Garder')}</button>
            <button className="btn sm danger-solid" onClick={() => remove(n)}>{t('Delete', 'Supprimer')}</button>
          </div>
        ) : <div key={n.id} className="sp-note">
          <button className="sp-note-open" onClick={() => onOpen(n.id, n.title)}>
            {n.sketch ? <img src={`/api/shots/${n.sketch}`} alt="" /> : <span className="sp-note-icon"><Icon name="write" size={13} /></span>}
            <span className="sp-note-title">{n.title || t('Note', 'Note')}</span>
            <span className="muted sp-note-when">{ago(n.updatedAt, fr)}</span>
          </button>
          <button className="icon-btn sp-note-del" onClick={() => setAsking(n.id)} title={t('Delete this note', 'Supprimer cette note')} aria-label={t('Delete', 'Supprimer')}><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

// + under the box: start drawing on a blank page, or bring in a screenshot to mark up.
function PlusMenu({ drawing, onDraw, onPicture }: { drawing: boolean; onDraw: () => void; onPicture: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="sp-plus" onMouseLeave={() => setOpen(false)}>
      <button className="icon-btn sp-plus-btn" onClick={() => setOpen(!open)} aria-expanded={open} title={t('Draw or add a screenshot', 'Dessiner ou ajouter une capture')}><Icon name="plus" size={16} /></button>
      {open && (
        <div className="sp-menu" role="menu">
          {!drawing && <button role="menuitem" onClick={() => { onDraw(); setOpen(false); }}><Icon name="write" size={14} />{t('Draw', 'Dessiner')}</button>}
          <button role="menuitem" onClick={() => { onPicture(); setOpen(false); }}><Icon name="folder" size={14} />{t('Add a screenshot', 'Ajouter une capture')}</button>
        </div>
      )}
    </div>
  );
}

function Quote({ text, code }: { text: string; code: boolean }) {
  return <blockquote className={`ask-quote ${code ? 'code' : ''}`}>{text}</blockquote>;
}

// The side session's conversation, in a lighter view than the main chat.
function Conversation({ sideId, code, onRunning }: { sideId: string; code: boolean; onRunning: (r: boolean) => void }) {
  const { state } = useAgent(sideId);
  const t = useT();
  const fr = useLang() === 'fr';
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { onRunning(state.running); }, [state.running]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.running]);
  return (
    <div className="sp-chat">
      {state.timeline.map((e, i) => <AskEntry key={i} e={e} state={state} fr={fr} code={code} />)}
      {state.running && <div className="ask-thinking muted"><span className="spin" /> {t('Thinking', 'Réflexion')}</div>}
      <div ref={end} />
    </div>
  );
}

function AskEntry({ e, state, fr, code }: { e: State['timeline'][number]; state: State; fr: boolean; code: boolean }) {
  if (e.kind === 'user') {
    const { quote, question } = parseAsk(e.text);
    return <div className="ask-you">{quote && <Quote text={quote} code={code} />}<Sketches names={e.images} />{question && <div className="bubble-user">{question === QUIZ ? (fr ? 'Interroge-moi' : 'Quiz me') : question}</div>}</div>;
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
