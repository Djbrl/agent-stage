// The stage: the map is the main thing. A few quiet floating controls, the agent's current action as a caption,
// details in a sheet only when asked, and the approval prompt when the agent needs you.
import { useEffect, useRef, useState } from 'react';
import { ProjectMap, mapPalette, type MapApi } from './MapCanvas';
import { StepsSheet, stepText, shotOf, pageOf } from './StepsSheet';
import type { Replay, State } from './useAgent';
import { Icon } from './icons';
import { store } from './Resizer';
import { useDismiss } from './dismiss';
import { baseName } from './api';

export function Stage({ state, replay, threadId, workspace, selected, onSelect, sheetOpen, setSheetOpen, approve, onCollapse, lit, full, left = 0 }: {
  state: State; replay: Replay; threadId: string; workspace: string;
  selected: string | null; onSelect: (k: string | null) => void;
  sheetOpen: boolean; setSheetOpen: (o: boolean) => void;
  approve: (id: string, ok: boolean) => void; onCollapse: () => void; lit: string[];
  full?: boolean; left?: number; // studio layout: the map fills the window, a panel floats over its left side
}) {
  const [following, setFollowing] = useState(true);
  const [readmap, setReadmap] = useState(() => { try { return localStorage.getItem('readmap') === 'on'; } catch { return false; } });
  const [legend, setLegend] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null), legendBtn = useRef<HTMLButtonElement>(null);
  useDismiss(legend, () => setLegend(false), legendRef, legendBtn);
  const api = useRef<MapApi | null>(null);
  // The sheet never takes more than half the stage, so the map always stays visible.
  const box = useRef<HTMLElement>(null);
  const [stageW, setStageW] = useState(900);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setStageW(e.contentRect.width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const sheetW = Math.round(Math.min(340, stageW * 0.5));
  useEffect(() => store('readmap', readmap ? 'on' : 'off'), [readmap]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || document.querySelector('.modal-back, .tour')) return;
      if (e.key === 'm' || e.key === 'M') setReadmap((x) => !x);
      if (e.key === 's' || e.key === 'S') setSheetOpen(!sheetOpen);
      if (e.key === 'Escape' && sheetOpen) setSheetOpen(false);
      if (e.key === ' ') { e.preventDefault(); replay.playing ? replay.pause() : replay.play(); }
      if (e.key === 'ArrowLeft') replay.step(-1);
      if (e.key === 'ArrowRight') replay.step(1);
      if (e.key === 'End' && replay.active) replay.live();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const last = state.steps.at(-1);
  const pendingCp = state.timeline.some((t) => t.kind === 'checkpoint' && !t.answer);
  const caption = replay.active ? (last ? stepText(last) : '')
    : state.approval ? 'Waiting for your approval' : pendingCp ? 'Waiting for your decision'
    : state.running ? (last && last.endedAt === undefined ? stepText(last) : 'Thinking…') : '';
  const folder = baseName(workspace);
  // A little browser window on the stage while the agent is using the browser.
  const recent = state.steps.slice(-3).reverse().find((s) => shotOf(s));
  const browserShot = !sheetOpen || full ? recent : undefined;
  const inline = sheetOpen && !full; // in the studio the steps live in the left panel

  return (
    <section ref={box} className={`stage ${inline ? 'with-sheet' : ''} ${full ? 'full' : ''} ${stageW < 560 ? 'narrow' : ''}`} style={{ ['--sheet-w' as any]: `${sheetW}px`, ['--left' as any]: `${left}px` }}>
      <ProjectMap state={state} selected={selected} onSelect={(f) => { onSelect(f); setSheetOpen(true); }} mapUrl={`/api/threads/${threadId}/map`}
        insets={{ right: inline ? sheetW + 16 : 0, bottom: state.approval ? 150 : 0, top: 48, left }} readmap={readmap}
        following={following} onFollowChange={setFollowing} api={api} lit={lit} />

      <div className="stage-top">
        <div className="stage-where">{folder}</div>
        <div className="stage-tools">
          {!following && <button className="tool" onClick={() => api.current?.follow()} title="Let the camera follow the agent again (F)"><Icon name="target" size={13} /> Follow</button>}
          <button className={`tool ${readmap ? 'on' : ''}`} onClick={() => setReadmap(!readmap)} title="What the agent reads (M)" aria-label="What the agent reads" aria-pressed={readmap}><Icon name="read" size={13} /></button>
          <button className="tool" onClick={() => api.current?.fit()} title="Whole project (0)" aria-label="Show the whole project"><Icon name="fit" size={13} /></button>
          <button ref={legendBtn} className="tool" onClick={() => setLegend(!legend)} title="What the colours mean"><span className="q">?</span></button>
          <button className={`tool steps ${sheetOpen ? 'on' : ''}`} onClick={() => setSheetOpen(!sheetOpen)} title="Steps and changes (S)">
            <Icon name="list" size={13} /> {state.steps.length || ''}{state.steps.some((s) => s.ok === false) && <span className="sdot bad" />}
          </button>
          {!full && <button className="tool" onClick={onCollapse} title="Hide the map" aria-label="Hide the map"><Icon name="collapse" size={13} /></button>}
        </div>
      </div>

      {legend && (() => { const pal = mapPalette(); return (
        <div ref={legendRef} className="legend-pop" onClick={() => setLegend(false)}>
          <div><i style={{ background: pal.hot }} />just edited</div><div><i style={{ background: pal.warm }} />edited earlier</div>
          <div><i style={{ background: pal.read }} />read</div><div><i style={{ background: pal.red }} />failed</div>
          <div><i style={{ background: `rgba(${pal.line},${pal.fileFill * 2})`, boxShadow: `inset 0 0 0 1px rgba(${pal.line},${pal.fileStroke})` }} />untouched</div><div><i style={{ background: pal.accent }} />the agent</div>
          <p className="muted">Scroll to zoom, drag to pan. The camera follows the agent until you move it. F follows again.</p>
        </div>
      ); })()}

      {browserShot && (
        <button className="browser-win" onClick={() => { onSelect(browserShot.id); setSheetOpen(true); }} title="Open this step">
          <div className="browser-bar"><Icon name="globe" size={11} /><span className="mono">{pageOf(browserShot)}</span></div>
          <img src={shotOf(browserShot)!} alt="" />
        </button>
      )}

      {caption && <div className={`caption ${state.approval || pendingCp ? 'wait' : ''}`}>{caption}</div>}

      {replay.active && (
        <div className="replay-pill">
          <button className="icon-btn" onClick={() => replay.step(-1)} aria-label="Previous step"><Icon name="chevron" size={12} className="flip" /></button>
          <button className="icon-btn" onClick={() => (replay.playing ? replay.pause() : replay.play())} aria-label={replay.playing ? 'Pause' : 'Play'}>{replay.playing ? <Icon name="stop" size={10} /> : <Icon name="play" size={11} />}</button>
          <button className="icon-btn" onClick={() => replay.step(1)} aria-label="Next step"><Icon name="chevron" size={12} /></button>
          <span className="mono">Replay · step {replay.stepIndex}/{replay.stepTotal}</span>
          <button className="btn ghost sm live" onClick={replay.live}>● Live</button>
        </div>
      )}

      {state.approval && (
        <div className="approval">
          <div className="approval-head"><Icon name="shield" /> {state.approval.check ? 'agent-stage wants to check the work by running its tests' : state.approval.command.startsWith('browse ') ? 'The agent wants to visit a website' : state.approval.command.startsWith('open ') ? 'The agent wants to open something on your computer' : 'The agent wants to run a command'}</div>
          <code>$ {state.approval.command}</code>
          <div className="approval-actions">
            <button className="btn ghost" onClick={() => approve(state.approval!.id, false)}>Deny</button>
            <button className="btn primary" onClick={() => approve(state.approval!.id, true)}>Run it</button>
          </div>
        </div>
      )}

      {inline && <StepsSheet state={state} selected={selected} onSelect={onSelect} onClose={() => { setSheetOpen(false); onSelect(null); }} threadId={threadId} replay={replay} />}
    </section>
  );
}
