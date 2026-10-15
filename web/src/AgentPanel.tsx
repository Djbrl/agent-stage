// The conversation. Text stays quiet: each burst of tool calls is ONE line ("Editing greet.js · 5 steps"),
// and the detail lives on the stage. What stays prominent: your messages, the agent's words, and anything that
// needs you (checkpoints).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { State, Step } from './useAgent';
import { Icon } from './icons';
import { stepText } from './StepsSheet';
import { Markdown } from './Markdown';
import { useApp } from './useSettings';
import { useHighlight } from './highlight';

function summarize(steps: Step[]) {
  const c = (n: string[]) => steps.filter((s) => n.includes(s.name)).length;
  const parts: string[] = [];
  const read = c(['read_file', 'list_files', 'search']), wrote = c(['write_file', 'edit_file']), ran = c(['run_command']);
  if (wrote) parts.push(`changed ${wrote} file${wrote > 1 ? 's' : ''}`);
  if (ran) parts.push(`ran ${ran} command${ran > 1 ? 's' : ''}`);
  if (read && !parts.length) parts.push(`looked at ${read} thing${read > 1 ? 's' : ''}`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AgentPanel({ state, title, mode, onMode, onCheckpoint, problem, onRun, onAsk, onStop, onSelect, onOpenSettings, side, replaying, header, centered }: {
  state: State; title: string; problem: string | null; onOpenSettings: () => void;
  mode: 'build' | 'learn'; onMode: (m: 'build' | 'learn') => void; onCheckpoint: (id: string, choice: 'confirm' | 'discuss', text?: string) => void;
  onRun: (t: string) => void; onAsk: (t: string) => void; onStop: () => void; onSelect: (id: string) => void;
  side?: { onKeep: () => void; onClose: () => void; kept: boolean };
  replaying?: boolean; header?: ReactNode; centered?: boolean;
}) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.steps.length]);
  const byId = Object.fromEntries(state.steps.map((s) => [s.id, s]));
  const hl = useHighlight();

  // Enter = run (idle) or steer (running). "Ask" opens a side thread that never touches files.
  const submit = (kind: 'run' | 'ask' = 'run') => {
    if (!text.trim()) return;
    (kind === 'ask' ? onAsk : onRun)(text.trim());
    setText('');
  };

  return (
    <aside className={`agent-panel ${side ? 'side' : ''} ${centered ? 'centered' : ''}`}>
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
            <div className="seg" title={state.running ? 'Switch when idle' : 'Build: the agent does the work. Learn: you design, it teaches and only writes code after you approve.'}>
              {(['build', 'learn'] as const).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} disabled={state.running} onClick={() => onMode(m)}>{m === 'build' ? 'Build' : 'Learn'}</button>
              ))}
            </div>
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
            if (e.kind === 'done') return <div key={i} className="final"><Markdown text={e.text} /></div>;
            if (e.kind === 'error') return <div key={i} className="final bad"><Icon name="x" size={13} /> {e.text}</div>;
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
                <span className="work-text">{live && lastStep ? stepText(lastStep) : summarize(steps)}</span>
                <span className="work-count">{steps.length} step{steps.length > 1 ? 's' : ''}</span>
              </button>
            );
          })}
          {state.running && !replaying && !state.timeline.some((t) => t.kind === 'checkpoint' && !t.answer) && state.steps.at(-1)?.ok !== undefined && (
            <div className="work live ghost"><span className="work-icon"><span className="spin" /></span><span className="work-text">Thinking…</span></div>
          )}
          <div ref={end} />
        </div>
      </div>

      {problem && !side && <div className="problem"><span className="sdot bad" />{problem}</div>}
      {replaying ? <div className="composer replay-note">You're watching a replay. Press <b>● Live</b> (or End) to get back.</div> :
      <div className="composer">
        <textarea
          value={text}
          rows={centered ? 3 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={side ? 'Ask a follow-up…' : state.running ? 'Steer the agent…' : mode === 'learn' ? 'What do you want to build?' : 'Describe a task…'}
        />
        <div className="composer-bar">
          <ModelPicker disabled={state.running} onOpenSettings={onOpenSettings} />
          <span className="spacer" />
          {!side && <button className="btn ghost sm" onClick={() => submit('ask')} disabled={!text.trim()} title="Ask in a side thread: it can read the project but never changes it">Ask</button>}
          {state.running && !side
            ? <button className="btn danger round" onClick={onStop} title="Stop"><Icon name="stop" size={10} /></button>
            : <button className="btn primary round" onClick={() => submit()} disabled={!text.trim()} title={state.running ? 'Steer' : 'Send'}><Icon name="arrow" size={14} /></button>}
          {state.running && !side && text.trim() && <button className="btn primary round" onClick={() => submit()} title="Steer: the agent reads this before its next step"><Icon name="arrow" size={14} /></button>}
        </div>
      </div>}
    </aside>
  );
}

