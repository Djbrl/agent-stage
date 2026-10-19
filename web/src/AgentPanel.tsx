// The conversation. Text stays quiet: each burst of tool calls is ONE line ("Editing greet.js · 5 steps"),
// and the detail lives on the stage. What stays prominent: your messages, the agent's words, and anything that
// needs you (checkpoints).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useVoice, voiceSupported } from './voice';
import { useDismiss } from './dismiss';
import type { State, Step, Entry } from './useAgent';
import { Icon } from './icons';
import { stepText } from './StepsSheet';
import { Markdown } from './Markdown';
import { useApp } from './useSettings';
import { useHighlight } from './highlight';
import { engineOf, ENGINE_LABEL, type Engine, type Provider } from './api';
import { Learned } from './Learned';
import { useT } from './i18n';

function summarize(steps: Step[]) {
  const c = (n: string[]) => steps.filter((s) => n.includes(s.name) && s.ok !== false).length;
  const parts: string[] = [];
  const read = c(['read_file', 'list_files', 'search']), ran = c(['run_command']);
  const wrote = new Set(steps.filter((s) => (s.name === 'write_file' || s.name === 'edit_file') && s.ok !== false).map((s) => s.target)).size; // files, not edits
  const failed = steps.filter((s) => s.ok === false).length;
  const web = steps.filter((s) => s.name.startsWith('browser_')).length;
  if (wrote) parts.push(`changed ${wrote} file${wrote > 1 ? 's' : ''}`);
  if (web) parts.push(`used the browser`);
  if (ran) parts.push(`ran ${ran} command${ran > 1 ? 's' : ''}`);
  if (read && !parts.length) parts.push(`looked at ${read} thing${read > 1 ? 's' : ''}`);
  if (failed) parts.push(`${failed} step${failed > 1 ? 's' : ''} failed`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Quiz me" (Learn mode). The mock model recognises the first words (QUIZ_START in src/model.ts).
const QUIZ = "Quiz me on what we just did: ask me 3 short questions about the ideas and the code from this session, one at a time. Wait for my answer before the next question, tell me in one or two sentences whether I'm right and why, and finish with my score and what to review. Don't change any files.";

export function AgentPanel({ visible = true, threadProvider, state, title, mode, onMode, onCheckpoint, problem, onRun, onAsk, onStop, onSelect, onOpenSettings, side, replaying, header, centered, banner, engine, hasHistory, status, onUndo, onKeep, onContext, git, shared }: {
  state: State; title: string; problem: string | null; onOpenSettings: () => void;
  mode: 'build' | 'learn'; onMode: (m: 'build' | 'learn') => void; onCheckpoint: (id: string, choice: 'confirm' | 'discuss' | 'skip', text?: string) => void;
  onRun: (t: string) => void; onAsk: (t: string) => void; onStop: () => void; onSelect: (id: string) => void;
  side?: { onKeep: () => void; onClose: () => void; kept: boolean };
  replaying?: boolean; header?: ReactNode; centered?: boolean; banner?: ReactNode; engine?: Engine; hasHistory?: boolean; status?: ReactNode;
  threadProvider?: string; // the model this thread last ran on (shown when the selected model is another engine's)
  visible?: boolean; // the Chat tab can be hidden: scroll to the newest item when it shows again
  onContext?: (action: 'clear' | 'compact') => Promise<string | null>;
  onUndo?: (ref: string) => void; onKeep?: (ref: string) => Promise<string | null>; git?: { repo: boolean; onInit: () => void } | null;
  shared?: { project: string; onPlay: () => void }; // a session someone shared: replay only, no composer
}) {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false); // "Ask" with an empty box: the next Enter asks instead of running
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const { settings } = useApp();
  const voice = useVoice((t) => setText((x) => (x.trim() ? `${x.trimEnd()} ${t}` : t)), settings?.learn?.language === 'fr' ? 'fr-FR' : 'en-US');
  useEffect(() => { if (visible) end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.steps.length, visible]);
  const byId = Object.fromEntries(state.steps.map((s) => [s.id, s]));
  // Stay pinned to the newest text while it types in, unless the reader has scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinned = true;
    const onScroll = () => { pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    const ro = new ResizeObserver(() => { if (pinned) el.scrollTop = el.scrollHeight; });
    el.addEventListener('scroll', onScroll);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);
  const mounted = useRef(Date.now()); // messages older than this were already there: no typing animation for them
  const now = useNow(state.running);
  const lastEnd = state.steps.at(-1)?.endedAt;
  const typed = (e: { text: string; at: number }) => <Typed text={e.text} animate={e.at > mounted.current - 1500} />;
  const hl = useHighlight();
  const t = useT();

  // Enter = run (idle) or steer (running). "Ask" opens a side thread that never touches files.
  // While a checkpoint waits for you, what you type is your reply to it (one input box, never two).
  const waiting = !side ? state.timeline.findLast((t) => t.kind === 'checkpoint' && !t.answer) as Extract<State['timeline'][number], { kind: 'checkpoint' }> | undefined : undefined;
  // The agent ended its turn on a question: the box is for the answer.
  const last = state.timeline.at(-1);
  const asked = mode === 'learn' && last?.kind === 'done' && last.text.slice(-600).includes('?');
  // After a finished Learn step (not mid-quiz, not while the tutor waits for an answer), offer a quiz on it.
  const lastAsk = state.timeline.findLast((t) => t.kind === 'user');
  const quizzing = lastAsk?.kind === 'user' && lastAsk.text === QUIZ;
  const canQuiz = mode === 'learn' && !side && !state.running && !waiting && !asked && !quizzing && last?.kind === 'done' && state.steps.length > 0;
  const submit = (kind: 'run' | 'ask' = 'run') => {
    voice.stop();
    if (!text.trim()) return;
    if (asking) kind = 'ask';
    setAsking(false);
    if (kind === 'run' && waiting) onCheckpoint(waiting.id, 'discuss', text.trim());
    else (kind === 'ask' ? onAsk : onRun)(text.trim());
    setText('');
  };

  return (
    <aside className={`agent-panel ${side ? 'side' : ''} ${centered ? 'centered' : ''} ${state.timeline.length ? '' : 'empty'}`}>
      <div className="panel-head">
        <span className="title thread-title" title={title}>{title || 'New thread'}</span>
        {side ? (
          <span className="side-actions">
            <span className="pill">{side.kept ? 'kept' : 'temporary'}</span>
            {!side.kept && <button className="btn ghost sm" onClick={side.onKeep}>Keep</button>}
            <button className="icon-btn" onClick={side.onClose} title="Close" aria-label="Close"><Icon name="x" size={13} /></button>
          </span>
        ) : (
          <>
            <span className="spacer" />
            {header}
          </>
        )}
      </div>

      <div className="timeline" ref={scroller}>
        <div className="timeline-inner">
          {state.timeline.length === 0 && (
            <div className="intro">
              {side ? null : mode === 'learn' ? <>
                <div className="intro-title">What do you want to learn to build?</div>
                <div className="muted">You design, the agent teaches. It asks for your approach first, explains the ideas, and only writes code after you approve.</div>
              </> : <>
                <div className="intro-title">What should we build?</div>
                <div className="muted">Describe a task. When the agent starts working, you'll watch it move through your project on the map.</div>
              </>}
            </div>
          )}
          {state.timeline.map((e, i) => {
            if (e.kind === 'user') return <div key={i} className="bubble-user">{e.text}</div>;
            if (e.kind === 'thought') return <div key={i} className="thought">{typed(e)}</div>;
            if (e.kind === 'checkpoint') return <CheckpointCard key={i} entry={e} onAnswer={onCheckpoint} />;
            if (e.kind === 'learned') return <Learned key={i} entry={e} all={state.concepts} latest={!state.timeline.slice(i + 1).some((x) => x.kind === 'learned')} onTry={side || shared ? undefined : (x) => { setText(x); box.current?.focus(); }} />;
            if (e.kind === 'qa') return (
              <div key={i} className="qa">
                <div className="qa-q"><span className="qa-tag">Ask</span>{e.question}</div>
                <div className="qa-a">{e.answer ? <Markdown text={e.answer} /> : <span className="spin" />}</div>
              </div>
            );
            if (e.kind === 'done' || e.kind === 'error') {
              // Undo for any task that changed files, however it ended (done, stopped, out of steps).
              const canUndo = e.ref && onUndo && !side && state.changed[e.ref] !== 0;
              const undone = e.ref && state.undone.includes(e.ref);
              const later = state.timeline.slice(i + 1).some((x) => (x.kind === 'done' || x.kind === 'error') && x.ref && !state.undone.includes(x.ref) && state.changed[x.ref] !== 0);
              const kept = e.ref ? state.kept[e.ref] : undefined;
              const undoRow = canUndo && (
                <div className="undo-row">
                  {kept ? <span className="muted kept" title={kept.message}>Kept as <span className="mono">{kept.commit}</span> · {kept.message.split('\n')[0]}</span>
                  : undone ? <span className="muted">Undone</span> : (<>
                    {onKeep && !later && <KeepButton disabled={state.running} onKeep={() => onKeep(e.ref!)} />}
                    <button className="btn ghost sm" disabled={state.running}
                      title={later ? 'Puts back the files this task and the later ones changed' : 'Puts back the files this task changed'}
                      onClick={() => confirm(later ? 'Undo this task and every task after it? The files they changed go back to how they were before.' : 'Undo this task? The files it changed go back to how they were before.') && onUndo!(e.ref!)}>
                      <Icon name="undo" size={12} /> Undo
                    </button>
                  </>)}
                </div>
              );
              if (e.kind === 'error') { // a stop you asked for isn't a failure: neutral icon
                const stopped = /^Stopped/.test(e.text);
                return <div key={i} className={`final bad ${stopped ? 'stopped' : ''}`}><div><Icon name={stopped ? 'stop' : 'x'} size={stopped ? 10 : 12} /> {e.text}</div>{undoRow}</div>;
              }
              return <div key={i} className="final">{typed(e)}{undoRow}</div>;
            }
            if (e.kind === 'verify') return <VerifyLine key={i} e={e} />;
            if (e.kind === 'context') return (
              <details key={i} className="context-line">
                <summary>{e.action === 'compact' ? 'Context compacted: the agent continues from a summary' : 'Context cleared: the agent starts fresh from here'}</summary>
                {e.summary && <Markdown text={e.summary} />}
              </details>
            );
            if (e.kind === 'restored') return (
              <div key={i} className="restored muted">
                {e.files.length ? `Restored ${e.files.length} file${e.files.length > 1 ? 's' : ''}: ${e.files.slice(0, 4).map((f) => f.path.split('/').pop()).join(', ')}${e.files.length > 4 ? '…' : ''}` : 'Nothing to restore: the files were already like that.'}
              </div>
            );
            // A burst of tool calls: one quiet line. Live while working, a summary after. Click → steps on the stage.
            if (e.kind !== 'actions') return null;
            const steps = e.steps.map((id) => byId[id]).filter((s) => s && s.name !== 'checkpoint'); // the card says it already
            if (!steps.length) return null;
            const live = steps.some((s) => s.ok === undefined);
            const bad = steps.some((s) => s.ok === false);
            const lastStep = steps.at(-1);
            return (
              <button key={i} className={`work ${live ? 'live' : ''} ${bad ? 'bad' : ''}`} onClick={() => lastStep && onSelect(lastStep.id)} title="Show these steps on the stage"
                onMouseEnter={() => hl.set(steps.map((s) => s.target).filter((t) => !t.startsWith('$')))} onMouseLeave={() => hl.set(null)}>
                <span className="work-icon">{live ? <span className="spin" /> : bad ? <Icon name="x" size={11} /> : <Icon name="check" size={11} />}</span>
                <span className="work-text">{live && lastStep ? (state.approval && lastStep.name === 'run_command' ? `Waiting for your OK to run ${lastStep.args?.command ?? 'a command'}` : stepText(lastStep)) : summarize(steps)}</span>
                {live && lastStep && !state.approval && <span className="work-time">{secs(now - lastStep.startedAt)}</span>}
                <span className="work-count">{steps.length} step{steps.length > 1 ? 's' : ''}</span>
              </button>
            );
          })}
          {state.running && !replaying && !state.approval && !state.timeline.some((t) => t.kind === 'checkpoint' && !t.answer) && state.steps.at(-1)?.ok !== undefined && (
            <div className="work live ghost"><span className="work-icon"><span className="spin" /></span><span className="work-text">Thinking</span><span className="work-time">{secs(now - (lastEnd ?? state.startedAt ?? now))}</span></div>
          )}
          <div ref={end} />
        </div>
      </div>

      {banner && !side && <div className="banner">{banner}</div>}
      {git && !git.repo && !side && !banner && (
        <div className="git-note">No version history in this folder, so the agent's changes can't be undone.
          <button className="btn ghost sm" onClick={git.onInit}>Turn it on</button></div>
      )}
      {problem && !side && <div className="problem"><span className="sdot bad" />{problem}</div>}
      {shared && !replaying ? (
        <div className="composer shared-note">
          <span>{t('A session shared from', 'Une session partagée depuis')} <b>{shared.project || t('another computer', 'un autre ordinateur')}</b>. {t('You can replay it, not run it.', 'Tu peux la revoir, pas la lancer.')}</span>
          <button className="btn primary sm" onClick={shared.onPlay}><Icon name="play" size={10} /> {t('Watch it', 'La regarder')}</button>
        </div>
      ) : replaying ? <div className="composer replay-note">{t('You’re watching a replay. Press', 'Tu regardes une rediffusion. Appuie sur')} <b>● Live</b> {t('(or End) to get back.', '(ou Fin) pour revenir.')}</div> :
      <div className="composer">
        {waiting && <div className="composer-reply">{t('Replying to', 'Réponse à')} <b>{waiting.cp.title || t('the checkpoint', 'l’étape')}</b></div>}
        {canQuiz && !text.trim() && (
          <div className="composer-suggest">
            <button className="btn ghost sm" onClick={() => onRun(QUIZ)} title={t('The tutor asks you 3 short questions about this step, one at a time, and tells you what you got right', 'Le tuteur te pose 3 questions courtes sur cette étape, une à la fois, et te dit ce que tu as juste')}>
              <Icon name="quiz" size={12} /> {t('Quiz me', 'Interroge-moi')}
            </button>
          </div>
        )}
        <textarea
          ref={box}
          value={voice.interim ? `${text}${text && !text.endsWith(' ') ? ' ' : ''}${voice.interim}` : text}
          readOnly={Boolean(voice.interim)}
          rows={centered ? 3 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') setAsking(false); }}
          placeholder={side ? t('Ask a follow-up…', 'Pose une autre question…') : asking ? t('Ask why. It reads the project and the chat, but changes nothing…', 'Demande pourquoi. Il lit le projet et le chat, mais ne change rien…') : waiting ? t('Ask about this step, or say what to change…', 'Pose une question sur cette étape, ou dis ce qu’il faut changer…') : state.running ? t('Steer the agent…', 'Guide l’agent…')
            : asked ? t('Type your answer…', 'Écris ta réponse…') : mode === 'learn' ? t('What do you want to build?', 'Que veux-tu construire ?') : t('Describe a task…', 'Décris une tâche…')}
        />
        <div className="composer-bar">
          {!side && (
            <div className="seg sm" title={state.running ? t('Switch when idle', 'Change quand l’agent est au repos') : t('Build: the agent does the work. Learn: you design, it teaches and only writes code after you approve.', 'Build : l’agent fait le travail. Learn : tu conçois, il t’explique et n’écrit du code qu’après ton accord.')}>
              {(['build', 'learn'] as const).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} disabled={state.running} onClick={() => onMode(m)}>{m === 'build' ? 'Build' : 'Learn'}</button>
              ))}
            </div>
          )}
          {status}
          {!side && <TokenMeter tokens={state.tokens} running={state.running} onContext={onContext} engine={engine} />}
          <ModelPicker disabled={state.running} onOpenSettings={onOpenSettings} lockedTo={hasHistory ? engine : undefined} threadProvider={threadProvider} />
          <span className="spacer" />
          {voiceSupported && (
            <button className={`icon-btn mic ${voice.listening ? 'on' : ''}`} onClick={voice.toggle} aria-label={voice.listening ? t('Stop listening', 'Arrêter l’écoute') : t('Speak your prompt', 'Dicte ta demande')} aria-pressed={voice.listening}
              title={voice.error || (voice.listening ? t('Listening… click to stop', 'J’écoute… clique pour arrêter') : t('Speak your prompt', 'Dicte ta demande'))}><Icon name="mic" size={14} /></button>
          )}
          {!side && <button className={`btn ghost sm ask-btn ${asking ? 'on' : ''}`} onClick={() => { if (text.trim()) submit('ask'); else { setAsking(!asking); box.current?.focus(); } }}
            title={t('Ask why it did something, without interrupting it. The answer reads the project but never changes it', 'Demande pourquoi il a fait quelque chose, sans l’interrompre. La réponse lit le projet mais ne le change jamais')}>{t('Ask why', 'Pourquoi ?')}</button>}
          {state.running && !side
            ? <button className="btn danger round" onClick={onStop} title={t('Stop', 'Arrêter')} aria-label={t('Stop the agent', 'Arrêter l’agent')}><Icon name="stop" size={10} /></button>
            : <button className="btn primary round" onClick={() => submit()} disabled={!text.trim()} title={state.running ? t('Steer', 'Guider') : t('Send', 'Envoyer')} aria-label={state.running ? t('Steer', 'Guider') : t('Send', 'Envoyer')}><Icon name="arrow" size={14} /></button>}
          {state.running && !side && text.trim() && <button className="btn primary round" onClick={() => submit()} title={t('Steer: the agent reads this before its next step', 'Guider : l’agent lit ceci avant sa prochaine étape')} aria-label={t('Steer', 'Guider')}><Icon name="arrow" size={14} /></button>}
        </div>
      </div>}
    </aside>
  );
}

