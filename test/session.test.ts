// Lesson notes and shared sessions: built from the thread's events, and a shared session can only be replayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callouts, lessonNotes, exportSession, parseSession, SESSION_FORMAT } from '../src/session.ts';
import type { Thread } from '../src/store.ts';

const at = 1_760_000_000_000;
const thread = (events: object[]): Thread => ({
  id: 't1', title: 'Greeting module', folder: '/home/me/greeter', providerId: 'mock', mode: 'learn', createdAt: at, updatedAt: at,
  messages: [], usage: { promptTokens: 0, completionTokens: 0, modelMs: 0, calls: 0 }, events: events.map((e, i) => ({ at: at + i, ...e })),
});
const EVENTS = [
  { type: 'user', text: 'Build a greeter' },
  { type: 'thinking', text: '✦ Build checkpoint: where the logic lives\n\nHow would you split it?\n\n✦ Concept: module\n\nA module is a file that exports functions.\nOther files import them.' },
  { type: 'checkpoint', id: 'c1', kind: 'implementation', title: 'Greeting module', summary: 'Put greet() in src/greet.js.' },
  { type: 'checkpoint_answer', id: 'c1', choice: 'confirm' },
  { type: 'tool_start', id: 's1', name: 'write_file', args: { path: 'src/greet.js' } },
  { type: 'file_change', path: 'src/greet.js', before: '', after: 'export const greet = () => 1;' },
  { type: 'tool_end', id: 's1', name: 'write_file', ok: true, output: 'wrote src/greet.js' },
  { type: 'label', stepId: 's1', label: 'Created the greeting module', why: 'it holds the logic' },
  { type: 'file_change', path: 'index.js', before: 'old', after: 'new' },
  { type: 'verify', id: 'v1', state: 'fail', command: 'npm test --silent' },
  { type: 'verify', id: 'v2', state: 'pass', command: 'npm test --silent' },
  { type: 'usage', promptTokens: 900, completionTokens: 100, ms: 1000, costUsd: 0.5 },
  { type: 'done', text: '✦ Implementation report\n\nDone.\n\n✦ Why this matters: separation\nYou can test the logic alone.\n\n✦ What you learned:\n- A module exports functions\n- Logic apart from printing is testable\n\nTry it now.' },
];

test('callouts finds concepts, reasons and what was learned', () => {
  const c = callouts(String(EVENTS[1].text)).concat(callouts(String(EVENTS.at(-1)!.text)));
  assert.deepEqual(c.map((x) => [x.kind, x.title]), [
    ['Build checkpoint', 'where the logic lives'], ['Concept', 'module'], ['Why this matters', 'separation'], ['What you learned', ''],
  ]); // "✦ Implementation report" has no colon: a heading, not a callout
  assert.equal(c[1].body, 'A module is a file that exports functions.\nOther files import them.');
  assert.equal(c[3].body, '- A module exports functions\n- Logic apart from printing is testable'); // "Try it now." is not part of it
});

test('callouts accepts a concept written on one line, in bold', () => {
  assert.deepEqual(callouts('**✦ Concept: closure** a function that remembers.').map((x) => [x.kind, x.title]), [['Concept', 'closure a function that remembers.']]);
  assert.deepEqual(callouts('Plain text with no callouts.'), []);
});