function CheckpointCard({ entry, onAnswer }: { entry: Extract<State['timeline'][number], { kind: 'checkpoint' }>; onAnswer: (id: string, c: 'confirm' | 'discuss', t?: string) => void }) {
  const { cp, answer } = entry;
  const [discussing, setDiscussing] = useState(false);
  const [note, setNote] = useState('');
  const impl = cp.kind === 'implementation';
  return (
    <div className={`checkpoint ${cp.kind} ${answer ? 'done' : ''}`}>
      <div className="callout-head">✦ {impl ? 'Implementation' : 'Design'} checkpoint<span>: {cp.title}</span></div>
      <Markdown text={cp.summary} />
      {cp.additions?.length ? (
        <table className="table additions">
          <thead><tr><th>Proposed addition</th><th>Proposal</th><th>Why it matters</th></tr></thead>
          <tbody>{cp.additions.map((a, i) => <tr key={i}><td>{a.detail}</td><td>{a.proposal}</td><td className="muted">{a.why}</td></tr>)}</tbody>
        </table>
      ) : null}
      {cp.files?.length ? <div className="cp-files">{cp.files.map((f) => <span key={f} className="chip mono">{f}</span>)}</div> : null}
      {answer ? (
        <div className={`cp-answer ${answer.choice}`}>{answer.choice === 'confirm' ? (impl ? '✓ You approved this step' : '✓ Design confirmed') : `You asked to discuss${answer.text ? `: “${answer.text}”` : ''}`}</div>
      ) : discussing ? (
        <div className="cp-discuss">
          <textarea autoFocus rows={2} value={note} placeholder="What doesn't make sense yet?" onChange={(e) => setNote(e.target.value)} />
          <div className="row"><button className="btn ghost" onClick={() => setDiscussing(false)}>Back</button>
            <button className="btn primary" onClick={() => onAnswer(entry.id, 'discuss', note.trim() || undefined)}>Send</button></div>
        </div>
      ) : (
        <div className="cp-actions">
          <button className="btn primary" onClick={() => onAnswer(entry.id, 'confirm')}>{impl ? 'Implement this step' : 'Confirm and continue'}</button>
          <button className="btn ghost" onClick={() => setDiscussing(true)}>Discuss</button>
          {impl && <span className="muted lock">The agent can't touch files until you approve.</span>}
        </div>
      )}
    </div>
  );
}

// The model chip in the composer: switch provider without opening settings.
function ModelPicker({ disabled, onOpenSettings }: { disabled: boolean; onOpenSettings: () => void }) {
  const { settings, save } = useApp();
  const [open, setOpen] = useState(false);
  if (!settings) return null;
  const active = settings.providers.find((p) => p.id === settings.activeProvider);
  return (
    <div className="picker">
      <button className="chip" disabled={disabled} onClick={() => setOpen(!open)} title={disabled ? 'Switch models when the agent is idle' : 'Switch model'}>
        {active?.name ?? 'Pick a model'} <Icon name="chevron" size={10} className="rot" />
      </button>
      {open && (
        <div className="picker-menu" onMouseLeave={() => setOpen(false)}>
          {settings.providers.map((p) => (
            <button key={p.id} className={p.id === settings.activeProvider ? 'on' : ''} onClick={() => { save({ activeProvider: p.id }); setOpen(false); }}>
              <span>{p.name}</span><span className="muted mono">{p.kind === 'mock' ? 'demo' : p.model}</span>
              {p.kind !== 'mock' && !p.apiKey && <span className="pill">no key</span>}
            </button>
          ))}
          <button className="manage" onClick={() => { setOpen(false); onOpenSettings(); }}>Manage models…</button>
        </div>
      )}
    </div>
  );
}
