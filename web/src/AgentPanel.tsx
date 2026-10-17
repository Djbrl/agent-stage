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
import { engineOf, ENGINE_LABEL, type Engine } from './api';

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

export function AgentPanel({ visible = true, threadProvider, state, title, mode, onMode, onCheckpoint, problem, onRun, onAsk, onStop, onSelect, onOpenSettings, side, replaying, header, centered, banner, engine, hasHistory, status, onUndo, onKeep, git }: {
  state: State; title: string; problem: string | null; onOpenSettings: () => void;
  mode: 'build' | 'learn'; onMode: (m: 'build' | 'learn') => void; onCheckpoint: (id: string, choice: 'confirm' | 'discuss' | 'skip', text?: string) => void;
  onRun: (t: string) => void; onAsk: (t: string) => void; onStop: () => void; onSelect: (id: string) => void;
  side?: { onKeep: () => void; onClose: () => void; kept: boolean };
  replaying?: boolean; header?: ReactNode; centered?: boolean; banner?: ReactNode; engine?: Engine; hasHistory?: boolean; status?: ReactNode;
  threadProvider?: string; // the model this thread last ran on (shown when the selected model is another engine's)
  visible?: boolean; // the Chat tab can be hidden: scroll to the newest item when it shows again
  onUndo?: (ref: string) => void; onKeep?: (ref: string) => Promise<string | null>; git?: { repo: boolean; onInit: () => void } | null;
}) {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false); // "Ask" with an empty box: the next Enter asks instead of running
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const { settings } = useApp();
  const voice = useVoice((t) => setText((x) => (x.trim() ? `${x.trimEnd()} ${t}` : t)), settings?.learn?.language === 'fr' ? 'fr-FR' : 'en-US');
  useEffect(() => { if (visible) end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.steps.length, visible]);
  const byId = Object.fromEntries(state.steps.map((s) => [s.id, s]));
  const hl = useHighlight();

  // Enter = run (idle) or steer (running). "Ask" opens a side thread that never touches files.
  // While a checkpoint waits for you, what you type is your reply to it (one input box, never two).
  const waiting = !side ? state.timeline.findLast((t) => t.kind === 'checkpoint' && !t.answer) as Extract<State['timeline'][number], { kind: 'checkpoint' }> | undefined : undefined;
  // The agent ended its turn on a question: the box is for the answer.
  const last = state.timeline.at(-1);
  const asked = mode === 'learn' && last?.kind === 'done' && last.text.slice(-600).includes('?');
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
            <button className="icon-btn" onClick={side.onClose} title="Close"><Icon name="x" size={13} /></button>
          </span>
        ) : (
          <>
            <span className="spacer" />
            {header}
          </>
        )}
      </div>

      <div className="timeline">
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
            if (e.kind === 'thought') return <div key={i} className="thought"><Markdown text={e.text} /></div>;
            if (e.kind === 'checkpoint') return <CheckpointCard key={i} entry={e} onAnswer={onCheckpoint} />;
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
              return <div key={i} className="final"><Markdown text={e.text} />{undoRow}</div>;
            }
            if (e.kind === 'verify') return <VerifyLine key={i} e={e} />;
            if (e.kind === 'restored') return (
              <div key={i} className="restored muted">
                {e.files.length ? `Restored ${e.files.length} file${e.files.length > 1 ? 's' : ''}: ${e.files.slice(0, 4).map((f) => f.path.split('/').pop()).join(', ')}${e.files.length > 4 ? '…' : ''}` : 'Nothing to restore: the files were already like that.'}
              </div>
            );
            // A burst of tool calls: one quiet line. Live while working, a summary after. Click → steps on the stage.
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
                <span className="work-count">{steps.length} step{steps.length > 1 ? 's' : ''}</span>
              </button>
            );
          })}
          {state.running && !replaying && !state.approval && !state.timeline.some((t) => t.kind === 'checkpoint' && !t.answer) && state.steps.at(-1)?.ok !== undefined && (
            <div className="work live ghost"><span className="work-icon"><span className="spin" /></span><span className="work-text">Thinking…</span></div>
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
      {replaying ? <div className="composer replay-note">You're watching a replay. Press <b>● Live</b> (or End) to get back.</div> :
      <div className="composer">
        {waiting && <div className="composer-reply">Replying to <b>{waiting.cp.title || 'the checkpoint'}</b></div>}
        <textarea
          ref={box}
          value={voice.interim ? `${text}${text && !text.endsWith(' ') ? ' ' : ''}${voice.interim}` : text}
          readOnly={Boolean(voice.interim)}
          rows={centered ? 3 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') setAsking(false); }}
          placeholder={side ? 'Ask a follow-up…' : asking ? 'Ask a question. It reads the project and the chat, but changes nothing…' : waiting ? 'Ask about this step, or say what to change…' : state.running ? 'Steer the agent…'
            : asked ? 'Type your answer…' : mode === 'learn' ? 'What do you want to build?' : 'Describe a task…'}
        />
        <div className="composer-bar">
          {!side && (
            <div className="seg sm" title={state.running ? 'Switch when idle' : 'Build: the agent does the work. Learn: you design, it teaches and only writes code after you approve.'}>
              {(['build', 'learn'] as const).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} disabled={state.running} onClick={() => onMode(m)}>{m === 'build' ? 'Build' : 'Learn'}</button>
              ))}
            </div>
          )}
          {status}
          {!side && <TokenMeter tokens={state.tokens} />}
          <ModelPicker disabled={state.running} onOpenSettings={onOpenSettings} lockedTo={hasHistory ? engine : undefined} threadProvider={threadProvider} />
          <span className="spacer" />
          {voiceSupported && (
            <button className={`icon-btn mic ${voice.listening ? 'on' : ''}`} onClick={voice.toggle}
              title={voice.error || (voice.listening ? 'Listening… click to stop' : 'Speak your prompt')}><Icon name="mic" size={14} /></button>
          )}
          {!side && <button className={`btn ghost sm ask-btn ${asking ? 'on' : ''}`} onClick={() => { if (text.trim()) submit('ask'); else { setAsking(!asking); box.current?.focus(); } }}
            title="Ask a side question without interrupting the agent. It can read the project but never changes it">Ask</button>}
          {state.running && !side
            ? <button className="btn danger round" onClick={onStop} title="Stop"><Icon name="stop" size={10} /></button>
            : <button className="btn primary round" onClick={() => submit()} disabled={!text.trim()} title={state.running ? 'Steer' : 'Send'}><Icon name="arrow" size={14} /></button>}
          {state.running && !side && text.trim() && <button className="btn primary round" onClick={() => submit()} title="Steer: the agent reads this before its next step"><Icon name="arrow" size={14} /></button>}
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

// How big the conversation is now (what the model reads on each step) and what this thread has used so far.
function TokenMeter({ tokens }: { tokens: State['tokens'] }) {
  if (!tokens.total) return null;
  const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  return (
    <span className="token-meter" title={`The model reads about ${tokens.context.toLocaleString()} tokens on each step now (the conversation so far). This thread has used ${tokens.total.toLocaleString()} tokens in total${tokens.cost ? `, about $${tokens.cost.toFixed(2)}` : ''}.`}>
      {k(tokens.context)}<span className="muted"> / {k(tokens.total)}</span>
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
                <div className="picker-head">{ENGINE_LABEL[g]}{locked && <span className="muted"> · start a new thread to use it</span>}</div>
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
            <div className="picker-group locked"><div className="picker-head">Codex <span className="muted">· coming soon</span></div></div>
            <button className="manage" onClick={() => { setOpen(false); onOpenSettings(); }}>Manage engines…</button>
          </>}
        </div>
      )}
    </div>
  );
}

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
