// One thread. Before any work it's just the conversation, centred. When the agent starts working the stage
// (the map) slides in and becomes the main thing; the chat narrows to a column you can resize. The stage can be
// hidden and comes back on its own the next time the agent starts a task.
import { useEffect, useRef, useState } from 'react';
import { useAgent } from './useAgent';
import { AgentPanel } from './AgentPanel';
import { Stage } from './Stage';
import { Icon } from './icons';
import { HealthDot } from './HealthDot';
import { useHealth, diagnose } from './useHealth';
import { useApp } from './useSettings';
import { Resizer, storedNumber, store } from './Resizer';
import { HighlightContext } from './highlight';
import { useGpu, GpuPanel } from './useGpu';

export function ThreadView({ id, onOpenSettings }: { id: string; onOpenSettings: () => void }) {
  const { state, replay, meta, run, steer, stop, approve, answerCheckpoint, setMode } = useAgent(id);
  const { health, serverDown, recheck } = useHealth();
  const { refreshThreads } = useApp();
  const gpuCtl = useGpu();
  const problem = diagnose(health, serverDown);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sideId, setSideId] = useState<string | null>(null);
  const [chatW, setChatW] = useState(() => storedNumber('chatW', 400));
  useEffect(() => store('chatW', Math.round(chatW)), [chatW]);
  useEffect(() => { refreshThreads(); }, [state.running, state.timeline.length]);

  // The stage appears when there's work to show, and re-opens each time the agent starts a task.
  const hasWork = state.steps.length > 0 || state.running;
  const [stageOpen, setStageOpen] = useState(true);
  const wasRunning = useRef(state.running);
  useEffect(() => {
    if (state.running && !wasRunning.current) setStageOpen(true);
    wasRunning.current = state.running;
  }, [state.running]);
  const showStage = hasWork && stageOpen;

  // Text ↔ map: known files (from the agent's steps and the map) can be lit up from the chat.
  const [lit, setLit] = useState<string[]>([]);
  const known = (p: string) => {
    const files = Object.keys(state.files);
    const clean = p.replace(/^\.\//, '');
    return files.find((f) => f === clean) ?? files.find((f) => f.endsWith('/' + clean)) ?? null;
  };

  const openSide = (question: string) =>
    fetch(`/api/threads/${id}/ask-thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
      .then((r) => r.json()).then((j) => j.id && setSideId(j.id));
  // Clicking a work line in the chat opens that step on the stage.
  const showStep = (stepId: string) => { setStageOpen(true); setSelected(stepId); setSheetOpen(true); };

  const header = (
    <>
      <HealthDot health={health} serverDown={serverDown} onRecheck={recheck} gpu={gpuCtl} />
      {hasWork && !stageOpen && (
        <button className={`tool ${state.running ? 'pulse' : ''}`} onClick={() => setStageOpen(true)} title="Show the map">
          <Icon name="map" size={13} />{state.running && <span className="live-dot" />}
        </button>
      )}
    </>
  );

  return (
    <HighlightContext.Provider value={{ paths: lit, set: (p) => setLit(p ?? []), known }}>
    <div className={`thread ${showStage ? 'split' : 'solo'}`} style={showStage ? { gridTemplateColumns: `${chatW}px 8px minmax(0, 1fr)` } : undefined}>
      <div className="chat-col">
        <AgentPanel state={state} title={meta.title} mode={meta.mode ?? 'build'} onMode={setMode} onCheckpoint={answerCheckpoint}
          problem={gpuCtl.gpu?.managed && gpuCtl.gpu.phase !== 'ready' ? null : problem} onOpenSettings={onOpenSettings}
          banner={gpuCtl.gpu?.managed && gpuCtl.gpu.phase !== 'ready' ? <GpuPanel gpu={gpuCtl.gpu} start={gpuCtl.start} stop={gpuCtl.stop} compact={gpuCtl.gpu.phase !== 'error'} /> : null} replaying={replay.active} header={header} centered={!showStage}
          onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={openSide} onStop={stop} onSelect={showStep} />
        {sideId && <SideThread key={sideId} id={sideId} onClose={() => setSideId(null)} onOpenSettings={onOpenSettings} onSelect={showStep} />}
      </div>
      {showStage && <Resizer onDrag={(dx) => setChatW((w) => Math.max(320, Math.min(760, w + dx)))} onReset={() => setChatW(400)} title="Drag to give the chat or the map more room" />}
      {showStage && (
        <Stage state={state} replay={replay} threadId={id} workspace={String(meta.workspace)}
          selected={selected} onSelect={setSelected} sheetOpen={sheetOpen} setSheetOpen={setSheetOpen}
          approve={approve} onCollapse={() => setStageOpen(false)} lit={lit} />
      )}
    </div>
    </HighlightContext.Provider>
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
