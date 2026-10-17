// The Claude Code engine: the same UI, Learn mode and map, with Anthropic's Claude Code agent loop underneath,
// driven through the official Claude Agent SDK and an API key (Anthropic's documented route for third-party apps;
// we never offer claude.ai login or touch subscription credentials). Its events are translated into ours.
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { AgentEvent, AgentOptions } from './agent.ts';
import type { Message, ModelConfig } from './model.ts';
import type { ToolContext } from './tools.ts';
import { browserSchemas, runBrowserTool } from './browser.ts';
import { SHOTS } from './browser.ts';
import { doneCheck, newRun, gaveUpNote } from './verify.ts';
import { learnPrompt, languageLine, type Checkpoint } from './learn.ts';

const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_ONLY = ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite'];
const CHECKPOINT = 'mcp__agentstage__checkpoint';
const MCP = 'mcp__agentstage__';

// A tiny push-able async queue: the prompt stream we feed Claude Code (task first, then any steering).
class Inbox {
  private items: any[] = []; private waiting?: (v: IteratorResult<any>) => void; private closed = false;
  push(text: string) {
    const msg = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    if (this.waiting) { this.waiting({ value: msg, done: false }); this.waiting = undefined; } else this.items.push(msg);
  }
  close() { this.closed = true; this.waiting?.({ value: undefined, done: true }); }
  [Symbol.asyncIterator]() {
    return { next: (): Promise<IteratorResult<any>> => {
      if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
      if (this.closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((r) => (this.waiting = r));
    } };
  }
}

export class ClaudeCodeAgent {
  messages: Message[] = []; // our own transcript isn't used to drive Claude Code (it keeps its session); kept for the interface
  opts: AgentOptions;
  running = false;
  sessionId?: string;
  fork = false; // side threads fork the parent session instead of continuing it
  private cfg: ModelConfig;
  private ctx: ToolContext;
  private emit: (e: AgentEvent) => void;
  private inbox?: Inbox;
  private q?: ReturnType<typeof query>;
  private unlocked = false;
  private before = new Map<string, string>();
  private checkApproved = new Set<string>(); // tool_use_id → file content before an edit

  constructor(cfg: ModelConfig, ctx: ToolContext, emit: (e: AgentEvent) => void, opts?: Partial<AgentOptions>) {
    this.cfg = cfg; this.ctx = ctx; this.emit = emit;
    this.opts = { mode: 'build', learn: { level: 'beginner', frequency: 'normal', language: 'en' }, ...opts };
  }
  get root() { return this.ctx.root; }
  setConfig(cfg: ModelConfig) { this.cfg = cfg; }
  setOptions(o: Partial<AgentOptions>) { this.opts = { ...this.opts, ...o }; }
  snapshot(): Message[] { return []; }
  interject(text: string) { this.inbox?.push(text); this.emit({ type: 'user', text }); }
  notes: string[] = []; // see Agent.notes
  private stopping = false;
  stop() { this.stopping = true; void this.q?.interrupt().catch(() => {}); this.inbox?.close(); }
  async ask(text: string) { this.emit({ type: 'answer', id: crypto.randomUUID(), text: `(Use Ask to open a side thread.) ${text}` }); }

  private rel(p: unknown) {
    const s = String(p ?? '');
    return isAbsolute(s) ? relative(this.ctx.root, s) : s;
  }
  // Claude Code's tools → our vocabulary, so the map, labels and steps sheet work unchanged.
  private translate(name: string, input: any): { name: string; args: any } {
    switch (name) {
      case 'Read': return { name: 'read_file', args: { path: this.rel(input.file_path) } };
      case 'Write': return { name: 'write_file', args: { path: this.rel(input.file_path) } };
      case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { name: 'edit_file', args: { path: this.rel(input.file_path ?? input.notebook_path) } };
      case 'Bash': return { name: 'run_command', args: { command: input.command } };
      case 'Grep': return { name: 'search', args: { text: input.pattern } };
      case 'Glob': case 'LS': return { name: 'list_files', args: { pattern: input.pattern ?? input.path } };
      case CHECKPOINT: return { name: 'checkpoint', args: input };
      default: return name.startsWith(MCP) ? { name: name.slice(MCP.length), args: input } : { name, args: input };
    }
  }

