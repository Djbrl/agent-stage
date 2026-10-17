// Turns the server's event stream into UI state: file statuses, marker trail, timeline, steps.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

type Base = { at: number };
export type AgentEvent = Base & (
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: any }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string }
  | { type: 'approval'; id: string; command: string; check?: boolean }
  | { type: 'approval_answer'; id: string; ok: boolean }
  | { type: 'file_change'; path: string; before: string; after: string }
  | { type: 'checkpoint'; id: string; kind: 'design' | 'implementation'; title: string; summary: string; additions?: { detail: string; proposal: string; why: string }[]; files?: string[] }
  | { type: 'checkpoint_answer'; id: string; choice: 'confirm' | 'discuss' | 'skip'; text?: string }
  | { type: 'user'; text: string }
  | { type: 'question'; id: string; text: string }
  | { type: 'answer'; id: string; text: string }
  | { type: 'label'; stepId: string; label: string; why: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number; ms: number; costUsd?: number }
  | { type: 'verify'; id: string; state: 'running' | 'pass' | 'fail' | 'nudge' | 'declined' | 'unavailable'; command?: string; output?: string }
  | { type: 'snapshot'; ref: string }
  | { type: 'task_end'; ref: string; after: string; files: number }
  | { type: 'idle' }
  | { type: 'restored'; ref: string; files: { status: string; path: string }[] }
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
  | { kind: 'user' | 'thought'; text: string; at: number }
  | { kind: 'done' | 'error'; text: string; at: number; ref?: string } // ref: git checkpoint taken before this task
  | { kind: 'verify'; id: string; state: 'running' | 'pass' | 'fail' | 'nudge' | 'declined' | 'unavailable'; command?: string; output?: string; at: number }
  | { kind: 'restored'; files: { status: string; path: string }[]; at: number }
  | { kind: 'qa'; id: string; question: string; answer?: string; at: number }
  | { kind: 'checkpoint'; id: string; cp: Extract<AgentEvent, { type: 'checkpoint' }>; answer?: { choice: 'confirm' | 'discuss' | 'skip'; text?: string }; at: number }
  | { kind: 'actions'; steps: string[]; at: number };

export type State = {
  files: Record<string, FileStatus>;
  changes: Record<string, Change>; // cumulative per file: first "before", latest "after"
  marker: string | null; // file path, '$terminal', '$browser' or '$workspace'
  trail: string[];
  steps: Step[];
  timeline: Entry[];
  approval: { id: string; command: string; check?: boolean } | null;
  planned: string[]; // files named by an open checkpoint (highlighted on the map)
  running: boolean;
  startedAt: number | null;
  snapshot: string | null; // checkpoint of the task in progress
  undone: string[]; // checkpoints already restored
  changed: Record<string, number>; // checkpoint → files its task changed (no Undo for a task that changed nothing)
  tokens: { context: number; total: number; cost: number }; // context = size of the last request; total = all tokens this thread
};

export const initial: State = {
  files: {}, changes: {}, marker: null, trail: [], steps: [], timeline: [], approval: null, planned: [], running: false, startedAt: null, snapshot: null, undone: [], changed: {}, tokens: { context: 0, total: 0, cost: 0 },
};

export function targetOf(name: string, args: any): string {
  if (name === 'run_command' || name === 'open_on_computer') return '$terminal';
  if (name.startsWith('browser_')) return '$browser';
  if (name === 'list_files' || name === 'search') return '$workspace';
  return args?.path ?? '$workspace';
}

type Action = { kind: 'event'; e: AgentEvent } | { kind: 'files'; files: string[]; running: boolean } | { kind: 'reset' };

