// Turns the server's event stream into UI state: file statuses, marker trail, timeline, steps.
import { useEffect, useReducer } from 'react';

type Base = { at: number };
export type AgentEvent = Base & (
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: any }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string }
  | { type: 'approval'; id: string; command: string }
  | { type: 'file_change'; path: string; before: string; after: string }
  | { type: 'checkpoint'; id: string; kind: 'design' | 'implementation'; title: string; summary: string; additions?: { detail: string; proposal: string; why: string }[]; files?: string[] }
  | { type: 'checkpoint_answer'; id: string; choice: 'confirm' | 'discuss'; text?: string }
  | { type: 'user'; text: string }
  | { type: 'question'; id: string; text: string }
  | { type: 'answer'; id: string; text: string }
  | { type: 'label'; stepId: string; label: string; why: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }
);

export type FileStatus = 'idle' | 'read' | 'written' | 'error';
export type Change = { before: string; after: string };
export type Step = {
  id: string; name: string; target: string; args: any;
  startedAt: number; endedAt?: number; ok?: boolean; output?: string; change?: Change; label?: string; why?: string;
};
export type Entry =
  | { kind: 'user' | 'thought' | 'done' | 'error'; text: string; at: number }
  | { kind: 'qa'; id: string; question: string; answer?: string; at: number }
  | { kind: 'checkpoint'; id: string; cp: Extract<AgentEvent, { type: 'checkpoint' }>; answer?: { choice: 'confirm' | 'discuss'; text?: string }; at: number }
  | { kind: 'actions'; steps: string[]; at: number };

export type State = {
  files: Record<string, FileStatus>;
  changes: Record<string, Change>; // cumulative per file: first "before", latest "after"
  marker: string | null; // file path, '$terminal' or '$workspace'
  trail: string[];
  steps: Step[];
  timeline: Entry[];
  approval: { id: string; command: string } | null;
  planned: string[]; // files named by an open checkpoint (highlighted on the map)
  running: boolean;
  startedAt: number | null;
};

export const initial: State = {
  files: {}, changes: {}, marker: null, trail: [], steps: [], timeline: [], approval: null, planned: [], running: false, startedAt: null,
};

export function targetOf(name: string, args: any): string {
  if (name === 'run_command') return '$terminal';
  if (name === 'list_files' || name === 'search') return '$workspace';
  return args?.path ?? '$workspace';
}

type Action = { kind: 'event'; e: AgentEvent } | { kind: 'files'; files: string[]; running: boolean };

function reduce(s: State, a: Action): State {
  if (a.kind === 'files') {
    const files = { ...s.files };
    for (const f of a.files) files[f] ??= 'idle';
    return { ...s, files, running: s.running || a.running };
  }
  const e = a.e;
  switch (e.type) {
    case 'user':
      if (e.text === '— new session —') return { ...initial, files: Object.fromEntries(Object.keys(s.files).map((f) => [f, 'idle'])) };
      return { ...s, running: true, startedAt: s.running ? s.startedAt : e.at, timeline: [...s.timeline, { kind: 'user', text: e.text, at: e.at }] };
    case 'label':
      return { ...s, steps: s.steps.map((x) => (x.id === e.stepId ? { ...x, label: e.label, why: e.why } : x)) };
    case 'checkpoint':
      return { ...s, planned: e.files ?? [], timeline: [...s.timeline, { kind: 'checkpoint', id: e.id, cp: e, at: e.at }] };
    case 'checkpoint_answer':
      return { ...s, planned: e.choice === 'confirm' ? s.planned : [], timeline: s.timeline.map((x) => (x.kind === 'checkpoint' && x.id === e.id ? { ...x, answer: { choice: e.choice, text: e.text } } : x)) };
    case 'question':
      return { ...s, timeline: [...s.timeline, { kind: 'qa', id: e.id, question: e.text, at: e.at }] };
    case 'answer':
      return { ...s, timeline: s.timeline.map((x) => (x.kind === 'qa' && x.id === e.id ? { ...x, answer: e.text } : x)) };
    case 'thinking':
      return { ...s, timeline: [...s.timeline, { kind: 'thought', text: e.text, at: e.at }] };
    case 'tool_start': {
      const target = targetOf(e.name, e.args);
      const last = s.timeline.at(-1);
      const timeline = last?.kind === 'actions'
        ? [...s.timeline.slice(0, -1), { ...last, steps: [...last.steps, e.id] }]
        : [...s.timeline, { kind: 'actions' as const, steps: [e.id], at: e.at }];
      return {
        ...s, running: true, marker: target, timeline,
        trail: [...s.trail, target].slice(-6),
        steps: [...s.steps, { id: e.id, name: e.name, target, args: e.args, startedAt: e.at }],
      };
    }
    case 'file_change': {
      const prev = s.changes[e.path];
      const steps = [...s.steps];
      const idx = steps.findLastIndex((x) => x.target === e.path && x.endedAt === undefined);
      if (idx >= 0) steps[idx] = { ...steps[idx], change: { before: e.before, after: e.after } };
      return { ...s, steps, changes: { ...s.changes, [e.path]: { before: prev?.before ?? e.before, after: e.after } } };
    }
    case 'tool_end': {
      const step = s.steps.find((x) => x.id === e.id);
      const steps = s.steps.map((x) => (x.id === e.id ? { ...x, ok: e.ok, output: e.output, endedAt: e.at } : x));
      const files = { ...s.files };
      const t = step?.target;
      if (t && !t.startsWith('$')) {
        files[t] = !e.ok ? 'error' : e.name === 'read_file' ? (files[t] === 'written' ? 'written' : 'read') : 'written';
      }
      return { ...s, steps, files };
    }
    case 'approval':
      return { ...s, marker: '$terminal', approval: { id: e.id, command: e.command } };
    case 'done':
      return { ...s, running: false, approval: null, planned: [], timeline: [...s.timeline, { kind: 'done', text: e.text, at: e.at }] };
    case 'error':
      return { ...s, running: false, approval: null, timeline: [...s.timeline, { kind: 'error', text: e.message, at: e.at }] };
  }
}

export function useAgent(threadId: string) {
  const base = `/api/threads/${threadId}`;
  const [state, dispatch] = useReducer(reduce, initial);
  const [meta, setMeta] = useReducer((_: any, m: any) => m, { workspace: '…', title: '', mode: 'build' });

  useEffect(() => {
    const refresh = () =>
      fetch(`${base}/state`).then((r) => r.json()).then((st) => {
        setMeta(st);
        dispatch({ kind: 'files', files: st.files, running: st.running });
      });
    refresh();
    const es = new EventSource(`${base}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgentEvent;
      dispatch({ kind: 'event', e });
      if (e.type === 'tool_end' || e.type === 'done') refresh();
    };
    return () => es.close();
  }, [threadId]);

  const post = (path: string, body?: object) =>
    fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  return {
    state,
    meta,
    run: (task: string) => post('task', { task }),
    ask: (text: string) => post('ask', { text }),
    steer: (text: string) => post('steer', { text }),
    stop: () => post('stop'),
    approve: (id: string, ok: boolean) => post('approve', { id, ok }),
    answerCheckpoint: (id: string, choice: 'confirm' | 'discuss', text?: string) => post('checkpoint', { id, choice, text }),
    setMode: (mode: 'build' | 'learn') => post('mode', { mode }).then(() => setMeta({ ...meta, mode })),
  };
}
