// The loop: model picks a tool, we run it, feed the result back. Emits events so a UI can draw it.
import { chat, type Message, type ModelConfig, type Usage } from './model.ts';
import { toolSchemas, runTool, type ToolContext } from './tools.ts';

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: any }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string }
  | { type: 'approval'; id: string; command: string }
  | { type: 'file_change'; path: string; before: string; after: string }
  | { type: 'user'; text: string }
  | { type: 'question'; id: string; text: string }
  | { type: 'answer'; id: string; text: string }
  | ({ type: 'usage' } & Usage)
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

const SYSTEM = `You are a coding agent working inside a project folder.
Use the tools to inspect and change files. Prefer small edits. Read before you write.
When the task is finished, reply with a short summary and no tool calls.`;

export class Agent {
  messages: Message[] = [{ role: 'system', content: SYSTEM }];
  private abort?: AbortController;
  private pending: string[] = []; // user messages injected mid-run
  running = false;
  private recent: string[] = []; // tool calls since the last file change, for loop detection

  private cfg: ModelConfig;
  private ctx: ToolContext;
  private emit: (e: AgentEvent) => void;

  constructor(cfg: ModelConfig, ctx: ToolContext, emit: (e: AgentEvent) => void) {
    this.cfg = cfg;
    this.ctx = { ...ctx, onChange: (path, before, after) => emit({ type: 'file_change', path, before, after }) };
    this.emit = emit;
  }

  stop() { this.abort?.abort(); }
  get root() { return this.ctx.root; }
  setConfig(cfg: ModelConfig) { this.cfg = cfg; }
  // Steer: the message joins the main conversation before the next model call.
  interject(text: string) { this.pending.push(text); }

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

  async run(task: string, maxSteps = 30) {
    this.messages.push({ role: 'user', content: task });
    this.emit({ type: 'user', text: task });
    this.abort = new AbortController();
    this.running = true;
    try {
      for (let step = 0; step < maxSteps; step++) {
        while (this.pending.length) {
          const text = this.pending.shift()!;
          this.messages.push({ role: 'user', content: text });
          this.emit({ type: 'user', text });
        }
        const reply = await chat(this.cfg, this.messages, toolSchemas, this.abort.signal, (u) => this.emit({ type: 'usage', ...u }));
        this.messages.push(reply);
        if (reply.content && reply.tool_calls?.length) this.emit({ type: 'thinking', text: reply.content });
        if (!reply.tool_calls?.length) return this.emit({ type: 'done', text: reply.content ?? '' });

        for (const call of reply.tool_calls) {
          if (this.abort.signal.aborted) throw new Error('stopped');
          let output: string, ok = true;
          const args = parseArgs(call.function.arguments);
          this.emit({ type: 'tool_start', id: call.id, name: call.function.name, args: args ?? { raw: call.function.arguments } });
          try {
            if (!args) throw new Error(`arguments were not valid JSON: ${call.function.arguments.slice(0, 200)}. Retry with valid JSON.`);
            output = await runTool(this.ctx, call.function.name, args);
          } catch (e: any) {
            ok = false;
            output = `error: ${e.message}`;
          }
          this.emit({ type: 'tool_end', id: call.id, name: call.function.name, ok, output });
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
      this.emit({ type: 'error', message: `hit step limit (${maxSteps})` });
    } catch (e: any) {
      this.emit({ type: 'error', message: this.abort.signal.aborted ? 'stopped by user' : e.message });
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