function reduce(s: State, a: Action): State {
  if (a.kind === 'reset') return { ...initial, files: Object.fromEntries(Object.keys(s.files).map((f) => [f, 'idle'])) };
  if (a.kind === 'files') {
    const files = { ...s.files };
    for (const f of a.files) files[f] ??= 'idle';
    // The server's "running" only counts on first load: right after "done" it can still say true for a moment,
    // and taking that would leave the chat stuck on "Thinking…" with a Stop button that stops nothing.
    return { ...s, files, running: s.running || (a.running && !s.timeline.length) };
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
      return { ...s, marker: '$terminal', approval: { id: e.id, command: e.command, check: e.check } };
    case 'approval_answer':
      return s.approval?.id === e.id ? { ...s, approval: null } : s;
    case 'verify': {
      // The harness checking the agent's "done": one line per check, updated in place.
      const entry = { kind: 'verify' as const, id: e.id, state: e.state, command: e.command, output: e.output, at: e.at };
      const has = s.timeline.some((x) => x.kind === 'verify' && x.id === e.id);
      return { ...s, marker: e.state === 'running' ? '$terminal' : s.marker,
        timeline: has ? s.timeline.map((x) => (x.kind === 'verify' && x.id === e.id ? entry : x)) : [...s.timeline, entry] };
    }
    case 'snapshot':
      return { ...s, snapshot: e.ref };
    case 'usage':
      return { ...s, tokens: { context: e.promptTokens, total: s.tokens.total + e.promptTokens + e.completionTokens, cost: s.tokens.cost + (e.costUsd ?? 0) } };
    case 'idle':
      return { ...s, running: false, approval: null };
    case 'task_end':
      return { ...s, changed: { ...s.changed, [e.ref]: e.files } };
    case 'restored': {
      // The files are back as they were: the map shows them untouched again.
      const files = { ...s.files }, changes = { ...s.changes };
      for (const f of e.files) { if (f.status === 'A') delete files[f.path]; else files[f.path] = 'idle'; delete changes[f.path]; }
      return { ...s, files, changes, undone: [...s.undone, e.ref], timeline: [...s.timeline, { kind: 'restored', files: e.files, at: e.at }] };
    }
    case 'done':
      return { ...s, running: false, approval: null, planned: [], snapshot: null, timeline: [...s.timeline, { kind: 'done', text: e.text, at: e.at, ref: s.snapshot ?? undefined }] };
    case 'error': // stopped or out of steps: its changes stay, so it gets an Undo too
      return { ...s, running: false, approval: null, planned: [], snapshot: null, timeline: [...s.timeline, { kind: 'error', text: e.message, at: e.at, ref: s.snapshot ?? undefined }] };
    default:
      // usage and any event a newer server sends: nothing to draw. Never return undefined (that blanks the app).
      return s;
  }
}

// Replay: rebuild the state as it was after moment k. A moment ends at a finished step, a message, or the end.
const isMoment = (e: AgentEvent) => e.type === 'tool_end' || e.type === 'user' || e.type === 'done' || e.type === 'error' || e.type === 'checkpoint' || (e.type === 'verify' && e.state !== 'running');
// Pace like Rundown: quick for reads, a beat longer for edits and messages.
function paceFor(e: AgentEvent | undefined) {
  if (!e) return 400;
  if (e.type === 'user' || e.type === 'checkpoint') return 900;
  if (e.type === 'tool_end') return e.name === 'write_file' || e.name === 'edit_file' ? 750 : e.name === 'read_file' ? 520 : 400;
  return 400;
}

export type Replay = {
  active: boolean; playing: boolean; index: number; total: number; at?: number;
  play: () => void; pause: () => void; step: (d: number) => void; seek: (i: number) => void; live: () => void;
};

