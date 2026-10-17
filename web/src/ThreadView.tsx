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
import { StepsSheet } from './StepsSheet';
import { Sidebar, type Nav } from './Sidebar';

export type Layout = 'studio' | 'classic';
type Tab = 'chat' | 'steps' | 'threads';
let firstOpen = true; // the app opens on the threads list; picking a thread then lands on its chat
export const landOnChat = () => { firstOpen = false; }; // a thread you just created opens on its chat

export function ThreadView({ id, onOpenSettings, layout = 'classic', nav, onLayout }: {
  id: string; onOpenSettings: () => void; layout?: Layout; nav?: Nav; onLayout?: (l: Layout) => void;
}) {
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

  // Version history: undo needs the folder to be a git repo.
  const [repo, setRepo] = useState<boolean | null>(null);
  useEffect(() => { fetch(`/api/threads/${id}/git`).then((r) => r.json()).then((j) => setRepo(Boolean(j.repo))).catch(() => {}); }, [id]);
  const git = repo === null ? null : { repo, onInit: () => fetch(`/api/threads/${id}/git/init`, { method: 'POST' }).then((r) => r.ok && setRepo(true)) };
  const undo = (ref: string) => fetch(`/api/threads/${id}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref }) })
    .then((r) => r.json()).then((j) => j.error && alert(j.error));
  const keep = (ref: string): Promise<string | null> => fetch(`/api/threads/${id}/keep-task`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref }) })
    .then((r) => r.json()).then((j) => j.error ?? null, () => 'Could not reach the server');

  const header = (
    <>
      {hasWork && !stageOpen && (
        <button className={`tool ${state.running ? 'pulse' : ''}`} onClick={() => setStageOpen(true)} title="Show the map">
          <Icon name="map" size={13} />{state.running && <span className="live-dot" />}
        </button>
      )}
    </>
  );

  // ── studio: the map fills the window; chat, steps and threads are tabs of one floating panel ──
  const [tab, setTab] = useState<Tab>(() => {
    const toured = (() => { try { return localStorage.getItem('toured') === '1'; } catch { return true; } })();
    const t = firstOpen && toured ? 'threads' : 'chat'; // the first-visit tour points at the chat
    firstOpen = false;
    return t;
  });
  const [panelW, setPanelW] = useState(() => storedNumber('panelW', 400));
  const [panelOpen, setPanelOpen] = useState(true);
  const [phone, setPhone] = useState(() => window.innerWidth <= 700);
  useEffect(() => { const r = () => setPhone(window.innerWidth <= 700); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  useEffect(() => store('panelW', Math.round(panelW)), [panelW]);
  // Asking for a step (from the map, a work line or the steps button) shows it in the Steps tab.
  const openSteps = (o: boolean) => { if (o) { setTab('steps'); setPanelOpen(true); } else if (tab === 'steps') setTab('chat'); };
  const pickStep = (stepId: string) => { setSelected(stepId); setTab('steps'); setPanelOpen(true); };
  if (layout === 'studio') {
    const agentPanel = (
      <AgentPanel visible={tab === 'chat'} threadProvider={meta.providerId} state={state} title={meta.title} mode={meta.mode ?? 'build'} onMode={setMode} onCheckpoint={answerCheckpoint}
        status={<HealthDot health={health} serverDown={serverDown} onRecheck={recheck} gpu={gpuCtl} bare />}
        engine={meta.engine ?? 'native'} hasHistory={state.timeline.length > 0}
        problem={gpuCtl.gpu?.managed && gpuCtl.gpu.phase !== 'ready' ? null : problem} onOpenSettings={onOpenSettings}
        banner={gpuCtl.gpu?.managed && gpuCtl.gpu.phase !== 'ready' ? <GpuPanel gpu={gpuCtl.gpu} start={gpuCtl.start} stop={gpuCtl.stop} /> : null}
        replaying={replay.active} centered={false}
        onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={openSide} onStop={stop} onSelect={pickStep} onUndo={undo} onKeep={keep} git={git} />
    );
    const left = panelOpen && !phone ? panelW + 24 : 0; // on phones the panel sits under the map
    return (
      <HighlightContext.Provider value={{ paths: lit, set: (p) => setLit(p ?? []), known }}>
      <div className="studio">
        <Stage state={state} replay={replay} threadId={id} workspace={String(meta.workspace)} full left={left}
          selected={selected} onSelect={(k) => { setSelected(k); if (k) openSteps(true); }} sheetOpen={tab === 'steps' && panelOpen} setSheetOpen={openSteps}
          approve={approve} onCollapse={() => {}} lit={lit} />
        {panelOpen ? (
          <aside className="studio-panel" style={{ width: panelW }}>
            <div className="studio-head">
              <div className="studio-tabs">
                <button className={tab === 'threads' ? 'on' : ''} onClick={() => setTab('threads')}>Threads</button>
                <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat{state.running && !replay.active && <span className="live-dot" />}</button>
                <button className={tab === 'steps' ? 'on' : ''} onClick={() => setTab('steps')}>Steps{state.steps.length ? <span className="count">{state.steps.length}</span> : null}</button>
              </div>
              <button className="icon-btn" onClick={() => setPanelOpen(false)} title="Hide the panel: just the map"><Icon name="chevron" size={13} className="flip" /></button>
            </div>
            <div className="studio-body">
              {/* The chat stays mounted so a half-typed prompt survives a look at the steps. */}
              <div className="studio-pane" hidden={tab !== 'chat'}>{agentPanel}</div>
              {tab === 'steps' && <StepsSheet embedded state={state} selected={selected} onSelect={setSelected} onClose={() => setTab('chat')} threadId={id} replay={replay} />}
              {tab === 'threads' && nav && (
                <div className="studio-pane">
                  <Sidebar embedded railed={false} onToggle={() => {}} {...nav} onSelect={(t) => { if (t === id) setTab('chat'); nav.onSelect(t); }} />
                  {onLayout && <button className="btn ghost sm studio-switch" onClick={() => onLayout('classic')}>Switch to the classic layout</button>}
                </div>
              )}
            </div>
            <Resizer onDrag={(dx) => setPanelW((w) => Math.max(320, Math.min(640, w + dx)))} onReset={() => setPanelW(400)} title="Drag to resize the panel" />
          </aside>
        ) : (
          <button className="studio-reopen" onClick={() => setPanelOpen(true)} title="Show the panel">
            <Icon name="chevron" size={13} />{state.running && <span className="live-dot" />}<span>{meta.title}</span>
          </button>
        )}
        {sideId && <div className="studio-side" style={{ left: left || 16 }}><SideThread key={sideId} id={sideId} onClose={() => setSideId(null)} onOpenSettings={onOpenSettings} onSelect={pickStep} /></div>}
      </div>
      </HighlightContext.Provider>
    );
  }

  return (
    <HighlightContext.Provider value={{ paths: lit, set: (p) => setLit(p ?? []), known }}>
    <div className={`thread ${showStage ? 'split' : 'solo'}`} style={showStage ? { gridTemplateColumns: `${chatW}px 0 minmax(0, 1fr)` } : undefined}>
      <div className="chat-col">
        <AgentPanel threadProvider={meta.providerId} state={state} title={meta.title} mode={meta.mode ?? 'build'} onMode={setMode} onCheckpoint={answerCheckpoint}
          status={<HealthDot health={health} serverDown={serverDown} onRecheck={recheck} gpu={gpuCtl} bare />}
          engine={meta.engine ?? 'native'} hasHistory={state.timeline.length > 0}
          problem={gpuCtl.gpu?.managed && gpuCtl.gpu.phase !== 'ready' ? null : problem} onOpenSettings={onOpenSettings}
          banner={gpuCtl.gpu?.managed && gpuCtl.gpu.phase !== 'ready' ? <GpuPanel gpu={gpuCtl.gpu} start={gpuCtl.start} stop={gpuCtl.stop} /> : null} replaying={replay.active} header={header} centered={!showStage}
          onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={openSide} onStop={stop} onSelect={showStep} onUndo={undo} onKeep={keep} git={git} />
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
