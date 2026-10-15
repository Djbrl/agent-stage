// The loop: model picks a tool, we run it, feed the result back. Emits events so a UI can draw it.
import { chat, type Message, type ModelConfig } from './model.ts';
import { toolSchemas, runTool, type ToolContext } from './tools.ts';

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: any }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string }
  | { type: 'approval'; id: string; command: string }
  | { type: 'file_change'; path: string; before: string; after: string }
  | { type: 'user'; text: string }
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
  interject(text: string) { this.pending.push(text); }

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
        const reply = await chat(this.cfg, this.messages, toolSchemas, this.abort.signal);
        this.messages.push(reply);
        if (reply.content && reply.tool_calls?.length) this.emit({ type: 'thinking', text: reply.content });
        if (!reply.tool_calls?.length) return this.emit({ type: 'done', text: reply.content ?? '' });

        for (const call of reply.tool_calls) {
          if (this.abort.signal.aborted) throw new Error('stopped');
          let args: any = {};
          let output: string, ok = true;
          try {
            args = JSON.parse(call.function.arguments || '{}');
            this.emit({ type: 'tool_start', id: call.id, name: call.function.name, args });
            output = await runTool(this.ctx, call.function.name, args);
          } catch (e: any) {
            ok = false;
            output = `error: ${e.message}`;
          }
          this.emit({ type: 'tool_end', id: call.id, name: call.function.name, ok, output });
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
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