export function useAgent(threadId: string) {
  const base = `/api/threads/${threadId}`;
  const [liveState, dispatch] = useReducer(reduce, initial);
  const events = useRef<AgentEvent[]>([]);
  const files = useRef<string[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const [meta, setMeta] = useReducer((_: any, m: any) => m, { workspace: '…', title: '', mode: 'build' });

  useEffect(() => {
    const refresh = () =>
      fetch(`${base}/state`).then((r) => r.json()).then((st) => {
        setMeta(st);
        files.current = st.files;
        dispatch({ kind: 'files', files: st.files, running: st.running });
      });
    refresh();
    const take = (e: AgentEvent) => {
      events.current.push(e);
      setEventCount(events.current.length);
      dispatch({ kind: 'event', e });
      if (e.type === 'tool_end' || e.type === 'done') refresh();
    };
    // Live stream first. If its greeting doesn't arrive (some tunnels hold streams back), poll instead.
    let poll: ReturnType<typeof setInterval> | undefined, closed = false, poll2: EventSource | undefined;
    const es = new EventSource(`${base}/events`);
    es.onmessage = (m) => take(JSON.parse(m.data));
    let hello = false;
    es.addEventListener('hello', () => { hello = true; });
    const fallback = setTimeout(() => {
      if (hello || closed) return;
      es.close();
      let busy = false;
      poll = setInterval(async () => {
        if (busy) return; busy = true;
        const r = await fetch(`${base}/log?from=${events.current.length}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        busy = false;
        if (r === null && !closed && !poll2) { // a server without /log (older build): go back to the stream
          clearInterval(poll); events.current = []; dispatch({ kind: 'reset' });
          poll2 = new EventSource(`${base}/events`); poll2.onmessage = (m) => take(JSON.parse(m.data));
          return;
        }
        if (!closed && r?.events) for (const e of r.events) take(e);
      }, 1000);
    }, 3000);
    return () => { closed = true; es.close(); poll2?.close(); clearTimeout(fallback); clearInterval(poll); events.current = []; };
  }, [threadId]);

  const moments = useMemo(() => events.current.map((e, i) => (isMoment(e) ? i : -1)).filter((i) => i >= 0), [eventCount]);
  const state = useMemo(() => {
    if (cursor === null) return liveState;
    const end = moments[Math.min(cursor, moments.length - 1)] ?? -1;
    let st = reduce(initial, { kind: 'files', files: files.current, running: false });
    for (let i = 0; i <= end; i++) st = reduce(st, { kind: 'event', e: events.current[i] });
    return { ...st, approval: null };
  }, [cursor, liveState, moments]);

  // Playback timer: advance one moment at a time; reaching the end returns to live.
  useEffect(() => {
    if (!playing || cursor === null) return;
    if (cursor >= moments.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setCursor((c) => (c === null ? c : c + 1)), paceFor(events.current[moments[cursor + 1]]));
    return () => clearTimeout(t);
  }, [playing, cursor, moments]);

  const total = moments.length;
  const replay: Replay = {
    active: cursor !== null, playing, index: cursor ?? total - 1, total,
    at: cursor !== null ? (events.current[moments[cursor]] as any)?.at : undefined,
    play: () => { if (cursor === null || cursor >= total - 1) setCursor(0); setPlaying(true); },
    pause: () => setPlaying(false),
    step: (d) => { setPlaying(false); setCursor((c) => Math.max(0, Math.min(total - 1, (c ?? total - 1) + d))); },
    seek: (i) => { setPlaying(false); setCursor(Math.max(0, Math.min(total - 1, i))); },
    live: () => { setPlaying(false); setCursor(null); },
  };

  const post = (path: string, body?: object) =>
    fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  return {
    state,
    replay,
    meta,
    run: (task: string) => post('task', { task }),
    ask: (text: string) => post('ask', { text }),
    steer: (text: string) => post('steer', { text }),
    stop: () => post('stop'),
    approve: (id: string, ok: boolean) => { // hide the card now: through the demo's tunnel the event takes a second
      dispatch({ kind: 'event', e: { type: 'approval_answer', id, ok, at: Date.now() } });
      return post('approve', { id, ok });
    },
    answerCheckpoint: (id: string, choice: 'confirm' | 'discuss' | 'skip', text?: string) => post('checkpoint', { id, choice, text }),
    setMode: (mode: 'build' | 'learn') => post('mode', { mode }).then(() => setMeta({ ...meta, mode })),
  };
}
