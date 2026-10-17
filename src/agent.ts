// The loop: model picks a tool, we run it, feed the result back. Emits events so a UI can draw it.
import { chat, type Message, type ModelConfig, type Usage } from './model.ts';
import { toolSchemas, runTool, type ToolContext } from './tools.ts';
import { doneCheck, newRun, gaveUpNote, type RunState } from './verify.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkpointSchema, learnPrompt, languageLine, WRITE_TOOLS, type Checkpoint, type CheckpointAnswer, type LearnPrefs } from './learn.ts';

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: any }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string }
  | { type: 'approval'; id: string; command: string; check?: boolean }
  | { type: 'approval_answer'; id: string; ok: boolean }
  | ({ type: 'checkpoint'; id: string } & Checkpoint)
  | { type: 'checkpoint_answer'; id: string; choice: 'confirm' | 'discuss' | 'skip'; text?: string }
  | { type: 'file_change'; path: string; before: string; after: string }
  | { type: 'user'; text: string }
  | { type: 'question'; id: string; text: string }
  | { type: 'answer'; id: string; text: string }
  | ({ type: 'usage' } & Usage)
  | { type: 'label'; stepId: string; label: string; why: string }
  | { type: 'verify'; id: string; state: 'running' | 'pass' | 'fail' | 'nudge' | 'declined' | 'unavailable'; command?: string; output?: string }
  | { type: 'snapshot'; ref: string }
  | { type: 'task_end'; ref: string; after: string; files: number }
  | { type: 'idle' } // the agent has really finished (sent after done/error, once it no longer counts as running)
  | { type: 'restored'; ref: string; files: { status: string; path: string }[] }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

const BUILD = `You are a coding agent working inside a project folder.
Use the tools to inspect and change files. Prefer small edits. Read before you write.
For web work, check the result yourself: start the dev server with run_command (background: true), then use browser_open on its local address and click through it.
When the task is finished, reply with a short summary and no tool calls.`;

export type Mode = 'build' | 'learn' | 'ask';
export type AgentOptions = { mode: Mode; learn: LearnPrefs; checkpoint?: (cp: Checkpoint & { id: string }) => Promise<CheckpointAnswer> };
const ASK = `You answer questions about this project and about what the coding agent has done in it so far (the conversation above).
You may read files and search to answer accurately, but you cannot change anything. Explain clearly and briefly, like a patient tutor.`;
const systemFor = (o: AgentOptions) => (o.mode === 'learn' ? learnPrompt(o.learn) : o.mode === 'ask' ? ASK + languageLine(o.learn.language) : BUILD + languageLine(o.learn.language));
const READ_ONLY = new Set(['list_files', 'read_file', 'search', 'browser_open', 'browser_read']);

export class Agent {
  messages: Message[];
  opts: AgentOptions;
  private unlocked = false; // learn mode: set by a confirmed Implementation checkpoint, cleared each request
  private abort?: AbortController;
  private pending: string[] = []; // user messages injected mid-run
  running = false;
  private recent: string[] = []; // tool calls since the last file change, for loop detection

  private cfg: ModelConfig;
  private ctx: ToolContext;
  private emit: (e: AgentEvent) => void;

  constructor(cfg: ModelConfig, ctx: ToolContext, emit: (e: AgentEvent) => void, opts?: Partial<AgentOptions>) {
    this.opts = { mode: 'build', learn: { level: 'beginner', frequency: 'normal', language: 'en' }, ...opts };
    this.messages = [{ role: 'system', content: systemFor(this.opts) }];
    this.cfg = cfg;
    this.ctx = { ...ctx, onChange: (path, before, after) => emit({ type: 'file_change', path, before, after }) };
    this.emit = emit;
  }

  stop() { this.abort?.abort(); }
  get root() { return this.ctx.root; }
  setConfig(cfg: ModelConfig) { this.cfg = cfg; }
  // Mode/prefs can change between requests; the system prompt is swapped in place.
  setOptions(o: Partial<AgentOptions>) {
    this.opts = { ...this.opts, ...o };
    if (this.messages[0]?.role === 'system') this.messages[0] = { role: 'system', content: systemFor(this.opts) };
  }
  // Steer: the message joins the main conversation before the next model call.
  interject(text: string) { this.pending.push(text); }
  // Things the model must know before its next task (e.g. the user undid its work). Not shown in the chat.
  notes: string[] = [];

