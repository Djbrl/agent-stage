// Turns the server's event stream into UI state: file statuses, marker position, step list.
import { useEffect, useReducer } from 'react';

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: any }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string }
  | { type: 'approval'; id: string; command: string }
  | { type: 'user'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export type FileStatus = 'idle' | 'read' | 'written' | 'error';
export type Step = { id: string; name: string; target: string; args: any; ok?: boolean; output?: string };

export type State = {
  files: Record<string, FileStatus>;
  marker: string | null; // file path, or '$terminal' / '$workspace'
  steps: Step[];
  feed: Array<{ kind: 'user' | 'agent' | 'error'; text: string }>;
  approval: { id: string; command: string } | null;
  running: boolean;
};

export const initial: State = { files: {}, marker: null, steps: [], feed: [], approval: null, running: false };

export function targetOf(name: string, args: any): string {
  if (name === 'run_command') return '$terminal';
  if (args?.path) return args.path;
  return '$workspace';
}

function reduce(s: State, a: { kind: 'event'; e: AgentEvent } | { kind: 'files'; files: string[]; running: boolean }): State {
  if (a.kind === 'files') {
    const files = { ...s.files };
    for (const f of a.files) files[f] ??= 'idle';
    return { ...s, files, running: s.running || a.running };
  }
  const e = a.e;
  switch (e.type) {
    case 'user':
      if (e.text === '— new session —') return { ...initial, files: Object.fromEntries(Object.keys(s.files).map((f) => [f, 'idle'])) };
      return { ...s, running: true, feed: [...s.feed, { kind: 'user', text: e.text }] };
    case 'thinking':
      return { ...s, feed: [...s.feed, { kind: 'agent', text: e.text }] };
    case 'tool_start': {
      const target = targetOf(e.name, e.args);
      return { ...s, running: true, marker: target, steps: [...s.steps, { id: e.id, name: e.name, target, args: e.args }] };
    }
    case 'tool_end': {
      const step = s.steps.find((x) => x.id === e.id);
      const steps = s.steps.map((x) => (x.id === e.id ? { ...x, ok: e.ok, output: e.output } : x));
      const files = { ...s.files };
      const t = step?.target;
      if (t && !t.startsWith('$')) {
        files[t] = !e.ok ? 'error' : e.name === 'read_file' ? (files[t] === 'written' ? 'written' : 'read') : 'written';
      }
      return { ...s, steps, files, approval: s.approval };
    }
    case 'approval':
      return { ...s, marker: '$terminal', approval: { id: e.id, command: e.command } };
    case 'done':
      return { ...s, running: false, approval: null, feed: [...s.feed, { kind: 'agent', text: e.text }] };
    case 'error':
      return { ...s, running: false, approval: null, feed: [...s.feed, { kind: 'error', text: e.message }] };
  }
}

export function useAgent() {
  const [state, dispatch] = useReducer(reduce, initial);
  const [meta, setMeta] = useReducer((_: any, m: any) => m, { model: '…', workspace: '…' });

  useEffect(() => {
    const refresh = () =>
      fetch('/api/state').then((r) => r.json()).then((st) => {
        setMeta(st);
        dispatch({ kind: 'files', files: st.files, running: st.running });
      });
    refresh();
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgentEvent;
      dispatch({ kind: 'event', e });
      if (e.type === 'tool_end' || e.type === 'done') refresh();
    };
    return () => es.close();
  }, []);

  const post = (path: string, body?: object) =>
    fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  return {
    state,
    meta,
    run: (task: string) => post('task', { task }),
    ask: (text: string) => post('ask', { text }),
    stop: () => post('stop'),
    approve: (id: string, ok: boolean) => post('approve', { id, ok }),
    reset: () => post('reset'),
  };
}
