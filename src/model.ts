// One client for every OpenAI-compatible endpoint (NVIDIA, Ollama, vLLM, OpenRouter...).

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  raw?: any[]; // provider-native content (Claude blocks), replayed unchanged to the same provider
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ModelConfig = { baseUrl: string; apiKey: string; model: string; kind?: 'mock' | 'openai' | 'anthropic' | 'claude-code' };
export type Usage = { promptTokens: number; completionTokens: number; ms: number; costUsd?: number };

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
  onUsage?: (u: Usage) => void,
): Promise<Message> {
  const t0 = Date.now();
  if (!cfg.apiKey || cfg.apiKey === 'mock') return mockChat(messages, tools);
  if (cfg.kind === 'anthropic') return (await import('./anthropic.ts')).chatAnthropic(cfg, messages, tools, signal, onUsage);
  // Hosted free tiers rate-limit and hiccup: retry 429/5xx with backoff before giving up.
  let res!: Response;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await request(cfg, messages, tools, signal);
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.usage) onUsage?.({ promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0, ms: Date.now() - t0 });
  return recoverTextToolCalls(data.choices[0].message as Message);
}

function request(cfg: ModelConfig, messages: Message[], tools: unknown[], signal?: AbortSignal) {
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, temperature: 0.2,
      messages: messages.map(({ raw, ...m }) => m),
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

// Web variant (task mentions a page/site/web): build a page, serve it, and check it in the browser.
const PAGE = `<!doctype html>\n<title>Greeter</title>\n<style>body{font:18px system-ui;margin:60px;background:#f6f3ee}input,button{font:inherit;padding:8px 12px}</style>\n<h1>Greeter</h1>\n<form id=f><input id=who placeholder="Your name" autofocus> <button>Greet me</button></form>\n<p id=out></p>\n<script>f.onsubmit=(e)=>{e.preventDefault();out.textContent='Hello, '+(who.value || 'stranger')+'!';}</script>\n`;
const MOCK_WEB: Array<[string, object, string?]> = [
  ['list_files', {}, 'Let me look at what is in the workspace first.'],
  ['write_file', { path: 'index.html', content: PAGE }, 'A single page with a name field and a button is enough.'],
  ['run_command', { command: 'python3 -m http.server 8765', background: true }, 'Serving it locally so I can try it in the browser.'],
  ['browser_open', { url: 'http://localhost:8765' }],
  ['browser_type', { n: 1, text: 'Dakar', submit: true }, 'Typing a name and submitting the form to check it works.'],
];

async function mockChat(messages: Message[], tools: unknown[]): Promise<Message> {
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 700));
  if (!tools.length) {
    const q = (messages.at(-1)?.content ?? '').split('\n\n').pop();
    return { role: 'assistant', content: `(mock answer) You asked: "${q}". A real model would answer from everything it has seen so far in this run.` };
  }
  if (tools.some((t: any) => t.function?.name === 'checkpoint')) return mockLearn(messages);
  if (!tools.some((t: any) => t.function?.name === 'write_file')) {
    // read-only side thread: peek at a file once, then answer
    const q = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (messages.at(-1)?.role === 'user') return { role: 'assistant', content: 'Let me check the code.', tool_calls: [{ id: 'mock-ask', type: 'function', function: { name: 'list_files', arguments: '{}' } }] };
    return { role: 'assistant', content: `(demo answer) You asked: *${q}*\n\n✦ Concept: reading before writing\n\nThis side thread can read the project and everything the agent did, but it can't change anything, so your work thread stays clean.` };
  }
  const done = messages.filter((m) => m.role === 'tool').length;
  const task = messages.find((m) => m.role === 'user')?.content ?? '';
  if (/\b(web|page|site|html|browser)\b/i.test(String(task))) {
    if (done >= MOCK_WEB.length) return { role: 'assistant', content: 'Done. **`index.html`** is a small greeter page, served on http://localhost:8765. I typed *Dakar* into it in the browser and it answered *Hello, Dakar!*' };
    const [name, args, thought] = MOCK_WEB[done];
    return { role: 'assistant', content: thought ?? null, tool_calls: [{ id: `mock-w${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  }
  if (done >= MOCK_SCRIPT.length) return { role: 'assistant', content: 'Done. Here is what changed:\n\n- **`src/greet.js`**: a `greet(name)` function, with a fallback for empty names\n- **`index.js`**: entry point that prints the greeting\n- **`README.md`**: how to run it\n\nRunning `node index.js` prints *Hello, Dakar!*' };
  const [name, args, thought] = MOCK_SCRIPT[done];
  return {
    role: 'assistant',
    content: thought ?? null,
    tool_calls: [{ id: `mock-${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}

// Learn mode demo: explore, ask the learner first, then an implementation checkpoint, then build + report.
function mockLearn(messages: Message[]): Message {
  const users = messages.filter((m) => m.role === 'user').length;
  const sinceUser = messages.slice(messages.findLastIndex((m) => m.role === 'user') + 1);
  const toolsSince = sinceUser.filter((m) => m.role === 'tool');
  const call = (name: string, args: object, content: string | null = null): Message =>
    ({ role: 'assistant', content, tool_calls: [{ id: `mock-${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (users === 1) {
    if (!toolsSince.length) return call('list_files', {}, 'Let me look at the project first.');
    return { role: 'assistant', content: '✦ Build checkpoint: where the greeting logic lives\n\nBefore I write anything: how would **you** split this up? For example, would the greeting text be built in the same file that prints it, or somewhere else?\n\n✦ Concept: module\n\nA module is a file that exports functions other files can import. Splitting code into modules lets you reuse and test pieces separately.' };
  }
  const last = toolsSince.at(-1)?.content ?? '';
  if (!toolsSince.length) return call('checkpoint', {
    kind: 'implementation', title: 'Greeting module + entry point',
    summary: 'Following your idea: `src/greet.js` builds the text, `index.js` only prints it. That keeps the logic testable on its own.',
    additions: [{ detail: 'Empty name', proposal: 'Fall back to "stranger"', why: 'Avoids printing "Hello, !" when no name is given' }],
    files: ['src/greet.js', 'index.js'],
  }, '✦ Why this matters: separation\n\nIf printing and building the text stay apart, you can change one without breaking the other.');
  if (/discuss/i.test(last)) return { role: 'assistant', content: 'Good question. Ask me anything about the plan, and when you are ready, tell me to continue.' };
  if (toolsSince.length === 1) return call('write_file', { path: 'src/greet.js', content: "export function greet(name) {\n  if (!name) return 'Hello, stranger!';\n  return `Hello, ${name}!`;\n}\n" });
  if (toolsSince.length === 2) return call('write_file', { path: 'index.js', content: "import { greet } from './src/greet.js';\n\nconsole.log(greet(process.argv[2]));\n" });
  return { role: 'assistant', content: '✦ Implementation report\n\n- **`src/greet.js`** exports `greet(name)`, with the empty-name fallback we agreed.\n- **`index.js`** imports it and prints the result for the name passed on the command line.\n\nI did not run anything yet. Try `node index.js Dakar`.' };
}
