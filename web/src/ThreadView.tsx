// One thread: the agent conversation on the left, the project map ("the stage") on the right.
import { useEffect, useState } from 'react';
import { useAgent } from './useAgent';
import { ProjectMap } from './MapCanvas';
import { AgentPanel } from './AgentPanel';
import { Inspector } from './Inspector';
import { Icon } from './icons';
import { StatusBar } from './StatusBar';
import { useHealth, diagnose } from './useHealth';
import { useApp } from './useSettings';
import { shortPath } from './api';

export function ThreadView({ id, onOpenSettings }: { id: string; onOpenSettings: () => void }) {
  const { state, meta, run, ask, steer, stop, approve } = useAgent(id);
  const { health, serverDown, recheck } = useHealth();
  const { me, refreshThreads } = useApp();
  const problem = diagnose(health, serverDown);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.running]);
  useEffect(() => { refreshThreads(); }, [state.running, state.timeline.length]);

  const elapsed = state.startedAt ? Math.max(0, Math.round(((state.running ? now : state.steps.at(-1)?.endedAt ?? now) - state.startedAt) / 1000)) : 0;

  return (
    <div className="thread">
      <AgentPanel state={state} title={meta.title} problem={problem} onOpenSettings={onOpenSettings}
        onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={ask} onStop={stop} onSelect={setSelected} />

      <main className="surface">
        <div className="surface-head">
          <span className="title"><Icon name="folder" size={13} />{String(meta.workspace).split('/').pop()}</span>
          <span className="muted mono path">{shortPath(String(meta.workspace), me?.home)}</span>
          <span className="spacer" />
          {state.startedAt && <span className="muted mono">{elapsed}s</span>}
          <StatusBar health={health} serverDown={serverDown} onRecheck={recheck} />
        </div>
        <div className="canvas">
          <ProjectMap state={state} selected={selected} onSelect={(f) => setSelected(f)} mapUrl={`/api/threads/${id}/map`} />
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
    </div>
  );
}