  private async checkpoint(args: any): Promise<string> {
    const id = crypto.randomUUID();
    if (!this.opts.checkpoint) return 'No learner UI attached; continue.';
    const cp = { id, kind: args.kind === 'implementation' ? 'implementation' : 'design', title: String(args.title ?? ''), summary: String(args.summary ?? ''),
      additions: args.additions, files: args.files } as Checkpoint & { id: string };
    this.emit({ type: 'checkpoint', ...cp });
    const a = await this.opts.checkpoint(cp);
    this.emit({ type: 'checkpoint_answer', id, choice: a.choice, text: a.text });
    if (a.choice === 'confirm') {
      if (cp.kind === 'implementation') { this.unlocked = true; return 'Learner confirmed: implement exactly this step now, then give the Implementation report.'; }
      return 'Learner confirmed this design. You still need an implementation checkpoint before writing code.';
    }
    if (a.choice === 'skip') return `Learner declined this step: don't implement it and don't write any files for it. Briefly acknowledge, then ask what they'd like to do instead (or end your turn).`;
    return `Learner wants to discuss before deciding${a.text ? `: "${a.text}"` : ''}. Answer them, then end your turn or offer the checkpoint again.`;
  }

  async run(task: string, maxSteps = 30) {
    const learning = this.opts.mode === 'learn', asking = this.opts.mode === 'ask';
    this.unlocked = false;
    this.stopping = false;
    this.running = true;
    this.emit({ type: 'user', text: task });
    this.inbox = new Inbox();
    this.inbox.push([...this.notes.splice(0), task].join('\n\n'));
    const append = (learning
      ? `${learnPrompt(this.opts.learn)}\nThe checkpoint tool is named ${CHECKPOINT}.`
      : asking ? 'You are answering a side question. Read and search as needed but do not change anything.' : '') + languageLine(this.opts.learn.language);
    const server = createSdkMcpServer({ name: 'agentstage', version: '1.0.0', tools: [
      ...(!learning ? [] : [tool('checkpoint', 'Show the learner a Design or Implementation checkpoint and wait for their decision. Implementation checkpoints are the only way to unlock file edits and shell commands.', {
        kind: z.enum(['design', 'implementation']), title: z.string(), summary: z.string(),
        additions: z.array(z.object({ detail: z.string(), proposal: z.string(), why: z.string() })).optional(),
        files: z.array(z.string()).optional(),
      }, async (args) => ({ content: [{ type: 'text' as const, text: await this.checkpoint(args) }] }))]),
      // The same browser and computer tools as our own engine. Claude also gets the screenshot itself.
      ...browserSchemas.filter((b) => !asking || b.function.name === 'browser_read' || b.function.name === 'browser_open').map((b) => tool(b.function.name, b.function.description, zodOf(b.function.parameters as any),
        async (args: any) => {
          const text = await runBrowserTool(this.ctx, b.function.name, args).catch((e) => `error: ${e.message}`);
          const m = text.match(/\[screenshot: \/api\/shots\/([\w-]+\.png)\]/);
          const img = m ? await readFile(join(SHOTS, m[1])).catch(() => null) : null;
          return { content: [{ type: 'text' as const, text }, ...(img ? [{ type: 'image' as const, data: img.toString('base64'), mimeType: 'image/png' }] : [])] };
        })),
    ] });

    this.q = query({ prompt: this.inbox as any, options: {
      cwd: this.ctx.root,
      model: this.cfg.model,
      env: { ...process.env, ANTHROPIC_API_KEY: this.cfg.apiKey } as any,
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      settingSources: ['project'], // reads the project's CLAUDE.md; ignores this machine's user-level hooks/plugins
      maxTurns: maxSteps,
      permissionMode: asking ? 'plan' : 'default',
      ...(asking ? { disallowedTools: [...WRITES, 'Bash'] } : {}),
      mcpServers: { agentstage: server },
      ...(this.sessionId ? { resume: this.sessionId, forkSession: this.fork } : {}),
      // Edits run freely (like our own engine); shell commands go through the approval card.
      canUseTool: async (name: string, input: Record<string, unknown>) => {
        if (name === 'Bash') {
          const ok = await this.ctx.approve(String(input.command ?? ''));
          return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user denied this command.' };
        }
        return { behavior: 'allow', updatedInput: input };
      },
      hooks: {
        // Learn mode lock, enforced by the engine: no edits or commands before an approved Implementation checkpoint.
        PreToolUse: [{ hooks: [async (input: any) => {
          const n = input.tool_name;
          if (learning && (WRITES.has(n) || n === 'Bash') && !this.unlocked) {
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
              permissionDecisionReason: `Locked by agent-stage: call ${CHECKPOINT} with kind "implementation" and get the learner's confirmation first.` } };
          }
          if (WRITES.has(n)) {
            const p = String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '');
            this.before.set(input.tool_use_id, await readFile(isAbsolute(p) ? p : join(this.ctx.root, p), 'utf8').catch(() => ''));
          }
          return {};
        }] }],
        PostToolUse: [{ hooks: [async (input: any) => {
          if (WRITES.has(input.tool_name) && this.before.has(input.tool_use_id)) {
            const p = String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '');
            const after = await readFile(isAbsolute(p) ? p : join(this.ctx.root, p), 'utf8').catch(() => '');
            this.emit({ type: 'file_change', path: this.rel(p), before: this.before.get(input.tool_use_id)!, after });
            run.wrote = true; run.tested = false;
            this.before.delete(input.tool_use_id);
          }
          return {};
        }] }],
      } as any,
    } as any });

    const pending = new Map<string, string>(); // tool_use_id → our tool name
    const run = newRun();
    let ended = false; // one done/error per run: after a stop the SDK also throws, which mustn't show as a second error
    let lastText = '', heldText = ''; // narration shows when the next tool call arrives; the final text goes to "done"
    try {
      for await (const m of this.q as AsyncIterable<any>) {
        if (m.type === 'system' && m.subtype === 'init') { this.sessionId = m.session_id; this.fork = false; }
        if (m.type === 'assistant' && !m.parent_tool_use_id) {
          const blocks = m.message?.content ?? [];
          const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
          const uses = blocks.filter((b: any) => b.type === 'tool_use');
          if (text) { heldText = heldText ? `${heldText}\n\n${text}` : text; lastText = text; }
          if (uses.length && heldText) { this.emit({ type: 'thinking', text: heldText }); heldText = ''; }
          for (const u of uses) {
            const t = this.translate(u.name, u.input ?? {});
            pending.set(u.id, t.name);
            if (t.name === 'run_command' || t.name.startsWith('browser_')) run.tested = true;
            this.emit({ type: 'tool_start', id: u.id, name: t.name, args: t.args });
          }
        }
        if (m.type === 'user' && !m.parent_tool_use_id && Array.isArray(m.message?.content)) {
          for (const r of m.message.content.filter((b: any) => b.type === 'tool_result')) {
            const name = pending.get(r.tool_use_id);
            if (!name) continue;
            const out = typeof r.content === 'string' ? r.content : (r.content ?? []).map((c: any) => c.text ?? '').join('\n');
            this.emit({ type: 'tool_end', id: r.tool_use_id, name, ok: !r.is_error, output: out.slice(0, 8000) });
            pending.delete(r.tool_use_id);
          }
        }
        if (m.type === 'result') {
          const u = m.usage ?? {};
          this.emit({ type: 'usage', promptTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            completionTokens: u.output_tokens ?? 0, ms: m.duration_api_ms ?? m.duration_ms ?? 0, costUsd: m.total_cost_usd } as any);
          if (m.subtype === 'success') {
            // Same done-check as our own engine: a failing check goes back into the session as the next message.
            const notYet = this.opts.mode === 'build' && run.wrote ? await doneCheck(this.ctx, this.emit as any, run, this.checkApproved) : null;
            if (notYet) { this.inbox.push(notYet); continue; }
            this.emit({ type: 'done', text: (m.result ?? lastText) + gaveUpNote(run) });
          } else this.emit({ type: 'error', message: this.stopping ? 'Stopped by you' : m.subtype === 'error_max_turns' ? `Stopped: reached the step limit (${maxSteps} steps)`
            : 'Claude Code ran into an error and stopped. Send your message again to retry.' });
          ended = true;
          this.inbox.close();
        }
      }
    } catch (e: any) {
      if (!ended) this.emit({ type: 'error', message: this.stopping || /abort|interrupt/i.test(String(e?.message)) ? 'Stopped by you' : `Claude Code: ${e?.message ?? e}` });
    } finally {
      for (const [id, name] of pending) this.emit({ type: 'tool_end', id, name, ok: false, output: 'interrupted' });
      this.running = false;
      this.inbox?.close();
    }
  }
}

// JSON-schema properties (as written for the open-model tools) → the zod shape the SDK's tool() wants.
function zodOf(schema: { properties: Record<string, { type: string; description?: string }>; required?: string[] }) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    let t: z.ZodTypeAny = v.type === 'number' ? z.number() : v.type === 'boolean' ? z.boolean() : z.string();
    if (v.description) t = t.describe(v.description);
    shape[k] = schema.required?.includes(k) ? t : t.optional();
  }
  return shape;
}
