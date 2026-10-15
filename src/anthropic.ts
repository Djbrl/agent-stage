// Claude provider, via the official Anthropic SDK. The rest of the harness speaks the OpenAI-style
// message shape, so this file translates both ways. Claude's own content blocks (including thinking)
// are kept on the assistant message as `raw` and sent back unchanged, as the API requires.
import Anthropic from '@anthropic-ai/sdk';
import type { Message, ModelConfig, ToolCall, Usage } from './model.ts';

const clients = new Map<string, Anthropic>();
const client = (cfg: ModelConfig) => {
  let c = clients.get(cfg.apiKey);
  if (!c) { c = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 3, ...(process.env.ANTHROPIC_TEST_URL ? { baseURL: process.env.ANTHROPIC_TEST_URL } : {}) }); clients.set(cfg.apiKey, c); }
  return c;
};

function toAnthropic(messages: Message[]) {
  let system = '';
  const out: any[] = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    const last = out.at(-1);
    if (last && last.role === role && role === 'user') last.content.push(...blocks); // keep strict alternation
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n\n' : '') + (m.content ?? ''); continue; }
    if (m.role === 'user') { push('user', [{ type: 'text', text: m.content ?? '' }]); continue; }
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
  return { system, messages: out };
}

const toTools = (tools: any[]) => tools.map((t) => ({
  name: t.function.name, description: t.function.description, input_schema: t.function.parameters,
}));

export async function chatAnthropic(cfg: ModelConfig, messages: Message[], tools: unknown[], signal?: AbortSignal, onUsage?: (u: Usage) => void): Promise<Message> {
  const t0 = Date.now();
  const { system, messages: msgs } = toAnthropic(messages);
  const res: any = await client(cfg).beta.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system,
    messages: msgs,
    ...(tools.length ? { tools: toTools(tools as any[]), tool_choice: { type: 'auto' } } : {}),
    output_config: { effort: 'high' }, // agentic coding benefits from deeper thinking
    // If a safety classifier declines, retry on the right fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } as any, { signal });
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