test('lesson notes gather the session into a study sheet', () => {
  const md = lessonNotes(thread(EVENTS));
  assert.match(md, /^# Greeting module\n/);
  assert.match(md, /Tandem mode · project `greeter`/);
  assert.match(md, /## What you asked\n\n> Build a greeter/);
  assert.match(md, /## Decisions\n\n- \*\*Implementation: Greeting module\*\*: Put greet\(\) in src\/greet\.js\. \*\(you approved it\)\*/);
  assert.match(md, /### module\n\nA module is a file that exports functions\.\nOther files import them\./);
  assert.match(md, /### Why it matters: separation\n\nYou can test the logic alone\./);
  assert.match(md, /## What you learned\n\n- A module exports functions\n- Logic apart from printing is testable/);
  assert.match(md, /- `src\/greet\.js` \(created\)\n- `index\.js` \(changed\)/);
  assert.match(md, /✗ `npm test` failed, and the agent was sent back to fix it\n- ✓ `npm test` passed/);
  assert.match(md, /## Steps\n\n1\. Created the greeting module: it holds the logic/);
  assert.doesNotMatch(md, /Build checkpoint|Implementation report/); // teaching markers, not ideas
});

test('a quiz gets its own section, not counted as requests', () => {
  const quiz = [
    { type: 'user', text: 'Build a greeter' },
    { type: 'done', text: 'Built it.' },
    { type: 'user', text: 'Quiz me on what we just did: ask me 3 short questions.' },
    { type: 'done', text: '**Question 1 of 3.** Why a module?' },
    { type: 'user', text: 'to reuse it' },
    { type: 'done', text: 'Right.\n\n**Question 2 of 3.** What does greet("") return?' },
    { type: 'user', text: 'stranger' },
    { type: 'done', text: 'Yes.\n\n**Question 3 of 3.** Which file to test?' },
    { type: 'user', text: 'greet.js' },
    { type: 'done', text: 'Score: 3 / 3\n\n✦ What you learned:\n- Modules' },
    { type: 'user', text: 'Now add a farewell' },
  ];
  const md = lessonNotes(thread(quiz));
  assert.match(md, /## What you asked\n\n> Build a greeter\n\n> Now add a farewell\n\n## /);
  assert.match(md, /## Quiz\n\n\*\*Tutor:\*\* \*\*Question 1 of 3\.\*\* Why a module\?\n\n\*\*You:\*\* to reuse it\n/);
  assert.match(md, /\*\*You:\*\* greet\.js\n\n\*\*Tutor:\*\* Score: 3 \/ 3\n\n(## |---)/); // "What you learned" goes to its own section
  assert.match(md, /## What you learned\n\n- Modules/);
});

test('an empty thread still gives a valid sheet', () => {
  const md = lessonNotes(thread([]));
  assert.match(md, /^# Greeting module/);
  assert.doesNotMatch(md, /## /);
});

test('a session file round-trips, without the usage', () => {
  const map = { files: [{ path: 'src/greet.js', lines: 3, mtime: 1 }], edges: [{ from: 'index.js', to: 'src/greet.js' }] };
  const file = JSON.parse(JSON.stringify(exportSession(thread(EVENTS), map)));
  assert.equal(file.format, SESSION_FORMAT);
  assert.equal(file.project, 'greeter');
  assert.ok(!file.events.some((e: any) => e.type === 'usage'));
  const back = parseSession(file);
  assert.equal(back.title, 'Greeting module');
  assert.equal(back.mode, 'learn');
  assert.equal(back.events.length, EVENTS.length - 1);
  assert.deepEqual(back.map, map);
});

test('a bad or foreign file is refused, and odd entries are dropped', () => {
  assert.throws(() => parseSession(null), /not a Codetandem session/);
  assert.throws(() => parseSession({ format: 'other' }), /not a Codetandem session/);
  assert.throws(() => parseSession({ format: SESSION_FORMAT, version: 2 }), /newer Codetandem/);
  assert.throws(() => parseSession({ format: SESSION_FORMAT, version: 1, events: 'x' }), /no readable steps/);
  const s = parseSession({
    format: SESSION_FORMAT, version: 1, title: 'x'.repeat(500), mode: 'hack',
    events: [null, 5, [], { no: 'type' }, { type: 'usage' }, { type: 'user', text: 'hi', at: 'soon' }],
    map: { files: [{ path: 'src\\a.js', lines: 'many' }, { path: '' }, 'junk'], edges: [{ from: 'a', to: '' }] },
  });
  assert.equal(s.title.length, 100);
  assert.equal(s.mode, 'build');
  assert.deepEqual(s.events, [{ type: 'user', text: 'hi', at: 0 }]);
  assert.deepEqual(s.map, { files: [{ path: 'src/a.js', lines: 0, mtime: 0 }], edges: [] });
});

// The real server: import a session, then check it can be replayed and downloaded but never run.
test('a shared session can be replayed but not run', { timeout: 60_000 }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'agst-home-')), ws = await mkdtemp(join(tmpdir(), 'agst-ws-'));
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(ws, { recursive: true, force: true })]));
  const port = 41000 + Math.floor(Math.random() * 9000);
  const server = spawn(process.execPath, ['scripts/mock.ts'], { env: { ...process.env, AGENT_STAGE_HOME: home, WORKSPACE: ws, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { server.kill(); });
  await new Promise<void>((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`server did not start:\n${out}`)), 30_000);
    const take = (d: Buffer) => { out += d; if (out.includes('agent-stage →')) { clearTimeout(timer); ok(); } };
    server.stdout.on('data', take); server.stderr.on('data', take);
    server.on('exit', (code) => { clearTimeout(timer); fail(new Error(`server exited (${code}):\n${out}`)); });
  });
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;
  const post = (p: string, body: unknown) => fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const map = { files: [{ path: 'src/greet.js', lines: 3, mtime: 1 }], edges: [] };
  const bad = await post('/api/threads/import', { format: 'nope' });
  assert.equal(bad.status, 400);
  const res = await post('/api/threads/import', exportSession(thread(EVENTS), map));
  assert.equal(res.status, 200);
  const { id } = await res.json() as { id: string };

  const state = await (await fetch(url(`/api/threads/${id}/state`))).json() as any;
  assert.equal(state.shared, true);
  assert.equal(state.workspace, 'greeter');
  assert.deepEqual(state.files, ['src/greet.js']);
  assert.deepEqual(await (await fetch(url(`/api/threads/${id}/map`))).json(), map);
  const log = await (await fetch(url(`/api/threads/${id}/log`))).json() as any;
  assert.equal(log.total, EVENTS.length - 1);
  const list = await (await fetch(url('/api/threads'))).json() as any[];
  assert.equal(list.find((x) => x.id === id)?.shared, true);

  for (const [path, body] of [['task', { task: 'rm -rf everything' }], ['steer', { text: 'go' }], ['ask-thread', { question: 'q' }], ['mode', { mode: 'build' }],
    ['undo', { ref: 'a'.repeat(40) }], ['keep-task', { ref: 'a'.repeat(40) }], ['git/init', {}]] as const) {
    const r = await post(`/api/threads/${id}/${path}`, body);
    assert.equal(r.status, 403, path);
    assert.match(((await r.json()) as any).error, /shared session/, path);
  }
  const folder = join(home, 'shared');
  const [own] = await readdir(folder);
  assert.deepEqual(await readdir(join(folder, own)), []); // nothing ran in its folder

  const notes = await fetch(url(`/api/threads/${id}/notes`));
  assert.match(notes.headers.get('content-disposition') ?? '', /attachment; filename="Greeting-module\.md"/);
  assert.match(await notes.text(), /## What you learned/);
  const again = await (await fetch(url(`/api/threads/${id}/export`))).json() as any;
  assert.deepEqual(again.map, map); // re-sharing keeps the original map

  assert.equal((await fetch(url(`/api/threads/${id}`), { method: 'DELETE' })).status, 200);
  assert.deepEqual(await readdir(folder), []); // its folder went with it
});

test('notes and export work on a normal thread too', { timeout: 60_000 }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'agst-home-')), ws = await mkdtemp(join(tmpdir(), 'agst-ws-'));
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(ws, { recursive: true, force: true })]));
  await mkdir(join(ws, 'src'));
  const port = 41000 + Math.floor(Math.random() * 9000);
  const server = spawn(process.execPath, ['scripts/mock.ts'], { env: { ...process.env, AGENT_STAGE_HOME: home, WORKSPACE: ws, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { server.kill(); });
  await new Promise<void>((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`server did not start:\n${out}`)), 30_000);
    server.stdout.on('data', (d) => { out += d; if (out.includes('agent-stage →')) { clearTimeout(timer); ok(); } });
  });
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;
  const created = await (await fetch(url('/api/threads'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: ws, mode: 'learn' }) })).json() as any;
  const file = await (await fetch(url(`/api/threads/${created.id}/export`))).json() as any;
  assert.equal(file.format, SESSION_FORMAT);
  assert.equal(file.mode, 'learn');
  assert.ok(Array.isArray(file.map.files));
  assert.equal((await fetch(url(`/api/threads/${created.id}/notes`))).status, 200);
});
