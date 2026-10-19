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
import { setAnchor } from './Tips';
import { useT, useLang } from './i18n';

export function Stage({ state, replay, threadId, workspace, selected, onSelect, sheetOpen, setSheetOpen, approve, onCollapse, lit, full, left = 0, onFollowing }: {
  state: State; replay: Replay; threadId: string; workspace: string;
  selected: string | null; onSelect: (k: string | null) => void;
  sheetOpen: boolean; setSheetOpen: (o: boolean) => void;
  approve: (id: string, ok: boolean) => void; onCollapse: () => void; lit: string[];
  full?: boolean; left?: number; // studio layout: the map fills the window, a panel floats over its left side
  onFollowing?: (f: boolean) => void; // the tips want to know when you take the camera
}) {
  const t = useT();
  const fr = useLang() === 'fr';
  const [following, setFollowingState] = useState(true);
  const setFollowing = (f: boolean) => { setFollowingState(f); onFollowing?.(f); };
  // The tools show up once there's something to look at: an empty map needs none of them.
  const history = state.steps.length > 0;
  const [readmap, setReadmap] = useState(() => { try { return localStorage.getItem('readmap') === 'on'; } catch { return false; } });
  const [legend, setLegend] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null), legendBtn = useRef<HTMLButtonElement>(null);
  useDismiss(legend, () => setLegend(false), legendRef, legendBtn);
  const api = useRef<MapApi | null>(null);
  useEffect(() => { setAnchor('agent', () => api.current?.marker() ?? null); return () => setAnchor('agent', null); }, []);
  // Moving through the steps (scroll or click in the Steps list): the camera goes back to following the agent.
  useEffect(() => { const f = () => api.current?.follow(); window.addEventListener('map-follow', f); return () => window.removeEventListener('map-follow', f); }, []);
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
      if (tag === 'TEXTAREA' || tag === 'INPUT' || document.querySelector('.modal-back')) return;
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
  const caption = replay.active ? (last ? stepText(last, fr) : '')
    : state.approval ? t('Waiting for your approval', 'En attente de ton accord') : pendingCp ? t('Waiting for your decision', 'En attente de ta décision')
    : state.running ? (last && last.endedAt === undefined ? stepText(last, fr) : t('Thinking…', 'Réflexion…')) : '';
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
        {history && <div className="stage-tools tools-in">
          {!following && <button className="tool follow-tool" onClick={() => api.current?.follow()} title={t('Let the camera follow the agent again (F)', 'La caméra suit de nouveau l’agent (F)')}><Icon name="target" size={13} /> {t('Follow', 'Suivre')}</button>}
          {!state.running && !replay.active && state.steps.length > 1 && <button className="tool replay-tool" onClick={replay.play} title={t('Watch the agent do it again on the map (Space)', 'Revoir le travail de l’agent sur la carte (Espace)')} aria-label={t('Replay', 'Revoir')}><Icon name="play" size={11} /></button>}
          <button className={`tool ${readmap ? 'on' : ''}`} onClick={() => setReadmap(!readmap)} title={t('What the agent reads (M)', 'Ce que lit l’agent (M)')} aria-label={t('What the agent reads', 'Ce que lit l’agent')} aria-pressed={readmap}><Icon name="read" size={13} /></button>
          <button className="tool" onClick={() => api.current?.fit()} title={t('Whole project (0)', 'Tout le projet (0)')} aria-label={t('Show the whole project', 'Voir tout le projet')}><Icon name="fit" size={13} /></button>
          <button ref={legendBtn} className="tool" onClick={() => setLegend(!legend)} title={t('What the colours mean', 'Ce que veulent dire les couleurs')} aria-label={t('What the colours mean', 'Ce que veulent dire les couleurs')}><span className="q">?</span></button>
          {!full && <button className={`tool steps ${sheetOpen ? 'on' : ''}`} onClick={() => setSheetOpen(!sheetOpen)} title={t('Steps and changes (S)', 'Étapes et changements (S)')}>
            <Icon name="list" size={13} /> {state.steps.length || ''}{state.steps.some((s) => s.ok === false) && <span className="sdot bad" />}
          </button>}
          {!full && <button className="tool" onClick={onCollapse} title={t('Hide the map', 'Masquer la carte')} aria-label={t('Hide the map', 'Masquer la carte')}><Icon name="collapse" size={13} /></button>}
        </div>}
      </div>

      {legend && (() => { const pal = mapPalette(); return (
        <div ref={legendRef} className="legend-pop" onClick={() => setLegend(false)}>
          <div><i style={{ background: pal.hot }} />{t('just edited', 'modifié à l’instant')}</div><div><i style={{ background: pal.warm }} />{t('edited earlier', 'modifié plus tôt')}</div>
          <div><i style={{ background: pal.read }} />{t('read', 'lu')}</div><div><i style={{ background: pal.red }} />{t('failed', 'en échec')}</div>
          <div><i style={{ background: `rgba(${pal.line},${pal.fileFill * 2})`, boxShadow: `inset 0 0 0 1px rgba(${pal.line},${pal.fileStroke})` }} />{t('untouched', 'pas touché')}</div><div><i style={{ background: pal.accent }} />{t('the agent', 'l’agent')}</div>
          <p className="muted">{t('Scroll to zoom, drag to pan. The camera follows the agent until you move it. F follows again.', 'Fais défiler pour zoomer, glisse pour te déplacer. La caméra suit l’agent jusqu’à ce que tu la bouges. F la fait suivre de nouveau.')}</p>
        </div>
      ); })()}

      {browserShot && (
        <button className="browser-win" onClick={() => { onSelect(browserShot.id); setSheetOpen(true); }} title={t('Open this step', 'Ouvrir cette étape')}>
          <div className="browser-bar"><Icon name="globe" size={11} /><span className="mono">{pageOf(browserShot) || t('browser', 'navigateur')}</span></div>
          <img src={shotOf(browserShot)!} alt="" />
        </button>
      )}

      {caption && <div className={`caption ${state.approval || pendingCp ? 'wait' : ''}`}>{caption}</div>}

      {replay.active && (
        <div className="replay-pill">
          <button className="icon-btn" onClick={() => replay.step(-1)} aria-label={t('Previous step', 'Étape précédente')}><Icon name="chevron" size={12} className="flip" /></button>
          <button className="icon-btn" onClick={() => (replay.playing ? replay.pause() : replay.play())} aria-label={replay.playing ? t('Pause', 'Pause') : t('Play', 'Lecture')}>{replay.playing ? <Icon name="stop" size={10} /> : <Icon name="play" size={11} />}</button>
          <button className="icon-btn" onClick={() => replay.step(1)} aria-label={t('Next step', 'Étape suivante')}><Icon name="chevron" size={12} /></button>
          <span className="mono">{t('Replay · step', 'Revoir · étape')} {replay.stepIndex}/{replay.stepTotal}</span>
          <button className="btn ghost sm live" onClick={replay.live}>● {t('Live', 'En direct')}</button>
        </div>
      )}

      {state.approval && (
        <div className="approval">
          <div className="approval-head"><Icon name="shield" /> {state.approval.check ? t('Codetandem wants to check the work by running the tests', 'Codetandem veut vérifier le travail en lançant les tests') : state.approval.command.startsWith('browse ') ? t('The agent wants to visit a website', 'L’agent veut visiter un site web') : state.approval.command.startsWith('open ') ? t('The agent wants to open something on your computer', 'L’agent veut ouvrir quelque chose sur ton ordinateur') : t('The agent wants to run a command', 'L’agent veut lancer une commande')}</div>
          <code>$ {state.approval.command}</code>
          <div className="approval-actions">
            <button className="btn ghost" onClick={() => approve(state.approval!.id, false)}>{t('Deny', 'Refuser')}</button>
            <button className="btn primary" onClick={() => approve(state.approval!.id, true)}>{t('Run it', 'Lancer')}</button>
          </div>
        </div>
      )}

      {inline && <StepsSheet state={state} selected={selected} onSelect={onSelect} onClose={() => { setSheetOpen(false); onSelect(null); }} threadId={threadId} replay={replay} />}
    </section>
  );
}
