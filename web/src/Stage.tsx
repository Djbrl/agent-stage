// The stage: the map is the main thing. A few quiet floating controls, the agent's current action as a caption,
// details in a sheet only when asked, and the approval prompt when the agent needs you.
import { useEffect, useRef, useState } from 'react';
import { ProjectMap, type MapApi } from './MapCanvas';
import { StepsSheet, stepText } from './StepsSheet';
import type { Replay, State } from './useAgent';
import { Icon } from './icons';
import { store } from './Resizer';

export function Stage({ state, replay, threadId, workspace, selected, onSelect, sheetOpen, setSheetOpen, approve, onCollapse }: {
  state: State; replay: Replay; threadId: string; workspace: string;
  selected: string | null; onSelect: (k: string | null) => void;
  sheetOpen: boolean; setSheetOpen: (o: boolean) => void;
  approve: (id: string, ok: boolean) => void; onCollapse: () => void;
}) {
  const [following, setFollowing] = useState(true);
  const [readmap, setReadmap] = useState(() => { try { return localStorage.getItem('readmap') === 'on'; } catch { return false; } });
  const [legend, setLegend] = useState(false);
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
  const folder = workspace.split('/').pop();

  return (
    <section ref={box} className={`stage ${sheetOpen ? 'with-sheet' : ''} ${stageW < 560 ? 'narrow' : ''}`} style={{ ['--sheet-w' as any]: `${sheetW}px` }}>
      <ProjectMap state={state} selected={selected} onSelect={(f) => { onSelect(f); setSheetOpen(true); }} mapUrl={`/api/threads/${threadId}/map`}
        insets={{ right: sheetOpen ? sheetW + 16 : 0, bottom: state.approval ? 150 : 0, top: 48 }} readmap={readmap}
        following={following} onFollowChange={setFollowing} api={api} />

      <div className="stage-top">
        <div className="stage-where"><Icon name="folder" size={12} />{folder}</div>
        <div className="stage-tools">
          {!following && <button className="tool" onClick={() => api.current?.follow()} title="Let the camera follow the agent again (F)"><Icon name="target" size={13} /> Follow</button>}
          <button className={`tool ${readmap ? 'on' : ''}`} onClick={() => setReadmap(!readmap)} title="What the agent reads (M)"><Icon name="read" size={13} /></button>
          <button className="tool" onClick={() => api.current?.fit()} title="Whole project (0)"><Icon name="fit" size={13} /></button>
          <button className="tool" onClick={() => setLegend(!legend)} title="What the colours mean"><span className="q">?</span></button>
          <button className={`tool steps ${sheetOpen ? 'on' : ''}`} onClick={() => setSheetOpen(!sheetOpen)} title="Steps and changes (S)">
            <Icon name="list" size={13} /> {state.steps.length || ''}{state.steps.some((s) => s.ok === false) && <span className="sdot bad" />}
          </button>
          <button className="tool" onClick={onCollapse} title="Hide the map"><Icon name="collapse" size={13} /></button>
        </div>
      </div>

      {legend && (
        <div className="legend-pop" onClick={() => setLegend(false)}>
          <div><i style={{ background: '#ff5b1f' }} />just edited</div><div><i style={{ background: '#ffa66e' }} />edited earlier</div>
          <div><i style={{ background: '#6b8fc4' }} />read</div><div><i style={{ background: '#f2555a' }} />failed</div>
          <div><i style={{ background: '#4b515c' }} />untouched</div><div><i style={{ background: '#7b8cff' }} />the agent</div>
          <p className="muted">Scroll to zoom, drag to pan. The camera follows the agent until you move it. F follows again.</p>
        </div>
      )}

      {caption && <div className={`caption ${state.approval || pendingCp ? 'wait' : ''}`}>{caption}</div>}

      {replay.active && (
        <div className="replay-pill">
          <button className="icon-btn" onClick={() => replay.step(-1)}><Icon name="chevron" size={12} className="flip" /></button>
          <button className="icon-btn" onClick={() => (replay.playing ? replay.pause() : replay.play())}>{replay.playing ? <Icon name="stop" size={10} /> : <Icon name="play" size={11} />}</button>
          <button className="icon-btn" onClick={() => replay.step(1)}><Icon name="chevron" size={12} /></button>
          <span className="mono">Replay {replay.index + 1}/{replay.total}</span>
          <button className="btn ghost sm live" onClick={replay.live}>● Live</button>
        </div>
      )}

      {state.approval && (
        <div className="approval">
          <div className="approval-head"><Icon name="shield" /> The agent wants to run a command</div>
          <code>$ {state.approval.command}</code>
          <div className="approval-actions">
            <button className="btn ghost" onClick={() => approve(state.approval!.id, false)}>Deny</button>
            <button className="btn primary" onClick={() => approve(state.approval!.id, true)}>Run it</button>
          </div>
        </div>
      )}

      {sheetOpen && <StepsSheet state={state} selected={selected} onSelect={onSelect} onClose={() => { setSheetOpen(false); onSelect(null); }} threadId={threadId} replay={replay} />}
    </section>
  );
}
