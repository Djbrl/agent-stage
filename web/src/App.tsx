import { useEffect, useState } from 'react';
import { useAgent } from './useAgent';
import { ProjectMap } from './Map';
import { AgentPanel } from './AgentPanel';
import { Inspector } from './Inspector';
import { Icon } from './icons';

export function App() {
  const { state, meta, run, ask, steer, stop, approve, reset } = useAgent();
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.running]);

  const counts = Object.values(state.files).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>);
  const elapsed = state.startedAt ? Math.max(0, Math.round(((state.running ? now : state.steps.at(-1)?.endedAt ?? now) - state.startedAt) / 1000)) : 0;
  const workspace = String(meta.workspace).split('/').slice(-2).join('/');

  return (
    <div className="frame">
      <header className="topbar">
        <div className="brand"><span className="logo" />agent-stage</div>
        <span className="crumb-sep">/</span>
        <span className="crumb mono">{workspace}</span>
        <span className="spacer" />
        {state.startedAt && <span className="muted mono">{elapsed}s</span>}
        <button className="btn ghost" onClick={() => { setSelected(null); reset(); }} disabled={state.running}>
          <Icon name="plus" size={12} /> New session
        </button>
      </header>

      <div className="body">
        <main className="surface">
          <div className="surface-head">
            <span className="title">Project map</span>
            <span className="legend">
              <span className="lg read" /> read {counts.read ?? 0}
              <span className="lg written" /> changed {counts.written ?? 0}
              <span className="lg error" /> failed {counts.error ?? 0}
            </span>
          </div>
          <div className="canvas">
            <ProjectMap state={state} selected={selected} onSelect={(f) => setSelected(f)} />
            {state.approval && (
              <div className="approval">
                <div className="approval-head"><Icon name="shield" /> Approve command</div>
                <code>$ {state.approval.command}</code>
                <div className="approval-actions">
                  <button className="btn ghost" onClick={() => approve(state.approval!.id, false)}>Deny</button>
                  <button className="btn primary" onClick={() => approve(state.approval!.id, true)}>Run it</button>
                </div>
              </div>
            )}
          </div>
          <Inspector state={state} selected={selected} onSelect={setSelected} />
        </main>

        <AgentPanel state={state} model={meta.model} onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={ask} onStop={stop} onSelect={setSelected} />
      </div>
    </div>
  );
}
