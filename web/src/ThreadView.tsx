// One thread: the agent conversation on the left, the project map ("the stage") on the right.
import { useEffect, useState } from 'react';
import { ReplayBar } from './ReplayBar';
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
  const [sideId, setSideId] = useState<string | null>(null);
  const openSide = (question: string) =>
    fetch(`/api/threads/${id}/ask-thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
      .then((r) => r.json()).then((j) => j.id && setSideId(j.id));
  const { state, replay, meta, run, ask, steer, stop, approve, answerCheckpoint, setMode } = useAgent(id);
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
      <AgentPanel state={state} title={meta.title} mode={meta.mode ?? 'build'} onMode={setMode} onCheckpoint={answerCheckpoint}
        problem={problem} onOpenSettings={onOpenSettings} replaying={replay.active}
        onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={openSide} onStop={stop} onSelect={setSelected} />
      {sideId && <SideThread key={sideId} id={sideId} onClose={() => setSideId(null)} onOpenSettings={onOpenSettings} onSelect={setSelected} />}

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
          {replay.active && <div className="replay-banner">Replay · step {replay.index + 1} of {replay.total}{replay.at ? ` · ${new Date(replay.at).toLocaleTimeString([], { hour12: false })}` : ''}</div>}
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
        <ReplayBar replay={replay} running={state.running} />
        <Inspector state={state} selected={selected} onSelect={setSelected} threadId={id} />
      </main>
    </div>
  );
}

// Temporary, read-only side thread for questions: it starts from the work thread's context and never touches it.
function SideThread({ id, onClose, onOpenSettings, onSelect }: { id: string; onClose: () => void; onOpenSettings: () => void; onSelect: (k: string) => void }) {
  const { state, meta, run } = useAgent(id);
  const { refreshThreads } = useApp();
  const [kept, setKept] = useState(false);
  const close = () => {
    if (!kept) fetch(`/api/threads/${id}`, { method: 'DELETE' });
    onClose();
  };
  const keep = () => fetch(`/api/threads/${id}/keep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then(() => { setKept(true); refreshThreads(); });
  return (
    <div className="side-thread-wrap">
      <AgentPanel state={state} title={`Ask · ${meta.title}`} mode="build" onMode={() => {}} onCheckpoint={() => {}} problem={null}
        onOpenSettings={onOpenSettings} onRun={run} onAsk={() => {}} onStop={() => {}} onSelect={onSelect} side={{ onKeep: keep, onClose: close, kept }} />
    </div>
  );
}
