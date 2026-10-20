// Claude provider, via the official Anthropic SDK. The rest of the harness speaks the OpenAI-style
// message shape, so this file translates both ways. Claude's own content blocks (including thinking)
// are kept on the assistant message as `raw` and sent back unchanged, as the API requires.
import Anthropic from '@anthropic-ai/sdk';
import type { Message, ModelConfig, ToolCall, Usage } from './model.ts';
import { loadSketch } from './sketch.ts';

const clients = new Map<string, Anthropic>();
const client = (cfg: ModelConfig) => {
  let c = clients.get(cfg.apiKey);
  if (!c) { c = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 3, ...(process.env.ANTHROPIC_TEST_URL ? { baseURL: process.env.ANTHROPIC_TEST_URL } : {}) }); clients.set(cfg.apiKey, c); }
  return c;
};

function toAnthropic(messages: Message[], sketches: Map<string, string>) {
  let system = '';
  const out: any[] = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    const last = out.at(-1);
    if (last && last.role === role && role === 'user') last.content.push(...blocks); // keep strict alternation
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n\n' : '') + (m.content ?? ''); continue; }
    if (m.role === 'user') {
      const imgs = (m.images ?? []).flatMap((n) => (sketches.has(n) ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: sketches.get(n) } }] : []));
      push('user', [...imgs, { type: 'text', text: m.content ?? '' }]);
      continue;
    }
    if (m.role === 'tool') { push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }]); continue; }
    if (m.raw) { push('assistant', m.raw); continue; }
    const blocks: any[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const c of m.tool_calls ?? []) {
      let input = {};
      try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* leave empty */ }
      blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
    }
    push('assistant', blocks.length ? blocks : [{ type: 'text', text: '…' }]);
  }
  // Thinking blocks are signed against the system prompt and tools they were made with. Switching to Learn
  // changes both, and the API then rejects them ("Invalid signature in thinking block"). Only the turn in
  // progress needs its thinking back (the tool loop after the last real user message); older turns can drop it.
  // They're also signed against every message before them: once the agent shortens an older tool output to save
  // context (fitContext in agent.ts), the thinking that came after it no longer matches and has to go too.
  const lastTurn = out.findLastIndex((m) => m.role === 'user' && !m.content.some((b: any) => b.type === 'tool_result'));
  const trimmed = out.findIndex((m) => m.role === 'user' && m.content.some((b: any) => b.type === 'tool_result' && String(b.content).startsWith(TRIMMED)));
  return { system, messages: dropThinking(out, (i) => i < lastTurn || (trimmed >= 0 && i > trimmed)) };
}
const TRIMMED = '[older output trimmed';
const dropThinking = (msgs: any[], drop: (i: number) => boolean) => msgs.map((m, i) => {
  if (m.role !== 'assistant' || !drop(i)) return m;
  const kept = m.content.filter((b: any) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
  return { ...m, content: kept.length ? kept : [{ type: 'text', text: '…' }] };
});
// The API's "Invalid `signature` in `thinking` block": the request is sent again without any of the old thinking.
const badSignature = (e: any) => e?.status === 400 && /signature/i.test(String(e?.message)) && /thinking/i.test(String(e?.message));

const toTools = (tools: any[]) => tools.map((t) => ({
  name: t.function.name, description: t.function.description, input_schema: t.function.parameters,
}));

export async function chatAnthropic(cfg: ModelConfig, messages: Message[], tools: unknown[], signal?: AbortSignal, onUsage?: (u: Usage) => void): Promise<Message> {
  const t0 = Date.now();
  const names = [...new Set(messages.flatMap((m) => m.images ?? []))];
  const sketches = new Map(await Promise.all(names.map(async (n) => [n, await loadSketch(n).catch(() => '')] as [string, string])));
  for (const [n, d] of sketches) if (!d) sketches.delete(n);
  const { system, messages: msgs } = toAnthropic(messages, sketches);
  const send = (messages: any[]) => client(cfg).beta.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system,
    messages,
    ...(tools.length ? { tools: toTools(tools as any[]), tool_choice: { type: 'auto' } } : {}),
    output_config: { effort: 'high' }, // agentic coding benefits from deeper thinking
    // If a safety classifier declines, retry on the right fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } as any, { signal });
  const res: any = await send(msgs).catch((e) => { if (badSignature(e)) return send(dropThinking(msgs, () => true)); throw e; });
  onUsage?.({ promptTokens: res.usage?.input_tokens ?? 0, completionTokens: res.usage?.output_tokens ?? 0, ms: Date.now() - t0 });

  if (res.stop_reason === 'refusal') {
    return { role: 'assistant', content: `Claude declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`, raw: res.content };
  }
  const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  const calls: ToolCall[] = res.content.filter((b: any) => b.type === 'tool_use')
    .map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
  return { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}), raw: res.content };
}

export async function checkAnthropic(cfg: ModelConfig) {
  const t0 = Date.now();
  try {
    await client(cfg).models.retrieve(cfg.model, { timeout: 5000 } as any);
    return { state: 'ok' as const, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    const status = e?.status;
    if (status === 401 || status === 403) return { state: 'auth' as const, latencyMs: Date.now() - t0, detail: 'API key rejected' };
    if (status === 404) return { state: 'missing' as const, latencyMs: Date.now() - t0, detail: `no model ${cfg.model}` };
    if (status) return { state: 'error' as const, latencyMs: Date.now() - t0, detail: `HTTP ${status}` };
    return { state: 'unreachable' as const, detail: 'connection failed' };
  }
}
