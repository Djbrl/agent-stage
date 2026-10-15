// Bottom drawer: Vercel-style activity log on the left, diff or output of the selected step/file on the right.
import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import type { State, Step } from './useAgent';
import { lineDiff, diffStats } from './diff';
import { Icon, TOOL_ICON } from './icons';

export function stepLabel(s: Step) {
  const v: Record<string, string> = { list_files: 'Scanned workspace', read_file: 'Read', write_file: 'Wrote', edit_file: 'Edited', search: 'Searched', run_command: 'Ran', checkpoint: 'Checkpoint' };
  const what = s.name === 'run_command' ? s.args.command : s.name === 'search' ? `“${s.args.text}”` : s.name === 'checkpoint' ? s.args.title ?? '' : s.args.path ?? '';
  return { verb: v[s.name] ?? s.name, what };
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
const dur = (s: Step) => (s.endedAt ? `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : '…');

export function Inspector({ state, selected, onSelect, threadId }: { state: State; selected: string | null; onSelect: (k: string | null) => void; threadId: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [state.steps.length]);

  const step = state.steps.find((s) => s.id === selected);
  const filePath = step ? (step.target.startsWith('$') ? null : step.target) : selected;
  const change = step?.change ?? (filePath ? state.changes[filePath] : undefined);
  const errors = state.steps.filter((s) => s.ok === false).length;

  // Teaching: a one-line summary of the selected file, and an on-demand explanation of the change.
  const [summary, setSummary] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ key: string; text: string | null } | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!filePath) return;
    fetch(`/api/threads/${threadId}/summary?path=${encodeURIComponent(filePath)}`).then((r) => r.json())
      .then((j) => setSummary(j.summary ?? null)).catch(() => {});
  }, [filePath, threadId, state.changes[filePath ?? '']?.after]);
  const explainKey = `${selected}:${change?.after.length}`;
  const runExplain = () => {
    if (!change || !filePath) return;
    setExplain({ key: explainKey, text: null });
    fetch(`/api/threads/${threadId}/explain`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath, before: change.before, after: change.after }) })
      .then((r) => r.json()).then((j) => setExplain({ key: explainKey, text: j.text ?? `Couldn't explain: ${j.error}` }));
  };

  return (
    <div className="drawer">
      <div className="log">
        <div className="drawer-head">
          <span>Activity</span>
          <span className="muted">{state.steps.length} steps</span>
          {errors > 0 && <span className="pill err"><Icon name="x" size={11} /> {errors}</span>}
        </div>
        <div className="rows">
          {state.steps.map((s) => {
            const { verb, what } = stepLabel(s);
            return (
              <div key={s.id} className={`row ${s.ok === false ? 'bad' : ''} ${selected === s.id ? 'sel' : ''}`} onClick={() => onSelect(s.id)}>
                <span className="ts">{time(s.startedAt)}</span>
                <Icon name={TOOL_ICON[s.name] ?? 'spark'} size={13} />
                {s.label ? <span className="verb ai" title={s.why}>{s.label}</span> : <><span className="verb">{verb}</span><span className="what">{what}</span></>}
                {s.label && <span className="what">{s.why}</span>}
                <span className="dur">{s.ok === undefined ? <span className="spin" /> : dur(s)}</span>
              </div>
            );
          })}
          {state.steps.length === 0 && <div className="row muted">Nothing yet.</div>}
          <div ref={end} />
        </div>
      </div>
      <div className="detail">
        {!selected && <div className="placeholder">Select a step or a file to see what changed.</div>}
        {selected && (
          <>
            <div className="drawer-head">
              <span className="mono">{filePath ?? (step ? stepLabel(step).what : '')}</span>
              {change && (() => { const st = diffStats(lineDiff(change.before, change.after)); return <span className="muted"><span className="add">+{st.add}</span> <span className="del">−{st.del}</span></span>; })()}
              {change && <button className="btn ghost sm" onClick={runExplain}>Explain this change</button>}
              <button className="icon-btn" onClick={() => onSelect(null)}><Icon name="x" size={12} /></button>
            </div>
            {summary && <div className="file-summary">{summary}</div>}
            {explain?.key === explainKey && <div className="explain">{explain.text ? <Markdown text={explain.text} /> : <span className="spin" />}</div>}
            {change ? <DiffView before={change.before} after={change.after} />
              : <pre className={`output ${step?.ok === false ? 'bad' : ''}`}>{step?.output ?? 'No changes to this file yet.'}</pre>}
          </>
        )}
      </div>
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  return (
    <div className="diff">
      {lineDiff(before, after).map((l, i) => (
        <div key={i} className={`dl ${l.kind}`}>
          <span className="ln">{l.a ?? ''}</span><span className="ln">{l.b ?? ''}</span>
          <span className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          <span className="code">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
