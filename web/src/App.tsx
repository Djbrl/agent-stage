import { useState } from 'react';
import { useAgent, type Step } from './useAgent';
import { ProjectMap } from './Map';

const VERB: Record<string, string> = {
  list_files: 'scanned the workspace', read_file: 'read', write_file: 'wrote', edit_file: 'edited',
  search: 'searched for', run_command: 'ran',
};

function label(s: Step) {
  const what = s.name === 'run_command' ? s.args.command : s.name === 'search' ? `"${s.args.text}"` : s.args.path ?? '';
  return `${VERB[s.name] ?? s.name} ${what}`;
}

export function App() {
  const { state, meta, run, ask, stop, approve, reset } = useAgent();
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    state.running ? ask(text) : run(text);
    setText('');
  };

  return (
    <div className="app">
      <header>
        <strong>agent-stage</strong>
        <span className="meta">{meta.model} · {meta.workspace}</span>
        <span className={`status ${state.running ? 'on' : ''}`}>{state.running ? 'working' : 'idle'}</span>
        {state.running && <button className="stop" onClick={stop}>■ Stop</button>}
        {!state.running && <button className="ghost" onClick={reset}>New session</button>}
      </header>

      <main>
        <section className="stage">
          <ProjectMap state={state} />
          {state.approval && (
            <div className="approval">
              <div>The agent wants to run</div>
              <code>{state.approval.command}</code>
              <div className="row">
                <button onClick={() => approve(state.approval!.id, true)}>Allow</button>
                <button className="ghost" onClick={() => approve(state.approval!.id, false)}>Deny</button>
              </div>
            </div>
          )}
        </section>

        <aside>
          <div className="feed">
            {state.feed.map((f, i) => <div key={i} className={`msg ${f.kind}`}>{f.text}</div>)}
          </div>
          <ol className="steps">
            {state.steps.map((s) => (
              <li key={s.id} className={s.ok === false ? 'bad' : s.ok ? 'good' : 'pending'} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span className="dot" />{label(s)}
                {open === s.id && s.output && <pre>{s.output}</pre>}
              </li>
            ))}
          </ol>
          <form onSubmit={submit}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit(e)}
              placeholder={state.running ? 'Ask or steer the agent mid-run…' : 'Give the agent a task…'}
            />
            <button type="submit">{state.running ? 'Ask' : 'Run'}</button>
          </form>
        </aside>
      </main>
    </div>
  );
}