function CheckpointCard({ entry, onAnswer }: { entry: Extract<State['timeline'][number], { kind: 'checkpoint' }>; onAnswer: (id: string, c: 'confirm' | 'discuss' | 'skip', t?: string) => void }) {
  const { cp, answer } = entry;
  const impl = cp.kind === 'implementation';
  return (
    <div className={`checkpoint ${cp.kind} ${answer ? 'done' : ''}`}>
      <div className="callout-head">✦ {impl ? 'Implementation' : 'Design'} checkpoint<span>: {cp.title}</span></div>
      <Markdown text={cp.summary} />
      {cp.additions?.length ? (
        <ul className="cp-additions">{cp.additions.map((a, i) => (
          <li key={i}><b>{a.proposal}</b>{a.detail && <span className="cp-detail">{a.detail}</span>}{a.why && <span className="muted">{a.why}</span>}</li>
        ))}</ul>
      ) : null}
      {cp.files?.length ? <div className="cp-files">{cp.files.map((f) => <span key={f} className="chip mono">{f}</span>)}</div> : null}
      {answer ? (
        <div className={`cp-answer ${answer.choice}`}>{answer.choice === 'confirm' ? (impl ? '✓ You approved this step' : '✓ Design confirmed')
          : answer.choice === 'skip' ? 'You skipped this step' : `You asked: “${answer.text ?? ''}”`}</div>
      ) : (
        <>
          <div className="cp-actions">
            <button className="btn primary" onClick={() => onAnswer(entry.id, 'confirm')}>{impl ? 'Implement this step' : 'Confirm and continue'}</button>
            <button className="btn ghost" onClick={() => onAnswer(entry.id, 'skip')}>Skip this step</button>
          </div>
          <div className="muted cp-hint">{impl ? "The agent can't touch files until you approve. " : ''}Questions? Type them in the box below.</div>
        </>
      )}
    </div>
  );
}