  // Conversation so far, safe to continue elsewhere (unfinished tool calls get a placeholder result).
  snapshot(): Message[] {
    const context = this.messages.slice(1);
    const last = context.at(-1);
    if (last?.role === 'assistant' && last.tool_calls?.length) {
      const answered = new Set(context.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
      for (const c of last.tool_calls) if (!answered.has(c.id)) context.push({ role: 'tool', tool_call_id: c.id, content: '(still running)' });
    }
    return context;
  }

  // Ask: a side question answered right away from the current context. No tools, nothing changes on disk,
  // and the main run keeps going untouched.
  async ask(text: string) {
    const id = crypto.randomUUID();
    this.emit({ type: 'question', id, text });
    const context = [...this.messages];
    const last = context.at(-1);
    if (last?.role === 'assistant' && last.tool_calls?.length) {
      const answered = new Set(context.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
      for (const c of last.tool_calls) if (!answered.has(c.id)) context.push({ role: 'tool', tool_call_id: c.id, content: '(still running)' });
    }
    context.push({ role: 'user', content: `Side question while you work. Answer briefly from what you know so far; do not plan new actions.\n\n${text}` });
    try {
      const reply = await chat(this.cfg, context, [], undefined, (u) => this.emit({ type: 'usage', ...u }));
      this.emit({ type: 'answer', id, text: reply.content ?? '' });
    } catch (e: any) {
      this.emit({ type: 'answer', id, text: `Could not answer: ${e.message}` });
    }
  }

  private owesAnswer = false; // the learner asked something at a checkpoint and no visible reply has been written yet
  private async runCheckpoint(id: string, args: any): Promise<string> {
    if (!this.opts.checkpoint) return 'No learner UI attached; continue.';
    if (this.owesAnswer) throw new Error(`The learner asked a question and hasn't seen an answer: they only see the text you write, not your thinking. Reply to their question in plain words first, then offer the checkpoint again in a later step.`);
    const cp = { id, kind: args.kind === 'implementation' ? 'implementation' : 'design', title: String(args.title ?? ''), summary: String(args.summary ?? ''),
      additions: Array.isArray(args.additions) ? args.additions : undefined, files: Array.isArray(args.files) ? args.files : undefined } as Checkpoint & { id: string };
    this.emit({ type: 'checkpoint', ...cp });
    const answer = await this.opts.checkpoint(cp);
    this.emit({ type: 'checkpoint_answer', id, choice: answer.choice, text: answer.text });
    if (answer.choice === 'confirm') {
      if (cp.kind === 'implementation') { this.unlocked = true; return 'Learner confirmed: implement exactly this step now. Then give the Implementation report.'; }
      return 'Learner confirmed this design. Record it and continue planning; you still need an implementation checkpoint before writing code.';
    }
    if (answer.choice === 'discuss') this.owesAnswer = true;
    if (answer.choice === 'skip') return `Learner declined this step: don't implement it and don't write any files for it. Briefly acknowledge, then ask what they'd like to do instead (or end your turn).`;
    return `Learner wants to discuss before deciding${answer.text ? `: "${answer.text}"` : ''}. Answer them in your reply text, in plain words (they only see what you write, not your thinking). Then end your turn, or offer the checkpoint again after the answer.`;
  }

  // Context budget: when the conversation gets long, older tool outputs are replaced by a short stub (the model
  // can re-read files if it needs them). The tool-call structure stays intact, so every provider accepts it.
  private fitContext(budgetChars = 120_000): Message[] {
    const size = (m: Message) => (m.content?.length ?? 0) + JSON.stringify(m.tool_calls ?? '').length;
    let total = this.messages.reduce((a, m) => a + size(m), 0);
    if (total <= budgetChars) return this.messages;
    const out = this.messages.map((m) => ({ ...m }));
    const toolIdx = out.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
    for (const i of toolIdx.slice(0, -2)) {
      if (total <= budgetChars) break;
      const len = out[i].content?.length ?? 0;
      if (len < 400) continue;
      out[i].content = `[older output trimmed to save context (${len} chars); re-read the file or rerun if you need it]\n${out[i].content!.slice(0, 200)}`;
      total -= len - out[i].content!.length;
    }
    return out;
  }

  // Project instructions (AGENTS.md or CLAUDE.md at the root), loaded once per conversation.
  private async loadProjectInstructions() {
    if (this.messages.some((m) => m.role === 'system' && m.content?.startsWith('Project instructions'))) return;
    if (this.opts.mode === 'ask') return;
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      const text = await readFile(join(this.ctx.root, f), 'utf8').catch(() => null);
      if (text) { this.messages.splice(1, 0, { role: 'system', content: `Project instructions from ${f}:\n${text.slice(0, 12_000)}` }); return; }
    }
  }

  private checkApproved = new Set<string>();

  async run(task: string, maxSteps = 30) {
    await this.loadProjectInstructions();
    this.messages.push({ role: 'user', content: [...this.notes.splice(0), task].join('\n\n') });
    this.emit({ type: 'user', text: task });
    this.unlocked = false;
    const learning = this.opts.mode === 'learn';
    const asking = this.opts.mode === 'ask';
    const tools = learning ? [...toolSchemas, checkpointSchema] : asking ? toolSchemas.filter((t) => READ_ONLY.has(t.function.name)) : toolSchemas;
    this.abort = new AbortController();
    this.running = true;
    const run: RunState = newRun();
    try {
      for (let step = 0; step < maxSteps; step++) {
        while (this.pending.length) {
          const text = this.pending.shift()!;
          this.messages.push({ role: 'user', content: text });
          this.emit({ type: 'user', text });
        }
        if (this.abort.signal.aborted) throw new Error('stopped');
        const reply = await chat(this.cfg, this.fitContext(), tools, this.abort.signal, (u) => this.emit({ type: 'usage', ...u }));
        if (this.abort.signal.aborted) throw new Error('stopped'); // a model that ignores the signal mustn't carry on
        this.messages.push(reply);
        if (reply.content?.trim()) this.owesAnswer = false;
        if (reply.content && reply.tool_calls?.length) this.emit({ type: 'thinking', text: reply.content });
        if (!reply.tool_calls?.length) {
          // "Done" is a claim: check it before accepting it.
          const notYet = this.opts.mode === 'build' && run.wrote ? await doneCheck(this.ctx, this.emit, run, this.checkApproved) : null;
          if (!notYet) return this.emit({ type: 'done', text: (reply.content ?? '') + gaveUpNote(run) });
          this.messages.push({ role: 'user', content: notYet }); // its premature summary stays out of the chat
          continue;
        }

        for (const call of reply.tool_calls) {
          if (this.abort.signal.aborted) throw new Error('stopped');
          let output: string, ok = true;
          const args = parseArgs(call.function.arguments);
          this.emit({ type: 'tool_start', id: call.id, name: call.function.name, args: args ?? { raw: call.function.arguments } });
          try {
            if (!args) throw new Error(`arguments were not valid JSON: ${call.function.arguments.slice(0, 200)}. Retry with valid JSON.`);
            if (call.function.name === 'checkpoint') output = await this.runCheckpoint(call.id, args);
            else if (asking && !READ_ONLY.has(call.function.name)) throw new Error('This is a read-only side thread: you can only read and search.');
            else if (learning && WRITE_TOOLS.has(call.function.name) && !this.unlocked)
              throw new Error('Locked by the harness: in Learn mode you must call the checkpoint tool with kind "implementation" and get the learner\'s confirmation before writing files or running commands.');
            else output = await runTool(this.ctx, call.function.name, args);
          } catch (e: any) {
            ok = false;
            output = `error: ${e.message}`;
          }
          this.emit({ type: 'tool_end', id: call.id, name: call.function.name, ok, output });
          if (ok && (call.function.name === 'write_file' || call.function.name === 'edit_file')) { run.wrote = true; run.tested = false; }
          if (call.function.name === 'run_command' || call.function.name.startsWith('browser_')) run.tested = true;
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
          // Repeating a call after changing a file is normal (re-run the test). Repeating it with
          // nothing changed in between is a loop.
          if (ok && (call.function.name === 'write_file' || call.function.name === 'edit_file')) this.recent = [];
          else this.recent.push(`${call.function.name}:${call.function.arguments}`);
        }
        // Small models loop. 3 identical calls since the last file change → nudge it once.
        const counts = new Map<string, number>();
        for (const k of this.recent) counts.set(k, (counts.get(k) ?? 0) + 1);
        const looping = [...counts].find(([, n]) => n >= 3);
        if (looping) {
          this.messages.push({ role: 'user', content: `You have run \`${looping[0].split(':')[0]}\` with the same arguments ${looping[1]} times without changing any file in between. Stop repeating it: change approach, or finish with a summary.` });
          this.recent = [];
        }
      }
      this.emit({ type: 'error', message: `Stopped: reached the step limit (${maxSteps} steps)` });
    } catch (e: any) {
      this.emit({ type: 'error', message: this.abort.signal.aborted ? 'Stopped by you' : e.message });
    } finally {
      this.running = false;
    }
  }
}

function parseArgs(raw: string): any | null {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === 'string' ? JSON.parse(v) : v; // some models double-encode
  } catch {
    return null;
  }
}
