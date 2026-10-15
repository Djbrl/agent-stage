// Left panel: the conversation, with tool calls collapsed into "Read 1 file, edited 2" groups (text takes a back seat).
import { useEffect, useRef, useState } from 'react';
import type { State, Step } from './useAgent';
import { Icon, TOOL_ICON } from './icons';
import { stepLabel } from './Inspector';
import { Markdown } from './Markdown';
import { useApp } from './useSettings';

function summarize(steps: Step[]) {
  const c = (n: string[]) => steps.filter((s) => n.includes(s.name)).length;
  const parts: string[] = [];
  const read = c(['read_file']), wrote = c(['write_file', 'edit_file']), ran = c(['run_command']), looked = c(['list_files', 'search']);
  if (looked) parts.push('explored the project');
  if (read) parts.push(`read ${read} file${read > 1 ? 's' : ''}`);
  if (wrote) parts.push(`changed ${wrote} file${wrote > 1 ? 's' : ''}`);
  if (ran) parts.push(`ran ${ran} command${ran > 1 ? 's' : ''}`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AgentPanel({ state, title, mode, onMode, onCheckpoint, problem, onRun, onAsk, onStop, onSelect, onOpenSettings, side }: {
  state: State; title: string; problem: string | null; onOpenSettings: () => void;
  side?: { onKeep: () => void; onClose: () => void; kept: boolean };
  mode: 'build' | 'learn'; onMode: (m: 'build' | 'learn') => void; onCheckpoint: (id: string, choice: 'confirm' | 'discuss', text?: string) => void; onRun: (t: string) => void; onAsk: (t: string) => void; onStop: () => void; onSelect: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.timeline.length, state.steps.length]);
  const byId = Object.fromEntries(state.steps.map((s) => [s.id, s]));

  // Enter = run (idle) or steer (running). The "Ask" button sends a side question that never touches files.
  const submit = (mode: 'run' | 'ask' = 'run') => {
    if (!text.trim()) return;
    (mode === 'ask' ? onAsk : onRun)(text.trim());
    setText('');
  };

  return (
    <aside className={`agent-panel ${side ? 'side' : ''}`}>
      <div className="panel-head">
        <span className="title thread-title" title={title}>{title || 'New thread'}</span>
        {side ? (
          <span className="side-actions">
            <span className="pill">{side.kept ? 'kept' : 'temporary'}</span>
            {!side.kept && <button className="btn ghost sm" onClick={side.onKeep}>Keep</button>}
            <button className="icon-btn" onClick={side.onClose} title="Close"><Icon name="x" size={13} /></button>
          </span>
        ) : <div className="seg" title={state.running ? 'Switch when idle' : 'Build: the agent does the work. Learn: you design, it teaches and implements what you agree.'}>
          {(['build', 'learn'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} disabled={state.running} onClick={() => onMode(m)}>{m === 'build' ? 'Build' : 'Learn'}</button>
          ))}
        </div>}
        <span className={`status ${state.running ? 'on' : ''}`}><span className="dot" />{state.running ? 'Working' : 'Idle'}</span>
      </div>

      <div className="timeline">
        {state.timeline.length === 0 && (
          <div className="intro">
            {mode === 'learn' ? <>
              <div className="intro-title">What do you want to learn to build?</div>
              <div className="muted">In Learn mode you design and the agent teaches: it asks for your approach first, explains concepts, and can only write code after you confirm an Implementation checkpoint.</div>
            </> : <>
              <div className="intro-title">What should the agent build?</div>
              <div className="muted">You'll watch it move through your project on the map. Stop it, ask it things, and approve every command.</div>
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
          if (e.kind === 'done') return <div key={i} className="final"><Icon name="check" size={13} /> <Markdown text={e.text} /></div>;
          if (e.kind === 'error') return <div key={i} className="final bad"><Icon name="x" size={13} /> {e.text}</div>;
          const steps = e.steps.map((id) => byId[id]).filter(Boolean);
          const live = steps.some((s) => s.ok === undefined);
          const bad = steps.some((s) => s.ok === false);
          return (
            <div key={i} className="group">
              <button className="group-head" onClick={() => setOpen({ ...open, [i]: !open[i] })}>
                <Icon name="chevron" size={12} className={open[i] ? 'rot' : ''} />
                <span>{summarize(steps)}</span>
                {live && <span className="spin" />}
                {bad && <span className="pill err">error</span>}
              </button>
              {open[i] && steps.map((s) => {
                const { verb, what } = stepLabel(s);
                return (
                  <div key={s.id} className={`group-row ${s.ok === false ? 'bad' : ''}`} onClick={() => onSelect(s.id)}>
                    <Icon name={TOOL_ICON[s.name] ?? 'spark'} size={12} />
                    <span className="gr-text">{s.label ? <span>{s.label}</span> : <>{verb} <span className="mono">{what}</span></>}
                      {s.why && <span className="gr-why">{s.why}</span>}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {problem && <div className="problem"><span className="sdot bad" />{problem}</div>}
      <div className="composer">
        <textarea
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={side ? 'Ask a follow-up…' : state.running ? 'Steer the agent, or ask it a question…' : 'Describe a task…'}
        />
        <div className="composer-bar">
          <ModelPicker disabled={state.running} onOpenSettings={onOpenSettings} />
          <span className="spacer" />
          {state.running && <button className="btn danger" onClick={onStop}><Icon name="stop" size={11} /> Stop</button>}
          {!side && <button className="btn ghost" onClick={() => submit('ask')} disabled={!text.trim()} title="Opens a temporary side thread to answer your question. It can read the project but never changes it.">Ask</button>}
          <button className="btn primary round" onClick={() => submit()} disabled={!text.trim()} title={state.running ? 'Steer: the agent reads this before its next step' : 'Run'}>
            <Icon name="arrow" size={14} />
          </button>
        </div>
      </div>
    </aside>
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
          {impl && <span className="muted lock">🔒 The agent can't touch files until you approve.</span>}
        </div>
      )}
    </div>
  );
}
