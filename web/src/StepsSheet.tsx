// Details on demand: the list of steps, and one step's change (diff, file summary, explanation).
// Lives in a sheet over the right side of the stage, so the map stays the main thing.
import { useEffect, useRef, useState } from 'react';
import type { Replay, State, Step } from './useAgent';
import { lineDiff, diffStats } from './diff';
import { Icon, TOOL_ICON } from './icons';
import { Markdown } from './Markdown';
import { useT, useLang, tr } from './i18n';

// The fallback name of a step (the server usually sends a plain-words label that replaces it).
export function stepLabel(s: Step, fr = false) {
  const t = tr(fr);
  const v: Record<string, string> = { list_files: t('Looked around the project', 'A fait le tour du projet'), read_file: t('Read', 'A lu'), write_file: t('Wrote', 'A écrit'), edit_file: t('Edited', 'A modifié'),
    search: t('Searched for', 'A cherché'), run_command: t('Ran', 'A lancé'), checkpoint: t('Your call:', 'À toi de décider :'),
    browser_open: t('Opened', 'A ouvert'), browser_read: t('Looked at the page', 'A regardé la page'), browser_click: t('Clicked', 'A cliqué sur'), browser_type: t('Typed', 'A tapé'), open_on_computer: t('Opened on your computer', 'A ouvert sur ton ordinateur') };
  const q = (x: string) => (fr ? `« ${x} »` : `“${x}”`);
  const what = s.name === 'run_command' ? s.args.command : s.name === 'browser_open' ? s.args.url : s.name === 'browser_type' ? q(s.args.text) : s.name === 'browser_click' ? t(`button ${s.args.n}`, `le bouton ${s.args.n}`) : s.name === 'open_on_computer' ? s.args.target : s.name === 'browser_read' ? '' : s.name === 'search' ? q(s.args.text) : s.name === 'checkpoint' ? s.args.title ?? '' : s.args.path ?? '';
  return { verb: v[s.name] ?? s.name, what };
}
// Browser steps carry a screenshot reference at the top of their output.
export const shotOf = (s?: Step) => s?.output?.match(/^\[screenshot: (\/api\/shots\/[\w-]+\.png)\]/)?.[1] ?? null;
// …followed by "<title> — <url>".
export const pageOf = (s: Step) => (s.output?.split('\n')[1]?.split(' — ').at(-1) ?? '').replace(/^https?:\/\//, '');
export const stepText = (s: Step, fr = false) => s.label ?? `${stepLabel(s, fr).verb} ${stepLabel(s, fr).what}`.trim();

export function StepsSheet({ state, selected, onSelect, onClose, threadId, replay, embedded }: {
  state: State; selected: string | null; onSelect: (k: string | null) => void; onClose: () => void; threadId: string; replay: Replay;
  embedded?: boolean; // inside the studio panel: no floating card, no close button
}) {
  const t = useT();
  const fr = useLang() === 'fr';
  const step = state.steps.find((s) => s.id === selected);
  const filePath = step ? (step.target.startsWith('$') ? null : step.target) : selected;
  return (
    <aside className={embedded ? 'sheet embedded' : 'sheet'}>
      <div className="sheet-head">
        {selected ? <button className="icon-btn" onClick={() => onSelect(null)} title={t('Back to steps', 'Retour aux étapes')} aria-label={t('Back to steps', 'Retour aux étapes')}><Icon name="chevron" size={13} className="flip" /></button> : null}
        <span className="sheet-title">{selected ? (step ? stepText(step, fr) : filePath?.split('/').pop()) : `${replay.steps.length || state.steps.length} ${t((replay.steps.length || state.steps.length) === 1 ? 'step' : 'steps', (replay.steps.length || state.steps.length) === 1 ? 'étape' : 'étapes')}`}</span>
        {!embedded && <button className="icon-btn" onClick={onClose} title={t('Close', 'Fermer')} aria-label={t('Close', 'Fermer')}><Icon name="x" size={12} /></button>}
      </div>
      {selected ? <Detail state={state} step={step} filePath={filePath ?? null} threadId={threadId} /> : <List state={state} onSelect={onSelect} replay={replay} />}
    </aside>
  );
}

// Every step, also while the map replays: the step the map shows is "now", later ones are faded.
// The mouse wheel (or trackpad, or ↑ ↓) over the list moves the map through the steps one at a time: up rewinds,
// down goes forward, past the last step is live again. Clicking a step puts the map there and the camera on it.
function List({ state, onSelect, replay }: { state: State; onSelect: (k: string) => void; replay: Replay }) {
  const t = useT();
  const fr = useLang() === 'fr';
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const steps = replay.steps.length ? replay.steps : state.steps;
  const nowId = replay.active ? state.steps.at(-1)?.id : undefined;
  const nowAt = nowId ? steps.findIndex((s) => s.id === nowId) : steps.length - 1;
  // New steps while live: keep the newest in view. While replaying: keep the step the map shows in view.
  useEffect(() => { if (!replay.active) end.current?.scrollIntoView({ block: 'nearest' }); }, [steps.length]);
  useEffect(() => { if (nowId) box.current?.querySelector(`[data-step="${CSS.escape(nowId)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [nowId]);
  const go = (i: number) => {
    const target = steps[i];
    if (!target) return;
    if (i >= steps.length - 1) replay.live(); else replay.seekStep(target.id);
    window.dispatchEvent(new Event('map-follow'));
  };
  const at = useRef({ nowAt, go });
  at.current = { nowAt, go };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let acc = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      const n = Math.trunc(acc / 60);
      if (!n) return;
      acc -= n * 60;
      const { nowAt: i, go: move } = at.current;
      move(Math.max(0, Math.min(steps.length - 1, i + n)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [steps.length]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    go(Math.max(0, Math.min(steps.length - 1, nowAt + (e.key === 'ArrowUp' ? -1 : 1))));
  };
  return (
    <div className="sheet-list" ref={box} tabIndex={0} onKeyDown={key}>
      {steps.map((s, i) => (
        <button key={s.id} data-step={s.id} className={`srow ${s.ok === false ? 'bad' : ''} ${replay.active && s.id === nowId ? 'now' : ''} ${replay.active && i > nowAt ? 'later' : ''}`}
          onClick={() => { go(i); onSelect(s.id); }}>
          <span className="srow-icon">{s.ok === undefined ? <span className="spin" /> : <Icon name={TOOL_ICON[s.name] ?? 'spark'} size={12} />}</span>
          <span className="srow-text"><span>{stepText(s, fr)}</span>{s.why && <span className="srow-why">{s.why}</span>}</span>
        </button>
      ))}
      {!steps.length && <div className="muted pad">{t('No steps yet.', 'Pas encore d’étapes.')}</div>}
      {steps.length > 2 && <div className="srow-hint muted">{replay.active ? t('Scroll to move through the steps on the map. Scroll past the last one to go back to live.', 'Fais défiler pour parcourir les étapes sur la carte. Dépasse la dernière pour revenir en direct.') : t('Scroll up over the steps to rewind the map.', 'Fais défiler vers le haut sur les étapes pour revoir la carte.')}</div>}
      <div ref={end} />
    </div>
  );
}

function Detail({ state, step, filePath, threadId }: { state: State; step?: Step; filePath: string | null; threadId: string }) {
  const t = useT();
  const change = step?.change ?? (filePath ? state.changes[filePath] : undefined);
  const [summary, setSummary] = useState<string | null>(null);
  const [explain, setExplain] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setSummary(null); setExplain(undefined);
    if (!filePath) return;
    fetch(`/api/threads/${threadId}/summary?path=${encodeURIComponent(filePath)}`).then((r) => r.json()).then((j) => setSummary(j.summary ?? null)).catch(() => {});
  }, [filePath, step?.id, threadId]);
  const runExplain = () => {
    if (!change || !filePath) return;
    setExplain(null);
    fetch(`/api/threads/${threadId}/explain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: filePath, before: change.before, after: change.after }) })
      .then((r) => r.json()).then((j) => setExplain(j.text ?? t(`Couldn’t explain this change (${j.error}). Try again in a moment.`, `Impossible d’expliquer ce changement (${j.error}). Réessaie dans un instant.`)), () => setExplain(t('Couldn’t reach the server. Try again in a moment.', 'Impossible de joindre le serveur. Réessaie dans un instant.')));
  };
  const st = change && diffStats(lineDiff(change.before, change.after));
  return (
    <div className="sheet-detail">
      {step?.why && <p className="why">{step.why}</p>}
      {summary && <div className="file-summary"><span className="mono">{filePath}</span> {summary}</div>}
      {change ? (
        <>
          <div className="detail-bar"><span className="mono muted">{filePath}</span>{st && <span className="mono"><span className="add">+{st.add}</span> <span className="del">−{st.del}</span></span>}
            <span className="spacer" /><button className="btn ghost sm" onClick={runExplain}>{t('Explain this change', 'Expliquer ce changement')}</button></div>
          {explain !== undefined && <div className="explain">{explain === null ? <span className="spin" /> : <Markdown text={explain} />}</div>}
          <div className="diff">
            {lineDiff(change.before, change.after).map((l, i) => (
              <div key={i} className={`dl ${l.kind}`}><span className="ln">{l.a ?? ''}</span><span className="ln">{l.b ?? ''}</span>
                <span className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span><span className="code">{l.text || ' '}</span></div>
            ))}
          </div>
        </>
      ) : shotOf(step) ? (
        <>
          <img className="shot" src={shotOf(step)!} alt={t('What the browser showed', 'Ce que le navigateur affichait')} />
          <pre className={`output ${step?.ok === false ? 'bad' : ''}`}>{step!.output!.replace(/^\[screenshot: [^\]]+\]\n/, '')}</pre>
        </>
      ) : <pre className={`output ${step?.ok === false ? 'bad' : ''}`}>{step?.output ?? t('No changes to this file yet.', 'Pas encore de changement dans ce fichier.')}</pre>}
    </div>
  );
}
