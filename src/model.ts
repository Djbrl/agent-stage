// One client for every OpenAI-compatible endpoint (NVIDIA, Ollama, vLLM, OpenRouter...).

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ModelConfig = { baseUrl: string; apiKey: string; model: string };

export function configFromEnv(): ModelConfig {
  const baseUrl = process.env.MODEL_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
  const apiKey = process.env.MODEL_API_KEY ?? '';
  const model = process.env.MODEL_NAME ?? 'nvidia/nemotron-3-super-120b-a12b';
  return { baseUrl, apiKey, model };
}

export async function chat(
  cfg: ModelConfig,
  messages: Message[],
  tools: unknown[],
  signal?: AbortSignal,
): Promise<Message> {
  if (!cfg.apiKey || cfg.apiKey === 'mock') return mockChat(messages, tools.length > 0);
  // Hosted free tiers rate-limit and hiccup: retry 429/5xx with backoff before giving up.
  let res!: Response;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await request(cfg, messages, tools, signal);
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return recoverTextToolCalls(data.choices[0].message as Message);
}

function request(cfg: ModelConfig, messages: Message[], tools: unknown[], signal?: AbortSignal) {
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, messages, temperature: 0.2,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    }),
  });
}

// Some open models write tool calls into the text (<tool_call>{...}</tool_call>) instead of the
// tool_calls field. Lift them out so the loop treats them like real calls.
function recoverTextToolCalls(msg: Message): Message {
  if (msg.tool_calls?.length || !msg.content) return msg;
  const found = [...msg.content.matchAll(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g)];
  const calls: ToolCall[] = [];
  for (const [, json] of found) {
    try {
      const { name, arguments: args } = JSON.parse(json);
      if (typeof name === 'string') calls.push({
        id: `text-${crypto.randomUUID()}`, type: 'function',
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
      });
    } catch { /* not a tool call after all */ }
  }
  if (!calls.length) return msg;
  const content = msg.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() || null;
  return { ...msg, content, tool_calls: calls };
}

// Scripted fake model: lets the UI be tested and demoed with no key. MODEL_API_KEY=mock (or empty).
const MOCK_SCRIPT: Array<[string, object, string?]> = [
  ['list_files', {}, 'Let me look at what is in the workspace first.'],
  ['write_file', { path: 'package.json', content: '{\n  "name": "greeter",\n  "type": "module"\n}\n' }],
  ['write_file', { path: 'src/greet.js', content: 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n' }, 'Empty project. I will create a small greeting module and an entry point.'],
  ['write_file', { path: 'src/format.js', content: 'export const shout = (s) => s.toUpperCase();\n' }],
  ['write_file', { path: 'index.js', content: "import { greet } from './src/greet.js';\n\nconsole.log(greet('Dakar'));\n" }],
  ['read_file', { path: 'README.md' }, 'Checking whether a README exists to document this.'],
  ['write_file', { path: 'README.md', content: '# greeter\n\nRun `node index.js`.\n' }, 'No README yet, so I will add one.'],
  ['edit_file', { path: 'src/greet.js', old: '  return `Hello, ${name}!`;', new: "  if (!name) return 'Hello, stranger!';\n  return `Hello, ${name}!`;" }, 'Handling the empty-name case before running it.'],
  ['search', { text: 'greet(' }],
  ['run_command', { command: 'node index.js' }, 'Everything is in place. Running it to check.'],
];

async function mockChat(messages: Message[], withTools: boolean): Promise<Message> {
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 700));
  if (!withTools) {
    const q = (messages.at(-1)?.content ?? '').split('\n\n').pop();
    return { role: 'assistant', content: `(mock answer) You asked: "${q}". A real model would answer from everything it has seen so far in this run.` };
  }
  const done = messages.filter((m) => m.role === 'tool').length;
  if (done >= MOCK_SCRIPT.length) return { role: 'assistant', content: 'Done. Created a greeting module with an entry point and a README, handled empty names, and ran it: it prints "Hello, Dakar!".' };
  const [name, args, thought] = MOCK_SCRIPT[done];
  return {
    role: 'assistant',
    content: thought ?? null,
    tool_calls: [{ id: `mock-${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}
