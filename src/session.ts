// A thread as something to keep or pass on: lesson notes to study from, and a session file someone else can replay.
// Both are built from the thread's events alone, with no model call, so they are instant, free and never invent anything.
import type { Thread } from './store.ts';
import type { MapData } from './mapdata.ts';
import { QUIZ_START } from './model.ts';

type Ev = Record<string, any>;

// The tutor marks its teaching with "✦ Concept: …", "✦ Why this matters: …" and "✦ What you learned:" (see learn.ts).
export type Callout = { kind: string; title: string; body: string };
export function callouts(text: string): Callout[] {
  const out: Callout[] = [];
  let cur: Callout | null = null;
  for (const raw of String(text ?? '').split('\n')) {
    const m = raw.replace(/^[\s>*_#]*/, '').match(/^✦\s*([^:]+?)\s*:\s*(.*)$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { kind: m[1].replace(/[*_]/g, '').trim(), title: m[2].replace(/\*\*|__/g, '').replace(/[*_]+$/g, '').trim(), body: '' };
    } else if (cur) {
      // A concept is one paragraph (a blank line before it is fine); a "What you learned" list ends where the bullets do.
      const started = cur.body.trim() !== '';
      if (!raw.trim()) { if (started) { out.push(cur); cur = null; } continue; }
      if (started && /what you learned/i.test(cur.kind) && !/^\s*[-*•]\s/.test(raw)) { out.push(cur); cur = null; continue; }
      cur.body += (cur.body ? '\n' : '') + raw;
    }
  }
  if (cur) out.push(cur);
  return out.map((c) => ({ ...c, body: c.body.trim() }));
}

const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');
const fmtDate = (t: number) => { const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())} ${p(d.getMonth() + 1)} ${d.getFullYear()}`; };

// Study notes in Markdown: what was asked, the decisions, the ideas explained, what changed and how it was checked.
export function lessonNotes(t: Pick<Thread, 'title' | 'mode' | 'folder' | 'createdAt' | 'events'>): string {
  const ev = t.events as Ev[];
  const project = String(t.folder).split(/[\\/]/).filter(Boolean).pop() ?? '';
  const lines: string[] = [`# ${t.title || 'Session'}`, '', `${fmtDate(t.createdAt)} · ${t.mode === 'learn' ? 'Learn mode' : 'Build mode'}${project ? ` · project \`${project}\`` : ''}`, ''];
  const section = (title: string, body: string[]) => { if (body.length) lines.push(`## ${title}`, '', ...body, ''); };

  // "Quiz me" (and the answers that follow, up to the tutor's score) gets its own section instead of counting as requests.
  const quiz = new Set<Ev>();
  for (let i = 0, on = false, answers = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === 'user' && String(e.text).includes(QUIZ_START)) { on = true; answers = 0; quiz.add(e); continue; }
    if (!on) continue;
    if (e.type === 'user') { if (answers >= 3) { on = false; continue; } answers++; quiz.add(e); }
    else if (e.type === 'done') { quiz.add(e); if (answers >= 3) on = false; }
  }
  section('What you asked', ev.filter((e) => e.type === 'user' && e.text !== '— new session —' && !quiz.has(e)).map((e) => quote(String(e.text).trim())).flatMap((q) => [q, '']).slice(0, -1));

  const answers = new Map(ev.filter((e) => e.type === 'checkpoint_answer').map((e) => [e.id, e]));
  section('Decisions', ev.filter((e) => e.type === 'checkpoint').map((cp) => {
    const a = answers.get(cp.id);
    const verdict = !a ? 'not answered' : a.choice === 'confirm' ? 'you approved it' : a.choice === 'skip' ? 'you skipped it' : `you asked: "${String(a.text ?? '').trim()}"`;
    return `- **${cp.kind === 'implementation' ? 'Implementation' : 'Design'}: ${cp.title}**: ${String(cp.summary).trim().replace(/\n+/g, ' ')} *(${verdict})*`;
  }));

  const said = ev.filter((e) => e.type === 'done' || e.type === 'thinking' || e.type === 'answer').map((e) => String(e.text ?? ''));
  const all = said.flatMap(callouts);
  const seen = new Set<string>();
  const ideas = all.filter((c) => /^(concept|why this matters)$/i.test(c.kind) && c.title && !seen.has(c.title.toLowerCase()) && seen.add(c.title.toLowerCase()));
  section('Ideas explained', ideas.flatMap((c) => [`### ${/^concept$/i.test(c.kind) ? '' : 'Why it matters: '}${c.title}`, '', ...(c.body ? [c.body, ''] : [])]).slice(0, -1));

  const learned = [...new Set(all.filter((c) => /what you learned/i.test(c.kind)).flatMap((c) => [c.title, ...c.body.split('\n')])
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean))];
  section('What you learned', learned.map((l) => `- ${l}`));

  section('Quiz', ev.filter((e) => quiz.has(e) && !String(e.text).includes(QUIZ_START)).flatMap((e) =>
    [e.type === 'user' ? `**You:** ${String(e.text).trim()}` : `**Tutor:** ${String(e.text).split(/\n\s*✦ What you learned/)[0].trim()}`, '']).slice(0, -1));

  const files = new Map<string, 'created' | 'changed'>();
  for (const e of ev) if (e.type === 'file_change') files.set(e.path, files.get(e.path) ?? (e.before ? 'changed' : 'created'));
  section('Files', [...files].map(([p, how]) => `- \`${p}\` (${how})`));

  const checks = ev.filter((e) => e.type === 'verify' && (e.state === 'pass' || e.state === 'fail')).map((e) => `- ${e.state === 'pass' ? '✓' : '✗'} \`${String(e.command ?? '').replace(/ --silent$/, '')}\` ${e.state === 'pass' ? 'passed' : 'failed, and the agent was sent back to fix it'}`);
  section('Checks', checks);

  const labels = new Map(ev.filter((e) => e.type === 'label').map((e) => [e.stepId, e]));
  const steps = ev.filter((e) => e.type === 'tool_end' && labels.has(e.id)).map((e, i) => {
    const l = labels.get(e.id)!;
    return `${i + 1}. ${l.label}${l.why ? `: ${l.why}` : ''}${e.ok ? '' : ' *(failed)*'}`;
  });
  section('Steps', steps.slice(0, 60));

  lines.push('---', '', '*Made with [agent-stage](https://github.com/Djbrl/agent-stage). Replay the session in the app to watch each step on the map.*', '');
  return lines.join('\n');
}

