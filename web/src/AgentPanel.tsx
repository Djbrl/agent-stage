// Right panel: the conversation, with tool calls collapsed into "Read 1 file, edited 2" groups (text takes a back seat).
import { useEffect, useRef, useState } from 'react';
import type { State, Step } from './useAgent';
import { Icon, TOOL_ICON } from './icons';
import { stepLabel } from './Inspector';
import { Markdown } from './Markdown';

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

export function AgentPanel({ state, model, problem, onRun, onAsk, onStop, onSelect }: {
  state: State; model: string; problem: string | null; onRun: (t: string) => void; onAsk: (t: string) => void; onStop: () => void; onSelect: (id: string) => void;
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
    <aside className="agent-panel">
      <div className="panel-head">
        <span className="title"><Icon name="spark" /> Agent</span>
        <span className={`status ${state.running ? 'on' : ''}`}><span className="dot" />{state.running ? 'Working' : 'Idle'}</span>
      </div>

      <div className="timeline">
        {state.timeline.length === 0 && (
          <div className="intro">
            <div className="intro-title">What should the agent build?</div>
            <div className="muted">You'll watch it move through your project on the map. Stop it, ask it things, and approve every command.</div>
          </div>
        )}
        {state.timeline.map((e, i) => {
          if (e.kind === 'user') return <div key={i} className="bubble-user">{e.text}</div>;
          if (e.kind === 'thought') return <div key={i} className="thought"><Markdown text={e.text} /></div>;
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
                    <Icon name={TOOL_ICON[s.name] ?? 'spark'} size={12} /> {verb} <span className="mono">{what}</span>
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
          placeholder={state.running ? 'Steer the agent, or ask it a question…' : 'Describe a task…'}
        />
        <div className="composer-bar">
          <span className="chip mono">{model}</span>
          <span className="spacer" />
          {state.running && <button className="btn danger" onClick={onStop}><Icon name="stop" size={11} /> Stop</button>}
          <button className="btn ghost" onClick={() => submit('ask')} disabled={!text.trim()} title="Side question: answered now, changes nothing">Ask</button>
          <button className="btn primary round" onClick={() => submit()} disabled={!text.trim()} title={state.running ? 'Steer: the agent reads this before its next step' : 'Run'}>
            <Icon name="arrow" size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
