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
import { ThreadMenu } from './ThreadMenu';
import { Tips } from './Tips';
import { useT, useLang, serverText } from './i18n';
import { useAsk } from './AskWindow';

export type Layout = 'studio' | 'classic';
type Tab = 'chat' | 'steps' | 'threads';
let firstOpen = true; // the app opens on the threads list; picking a thread then lands on its chat
export const landOnChat = () => { firstOpen = false; }; // a thread you just created opens on its chat

export function ThreadView({ id, onOpenSettings, onMissing, layout = 'classic', nav, onLayout }: {
  id: string; onOpenSettings: () => void; onMissing?: () => void; layout?: Layout; nav?: Nav; onLayout?: (l: Layout) => void;
}) {
  const { state, replay, meta, run, steer, stop, approve, answerCheckpoint, setMode, resetContext } = useAgent(id, onMissing);
  const { health, serverDown, recheck } = useHealth();
  const { refreshThreads, threads, me } = useApp();
  const t = useT();
  const fr = useLang() === 'fr';
  const [following, setFollowing] = useState(true);
  const gpuCtl = useGpu();
  const problem = diagnose(health, serverDown, fr);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const ask = useAsk(id); // side questions in a floating window; the main agent keeps working
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

  const openSide = (question: string) => ask.open({ question: question || undefined, draw: !question });
  const askAbout = (quote: string) => ask.open({ quote });
  // Clicking a work line in the chat opens that step on the stage.
  const showStep = (stepId: string) => { setStageOpen(true); setSelected(stepId); setSheetOpen(true); };

  // Version history: undo needs the folder to be a git repo.
  const [repo, setRepo] = useState<boolean | null>(null);
  useEffect(() => { fetch(`/api/threads/${id}/git`).then((r) => r.json()).then((j) => setRepo(Boolean(j.repo))).catch(() => {}); }, [id]);
  // A session someone shared: replay only (no Undo, Keep, version history or composer).
  const shared = meta.shared ? { project: String(meta.workspace ?? ''), onPlay: () => { setStageOpen(true); replay.play(); } } : undefined;
  const git = repo === null || shared ? null : { repo, onInit: () => fetch(`/api/threads/${id}/git/init`, { method: 'POST' }).then((r) => r.ok && setRepo(true)) };
  const undo = (ref: string) => fetch(`/api/threads/${id}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref }) })
    .then((r) => r.json()).then((j) => j.error && alert(serverText(j.error, fr)));
  const keep = (ref: string): Promise<string | null> => fetch(`/api/threads/${id}/keep-task`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref }) })
    .then((r) => r.json()).then((j) => j.error ?? null, () => t('Could not reach the server. Check that Codetandem is still running.', 'Impossible de joindre le serveur. Vérifie qu’agent-stage tourne encore.'));

  const menu = state.timeline.length > 0 ? <ThreadMenu id={id} mode={meta.mode === 'learn' ? 'learn' : 'build'} running={state.running} onContext={shared ? undefined : resetContext} /> : null;
  const header = (
    <>
      {menu}
      {hasWork && !stageOpen && (
        <button className={`tool ${state.running ? 'pulse' : ''}`} onClick={() => setStageOpen(true)} title={t('Show the map', 'Afficher la carte')}>
          <Icon name="map" size={13} />{state.running && <span className="live-dot" />}
        </button>
      )}
    </>
  );

  // ── studio: the map fills the window; chat, steps and threads are tabs of one floating panel ──
  // The very first open lands on the chat; after that the app reopens on the sessions list (when there are several).
  const [tabPicked, setTab] = useState<Tab>(() => {
    const seen = (() => { try { return localStorage.getItem('opened') === '1'; } catch { return false; } })();
    try { localStorage.setItem('opened', '1'); } catch { /* private window */ }
    const tab = firstOpen && seen ? 'threads' : 'chat';
    firstOpen = false;
    return tab;
  });
  // The panel grows with the thread: Steps once there is a step, Threads once there is more than one thread.
  const showSteps = state.steps.length > 0, showThreads = Boolean(nav) && threads.length > 1;
  const tab: Tab = (tabPicked === 'steps' && !showSteps) || (tabPicked === 'threads' && !showThreads) ? 'chat' : tabPicked;
  const tips = <Tips state={state} following={following} replaying={replay.active} shared={Boolean(meta.shared)} />;
  const [panelW, setPanelW] = useState(() => storedNumber('panelW', 460));
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
        onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={openSide} onAskAbout={askAbout} onStop={stop} onSelect={pickStep} onUndo={shared ? undefined : undo} onKeep={shared ? undefined : keep} git={git} shared={shared} header={menu} />
    );
    const left = panelOpen && !phone ? panelW + 24 : 0; // on phones the panel sits under the map
    return (
      <HighlightContext.Provider value={{ paths: lit, set: (p) => setLit(p ?? []), known }}>
      <div className="studio">
        <Stage state={state} replay={replay} threadId={id} workspace={String(meta.workspace)} full left={left}
          selected={selected} onSelect={(k) => { setSelected(k); if (k) openSteps(true); }} sheetOpen={tab === 'steps' && panelOpen} setSheetOpen={openSteps}
          approve={approve} onCollapse={() => {}} lit={lit} onFollowing={setFollowing} />
        {panelOpen ? (
          <aside className="studio-panel" style={{ width: panelW }}>
            <div className="studio-head">
              {showSteps || showThreads ? (
                <div className="studio-tabs">
                  {showThreads && <button className={`tab-threads ${tab === 'threads' ? 'on' : ''}`} onClick={() => setTab('threads')}>{t('Sessions', 'Sessions')}</button>}
                  <button className={`tab-chat ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>{t('Chat', 'Chat')}{state.running && !replay.active && <span className="live-dot" />}</button>
                  {showSteps && <button className={`tab-steps ${tab === 'steps' ? 'on' : ''}`} onClick={() => setTab('steps')}>{t('Steps', 'Étapes')}<span className="count">{state.steps.length}</span></button>}
                </div>
              ) : <span className="spacer" />}
              {/* Until there's a Threads tab, a new thread and the settings stay one click away. */}
              {nav && !showThreads && <>
                <button className="icon-btn studio-mini" onClick={nav.onNew} title={t('New session', 'Nouvelle session')} aria-label={t('New session', 'Nouvelle session')}><Icon name="plus" size={14} /></button>
              </>}
              <button className="icon-btn" onClick={() => setPanelOpen(false)} title={t('Hide the panel: just the map', 'Masquer le panneau : juste la carte')} aria-label={t('Hide the panel', 'Masquer le panneau')}><Icon name="chevron" size={13} className="flip" /></button>
            </div>
            <div className="studio-body">
              {/* The chat stays mounted so a half-typed prompt survives a look at the steps. */}
              <div className="studio-pane" hidden={tab !== 'chat'}>{agentPanel}</div>
              {tab === 'steps' && <StepsSheet embedded state={state} selected={selected} onSelect={setSelected} onClose={() => setTab('chat')} threadId={id} replay={replay} />}
              {tab === 'threads' && nav && (
                <div className="studio-pane">
                  <Sidebar embedded railed={false} onToggle={() => {}} {...nav} onSelect={(t) => { if (t === id) setTab('chat'); nav.onSelect(t); }} />
                  {onLayout && <button className="btn ghost sm studio-switch" onClick={() => onLayout('classic')}>{t('Switch to the classic layout', 'Passer à la disposition classique')}</button>}
                </div>
              )}
            </div>
            <Resizer onDrag={(dx) => setPanelW((w) => Math.max(320, Math.min(640, w + dx)))} onReset={() => setPanelW(400)} title={t('Drag to resize the panel', 'Glisse pour redimensionner le panneau')} />
          </aside>
        ) : (
          <button className="studio-reopen" onClick={() => setPanelOpen(true)} title={t('Show the panel', 'Afficher le panneau')}>
            <Icon name="chevron" size={13} />{state.running && <span className="live-dot" />}<span>{!meta.title || meta.title === 'New thread' ? t('New session', 'Nouvelle session') : meta.title}</span>
          </button>
        )}
        {tips}
        {ask.layer}
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
          onRun={(t) => (state.running ? steer(t) : run(t))} onAsk={openSide} onAskAbout={askAbout} onStop={stop} onSelect={showStep} onUndo={shared ? undefined : undo} onKeep={shared ? undefined : keep} git={git} shared={shared} />
      </div>
      {showStage && <Resizer onDrag={(dx) => setChatW((w) => Math.max(320, Math.min(760, w + dx)))} onReset={() => setChatW(400)} title={t('Drag to give the chat or the map more room', 'Glisse pour donner plus de place au chat ou à la carte')} />}
      {showStage && (
        <Stage state={state} replay={replay} threadId={id} workspace={String(meta.workspace)}
          selected={selected} onSelect={setSelected} sheetOpen={sheetOpen} setSheetOpen={setSheetOpen}
          approve={approve} onCollapse={() => setStageOpen(false)} lit={lit} onFollowing={setFollowing} />
      )}
      {tips}
      {ask.layer}
    </div>
    </HighlightContext.Provider>
  );
}
