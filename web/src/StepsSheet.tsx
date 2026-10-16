// Details on demand: the list of steps, and one step's change (diff, file summary, explanation).
// Lives in a sheet over the right side of the stage, so the map stays the main thing.
import { useEffect, useRef, useState } from 'react';
import type { Replay, State, Step } from './useAgent';
import { lineDiff, diffStats } from './diff';
import { Icon, TOOL_ICON } from './icons';
import { Markdown } from './Markdown';

export function stepLabel(s: Step) {
  const v: Record<string, string> = { list_files: 'Scanned the project', read_file: 'Read', write_file: 'Wrote', edit_file: 'Edited', search: 'Searched', run_command: 'Ran', checkpoint: 'Checkpoint',
    browser_open: 'Opened', browser_read: 'Looked at the page', browser_click: 'Clicked', browser_type: 'Typed into', open_on_computer: 'Opened on your computer' };
  const what = s.name === 'run_command' ? s.args.command : s.name === 'browser_open' ? s.args.url : s.name === 'browser_type' ? `“${s.args.text}”` : s.name === 'browser_click' ? `control ${s.args.n}` : s.name === 'open_on_computer' ? s.args.target : s.name === 'browser_read' ? '' : s.name === 'search' ? `“${s.args.text}”` : s.name === 'checkpoint' ? s.args.title ?? '' : s.args.path ?? '';
  return { verb: v[s.name] ?? s.name, what };
}
// Browser steps carry a screenshot reference at the top of their output.
export const shotOf = (s?: Step) => s?.output?.match(/^\[screenshot: (\/api\/shots\/[\w-]+\.png)\]/)?.[1] ?? null;
// …followed by "<title> — <url>".
export const pageOf = (s: Step) => (s.output?.split('\n')[1]?.split(' — ').at(-1) ?? '').replace(/^https?:\/\//, '') || 'browser';
export const stepText = (s: Step) => s.label ?? `${stepLabel(s).verb} ${stepLabel(s).what}`.trim();

export function StepsSheet({ state, selected, onSelect, onClose, threadId, replay, embedded }: {
  state: State; selected: string | null; onSelect: (k: string | null) => void; onClose: () => void; threadId: string; replay: Replay;
  embedded?: boolean; // inside the studio panel: no floating card, no close button
}) {
  const step = state.steps.find((s) => s.id === selected);
  const filePath = step ? (step.target.startsWith('$') ? null : step.target) : selected;
  return (
    <aside className={embedded ? 'sheet embedded' : 'sheet'}>
      <div className="sheet-head">
        {selected ? <button className="icon-btn" onClick={() => onSelect(null)} title="Back to steps"><Icon name="chevron" size={13} className="flip" /></button> : null}
        <span className="sheet-title">{selected ? (step ? stepText(step) : filePath?.split('/').pop()) : `${state.steps.length} steps`}</span>
        {!selected && state.steps.length > 1 && (replay.active
          ? <button className="btn ghost sm live" onClick={replay.live}>● Live</button>
          : <button className="btn ghost sm" onClick={replay.play} title="Watch the agent do it again on the map (Space)"><Icon name="play" size={11} /> Replay</button>)}
        {!embedded && <button className="icon-btn" onClick={onClose} title="Close"><Icon name="x" size={12} /></button>}
      </div>
      {selected ? <Detail state={state} step={step} filePath={filePath ?? null} threadId={threadId} /> : <List state={state} onSelect={onSelect} replay={replay} />}
    </aside>
  );
}

function List({ state, onSelect, replay }: { state: State; onSelect: (k: string) => void; replay: Replay }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [state.steps.length]);
  return (
    <div className="sheet-list">
      {state.steps.map((s, i) => (
        <button key={s.id} className={`srow ${s.ok === false ? 'bad' : ''} ${replay.active && i === state.steps.length - 1 ? 'now' : ''}`} onClick={() => onSelect(s.id)}>
          <span className="srow-icon">{s.ok === undefined ? <span className="spin" /> : <Icon name={TOOL_ICON[s.name] ?? 'spark'} size={12} />}</span>
          <span className="srow-text"><span>{stepText(s)}</span>{s.why && <span className="srow-why">{s.why}</span>}</span>
        </button>
      ))}
      {!state.steps.length && <div className="muted pad">No steps yet.</div>}
      <div ref={end} />
    </div>
  );
}

function Detail({ state, step, filePath, threadId }: { state: State; step?: Step; filePath: string | null; threadId: string }) {
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
      .then((r) => r.json()).then((j) => setExplain(j.text ?? `Couldn't explain: ${j.error}`));
  };
  const st = change && diffStats(lineDiff(change.before, change.after));
  return (
    <div className="sheet-detail">
      {step?.why && <p className="why">{step.why}</p>}
      {summary && <div className="file-summary"><span className="mono">{filePath}</span> {summary}</div>}
      {change ? (
        <>
          <div className="detail-bar"><span className="mono muted">{filePath}</span>{st && <span className="mono"><span className="add">+{st.add}</span> <span className="del">−{st.del}</span></span>}
            <span className="spacer" /><button className="btn ghost sm" onClick={runExplain}>Explain this change</button></div>
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
          <img className="shot" src={shotOf(step)!} alt="What the browser showed" />
          <pre className={`output ${step?.ok === false ? 'bad' : ''}`}>{step!.output!.replace(/^\[screenshot: [^\]]+\]\n/, '')}</pre>
        </>
      ) : <pre className={`output ${step?.ok === false ? 'bad' : ''}`}>{step?.output ?? 'No changes to this file yet.'}</pre>}
    </div>
  );
}