// ── session files: export a thread, import it elsewhere as a read-only replay ──
export const SESSION_FORMAT = 'agent-stage/session';
export type SessionFile = {
  format: typeof SESSION_FORMAT; version: 1; exportedAt: number;
  title: string; mode: 'build' | 'learn'; project: string; createdAt: number;
  events: Ev[]; map: MapData;
};

export function exportSession(t: Thread, map: MapData): SessionFile {
  return {
    format: SESSION_FORMAT, version: 1, exportedAt: Date.now(),
    title: t.title, mode: t.mode === 'learn' ? 'learn' : 'build', project: String(t.folder).split(/[\\/]/).filter(Boolean).pop() ?? '', createdAt: t.createdAt,
    // Model usage stays private; everything the replay shows is kept.
    events: (t.events as Ev[]).filter((e) => e.type !== 'usage'),
    map,
  };
}

// A file from someone else: take only the shapes the app knows, so a bad file can't break a thread or the server.
export function parseSession(raw: unknown): SessionFile {
  const s = raw as Partial<SessionFile> | null;
  if (!s || typeof s !== 'object' || s.format !== SESSION_FORMAT) throw new Error('This is not an agent-stage session file.');
  if (s.version !== 1) throw new Error('This session file comes from a newer agent-stage. Update the app to open it.');
  if (!Array.isArray(s.events) || s.events.length > 50_000) throw new Error('The session file has no readable steps.');
  const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  const events = s.events.filter((e): e is Ev => Boolean(e) && typeof e === 'object' && !Array.isArray(e) && typeof e.type === 'string' && e.type !== 'usage')
    .map((e) => ({ ...e, at: Number(e.at) || 0 }));
  const files = Array.isArray(s.map?.files) ? s.map.files : [];
  const edges = Array.isArray(s.map?.edges) ? s.map.edges : [];
  const path = (p: unknown) => str(p, 500).replace(/\\/g, '/');
  return {
    format: SESSION_FORMAT, version: 1, exportedAt: Number(s.exportedAt) || 0,
    title: str(s.title, 100) || 'Shared session', mode: s.mode === 'learn' ? 'learn' : 'build', project: str(s.project, 100), createdAt: Number(s.createdAt) || Date.now(),
    events,
    map: {
      files: files.slice(0, 5000).filter((f) => f && typeof f === 'object').map((f) => ({ path: path(f.path), lines: Number(f.lines) || 0, mtime: Number(f.mtime) || 0 })).filter((f) => f.path),
      edges: edges.slice(0, 20_000).filter((x) => x && typeof x === 'object').map((x) => ({ from: path(x.from), to: path(x.to) })).filter((x) => x.from && x.to),
    },
  };
}