// Keep: commit this task's files with a message the model writes. Shows progress and any error inline.
function KeepButton({ disabled, onKeep }: { disabled: boolean; onKeep: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button className="btn ghost sm" disabled={disabled || busy} title="Commit the files this task changed, with a message written from the change"
        onClick={async () => { setBusy(true); setErr(''); const e = await onKeep(); setBusy(false); if (e) setErr(e); }}>
        {busy ? <span className="spin" /> : <Icon name="check" size={12} />} {busy ? 'Writing the commit…' : 'Keep'}
      </button>
      {err && <span className="problem-inline">{err}</span>}
    </>
  );
}

// A clock that ticks once a second while the agent works (for elapsed times).
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}
const secs = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

// New agent text types itself in (about a second, however long it is); older text and reduced-motion users get it at once.
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const still = !animate || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [n, setN] = useState(still ? text.length : 0);
  useEffect(() => {
    if (still) { setN(text.length); return; }
    let raf = 0;
    const step = Math.max(3, Math.ceil(text.length / 60));
    const tick = () => setN((x) => { const y = Math.min(text.length, x + step); if (y < text.length) raf = requestAnimationFrame(tick); return y; });
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <Markdown text={n >= text.length ? text : text.slice(0, n)} />;
}

// How big the conversation is now (what the model reads on each step) and what this thread has used so far.
// Click: compact (continue from a summary) or clear (start fresh) what the model remembers of this thread.
function TokenMeter({ tokens, running, onContext, engine }: { tokens: State['tokens']; running: boolean; onContext?: (a: 'clear' | 'compact') => Promise<string | null>; engine?: Engine }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState('');
  const wrap = useRef<HTMLSpanElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  if (!tokens.total) return null;
  // Rough window size (Claude models read about 200k, open models usually 128k): past 60% it stays in view.
  const full = tokens.context / (engine === 'claude-code' ? 200_000 : 128_000) > 0.6;
  const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const go = async (a: 'clear' | 'compact') => { setBusy(a); setErr(''); const e = await onContext!(a); setBusy(null); if (e) setErr(e); else setOpen(false); };
  return (
    <span className={`token-meter ${full || open ? '' : 'quiet'}`} ref={wrap}>
      <button className="tm-btn" onClick={() => onContext && setOpen(!open)}
        title={`The model reads about ${tokens.context.toLocaleString()} tokens per step; ${tokens.total.toLocaleString()} used in this thread${tokens.cost ? ` (about $${tokens.cost.toFixed(2)})` : ''}.`}>
        {k(tokens.context)}<span className="muted"> / {k(tokens.total)}</span>
      </button>
      {open && (
        <div className="tm-menu">
          <button disabled={running || Boolean(busy)} onClick={() => go('compact')}><b>{busy === 'compact' ? 'Compacting…' : 'Compact'}</b><span className="muted">Continue from a short summary</span></button>
          <button disabled={running || Boolean(busy)} onClick={() => go('clear')}><b>Clear</b><span className="muted">Start fresh; the chat stays</span></button>
          {(running || err) && <span className="muted tm-note">{err || 'Stop the agent first.'}</span>}
        </div>
      )}
    </span>
  );
}

// The model chip: "engine · model". Grouped by engine; once a thread has history only its own engine's models
// are switchable (each engine keeps its own memory of the conversation).
function ModelPicker({ disabled, onOpenSettings, lockedTo, threadProvider }: { disabled: boolean; onOpenSettings: () => void; lockedTo?: Engine; threadProvider?: string }) {
  const { settings, save, me } = useApp();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  if (!settings) return null;
  // One usable model: nothing to pick (Settings still lists them all).
  if (settings.providers.filter((p) => p.id === settings.activeProvider || usable(p)).length <= 1) return null;
  const selected = settings.providers.find((p) => p.id === settings.activeProvider);
  // A thread locked to the other engine keeps running on its own model, so that's the one to show.
  const active = lockedTo && selected && engineOf(selected) !== lockedTo ? settings.providers.find((p) => p.id === threadProvider) ?? selected : selected;
  const groups: Engine[] = ['native', 'claude-code'];
  return (
    <div className="picker" ref={wrap}>
      <button className="chip" disabled={disabled} onClick={() => setOpen(!open)} title={disabled ? 'Switch models when the agent is idle' : 'Switch model'}>
        {active ? (engineOf(active) === 'claude-code' ? `Claude Code · ${active.name.replace(/^Claude Code · /, '')}` : active.name) : 'Pick a model'} <Icon name="chevron" size={10} className="rot" />
      </button>
      {open && (
        <div className="picker-menu" onMouseLeave={() => setOpen(false)}>
          {groups.map((g) => {
            const list = settings.providers.filter((p) => engineOf(p) === g);
            if (!list.length) return null;
            const locked = lockedTo && lockedTo !== g;
            return (
              <div key={g} className={`picker-group ${locked ? 'locked' : ''}`}>
                <div className="picker-head">{ENGINE_LABEL[g]}{locked && <span className="muted"> · in a new thread</span>}</div>
                {list.map((p) => (
                  <button key={p.id} disabled={locked} className={p.id === settings.activeProvider ? 'on' : ''} onClick={() => { save({ activeProvider: p.id }).catch(() => {}); setOpen(false); }}>
                    <span>{p.name.replace(/^Claude Code · /, '')}</span><span className="muted mono">{p.kind === 'mock' ? 'demo' : p.model}</span>
                    {p.kind !== 'mock' && !p.apiKey && <span className="pill">no key</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {!me?.public && <>
            <button className="manage" onClick={() => { setOpen(false); onOpenSettings(); }}>Models…</button>
          </>}
        </div>
      )}
    </div>
  );
}

// A model you could switch to right now: the demo, or one with a key (Ollama's placeholder key doesn't count: it may not be running).
const usable = (p: Provider) => p.kind === 'mock' || (Boolean(p.apiKey) && !/localhost:11434/.test(p.baseUrl));

// The harness checking the agent's work before accepting "done".
function VerifyLine({ e }: { e: Extract<Entry, { kind: 'verify' }> }) {
  const [open, setOpen] = useState(false);
  const cmd = e.command?.replace(/ --silent$/, '');
  const text = {
    running: `Checking the work: ${cmd}`,
    pass: `Check passed: ${cmd}`,
    fail: `Check failed: ${cmd}. Sent back to the agent`,
    nudge: 'Asked the agent to test its work before finishing',
    declined: 'Check skipped',
    unavailable: `Couldn't check the work: the tool behind ${cmd} isn't installed here`,
  }[e.state];
  return (
    <div className={`verify ${e.state}`}>
      <button className={`work ${e.state === 'running' ? 'live' : ''} ${e.state === 'fail' ? 'bad' : ''}`} onClick={() => e.output && setOpen(!open)}
        title={e.output ? 'Show the output' : undefined}>
        <span className="work-icon">{e.state === 'running' ? <span className="spin" /> : e.state === 'pass' ? <Icon name="check" size={11} /> : e.state === 'fail' ? <Icon name="x" size={11} /> : <Icon name="shield" size={11} />}</span>
        <span className="work-text">{text}</span>
      </button>
      {open && e.output && <pre className={`output ${e.state === 'fail' ? 'bad' : ''}`}>{e.output}</pre>}
    </div>
  );
}
