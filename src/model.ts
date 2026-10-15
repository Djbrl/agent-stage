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
  if (!cfg.apiKey || cfg.apiKey === 'mock') return mockChat(messages);
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`model ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message as Message;
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

async function mockChat(messages: Message[]): Promise<Message> {
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 700));
  const done = messages.filter((m) => m.role === 'tool').length;
  if (done >= MOCK_SCRIPT.length) return { role: 'assistant', content: 'Done. Created a greeting module with an entry point and a README, handled empty names, and ran it: it prints "Hello, Dakar!".' };
  const [name, args, thought] = MOCK_SCRIPT[done];
  return {
    role: 'assistant',
    content: thought ?? null,
    tool_calls: [{ id: `mock-${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}
