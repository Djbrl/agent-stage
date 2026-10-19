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
  ['write_file', { path: 'package.json', content: '{\n  "name": "greeter",\n  "type": "module",\n  "scripts": { "test": "node test.js" }\n}\n' }],
  ['write_file', { path: 'test.js', content: "import assert from 'node:assert';\nimport { greet } from './src/greet.js';\n\nassert.equal(greet('dakar'), 'Hello, Dakar!');\nassert.equal(greet(''), 'Hello, stranger!');\nconsole.log('2 tests passed');\n" }, 'Writing a small test first, so the harness can check the result.'],
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
  if (tools.some((t: any) => t.function?.name === 'checkpoint')) return mockLearn(messages, /in French/.test(String(messages[0]?.content ?? '')));
  if (!tools.some((t: any) => t.function?.name === 'write_file')) {
    // read-only side thread: peek at a file once, then answer
    const q = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (messages.at(-1)?.role === 'user') return { role: 'assistant', content: 'Let me check the code.', tool_calls: [{ id: 'mock-ask', type: 'function', function: { name: 'list_files', arguments: '{}' } }] };
    const ask = String(q).split('\n\n').pop();
    if (/in French/.test(String(messages[0]?.content ?? ''))) return { role: 'assistant', content: `(réponse de démo) Tu as demandé : *${ask}*\n\n✦ Concept: lire avant d’écrire\n\nCette question à part lit le projet et ce que l’agent a fait, mais ne change rien : ta session principale reste propre.` };
    return { role: 'assistant', content: `(demo answer) You asked: *${ask}*\n\n✦ Concept: reading before writing\n\nThis side question can read the project and everything the agent did, but it can't change anything, so your main session stays clean.` };
  }
  // The harness's done-check failed: fix it (the scripted bug is a lower-case name).
  const lastMsg = messages.at(-1);
  if (lastMsg?.role === 'user' && String(lastMsg.content).startsWith('The harness ran') && !messages.some((m) => m.tool_calls?.some((c) => c.id === 'mock-fix')))
    return { role: 'assistant', content: 'The test caught it: names should be capitalised. Fixing greet().', tool_calls: [{ id: 'mock-fix', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'src/greet.js', old: '  return `Hello, ${name}!`;', new: '  return `Hello, ${name[0].toUpperCase()}${name.slice(1)}!`;' }) } }] };
  if (lastMsg?.role === 'tool' && lastMsg.tool_call_id === 'mock-fix') return { role: 'assistant', content: 'Fixed: `greet()` now capitalises the name. The test should pass.' };
  const done = messages.filter((m) => m.role === 'tool' && m.tool_call_id !== 'mock-fix').length;
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
// In French when the learner picked French (the system prompt says so), like a real model would.
function mockLearn(messages: Message[], fr = false): Message {
  const t = (en: string, frText: string) => (fr ? frText : en);
  const users = messages.filter((m) => m.role === 'user').length;
  const sinceUser = messages.slice(messages.findLastIndex((m) => m.role === 'user') + 1);
  const toolsSince = sinceUser.filter((m) => m.role === 'tool');
  const call = (name: string, args: object, content: string | null = null): Message =>
    ({ role: 'assistant', content, tool_calls: [{ id: `mock-${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  // "Quiz me": three questions, one per turn, each answer gets feedback.
  const quiz = messages.findLastIndex((m) => m.role === 'user' && String(m.content).includes(QUIZ_START));
  const Q = fr ? MOCK_QUIZ_FR : MOCK_QUIZ, F = fr ? MOCK_QUIZ_FEEDBACK_FR : MOCK_QUIZ_FEEDBACK;
  if (quiz >= 0) {
    const answered = messages.slice(quiz + 1).filter((m) => m.role === 'user').length;
    if (answered < Q.length) return { role: 'assistant', content: `${answered ? F[answered - 1] + '\n\n' : ''}**${t(`Question ${answered + 1} of 3.`, `Question ${answered + 1} sur 3.`)}** ${Q[answered]}` };
    return { role: 'assistant', content: `${F[2]}\n\n${t('**Score: 3 / 3** for effort: a real model checks each answer against what we built.\n\n✦ What you learned:\n- A module is a file other files import from\n- Keeping logic apart from printing makes it testable',
      '**Score : 3 / 3** pour l’effort : un vrai modèle vérifie chaque réponse par rapport à ce qu’on a construit.\n\n✦ What you learned:\n- Un module est un fichier dont d’autres fichiers importent du code\n- Séparer la logique de l’affichage la rend testable')}` };
  }
  if (users === 1) {
    if (!toolsSince.length) return call('list_files', {}, t('Let me look at the project first.', 'Je regarde d’abord le projet.'));
    return { role: 'assistant', content: t('✦ Build checkpoint: where the greeting logic lives\n\nBefore I write anything: how would **you** split this up? For example, would the greeting text be built in the same file that prints it, or somewhere else?\n\n✦ Concept: module\n\nA module is a file that exports functions other files can import. Splitting code into modules lets you reuse and test pieces separately.',
      '✦ Build checkpoint: où vit la logique du message\n\nAvant d’écrire quoi que ce soit : comment **tu** découperais ça ? Par exemple, le texte du message serait-il construit dans le même fichier que celui qui l’affiche, ou ailleurs ?\n\n✦ Concept: module\n\nUn module est un fichier qui exporte des fonctions que d’autres fichiers peuvent importer. Découper le code en modules permet de réutiliser et de tester chaque morceau séparément.') };
  }
  const last = toolsSince.at(-1)?.content ?? '';
  if (!toolsSince.length) return call('checkpoint', {
    kind: 'implementation', title: t('Greeting module + entry point', 'Module de salutation + point d’entrée'),
    summary: t('Following your idea: `src/greet.js` builds the text, `index.js` only prints it. That keeps the logic testable on its own.', 'Selon ton idée : `src/greet.js` construit le texte, `index.js` ne fait que l’afficher. La logique reste testable toute seule.'),
    additions: [{ detail: t('Empty name', 'Nom vide'), proposal: t('Fall back to "stranger"', 'Utiliser « stranger » par défaut'), why: t('Avoids printing "Hello, !" when no name is given', 'Évite d’afficher « Hello, ! » quand aucun nom n’est donné') }],
    files: ['src/greet.js', 'index.js'],
  }, t('✦ Why this matters: separation\n\nIf printing and building the text stay apart, you can change one without breaking the other.', '✦ Why this matters: la séparation\n\nSi l’affichage et la construction du texte restent séparés, tu peux changer l’un sans casser l’autre.'));
  if (/discuss/i.test(last)) return { role: 'assistant', content: t('Good question. Ask me anything about the plan, and when you are ready, tell me to continue.', 'Bonne question. Demande-moi ce que tu veux sur le plan, et quand tu es prêt, dis-moi de continuer.') };
  if (toolsSince.length === 1) return call('write_file', { path: 'src/greet.js', content: "export function greet(name) {\n  if (!name) return 'Hello, stranger!';\n  return `Hello, ${name}!`;\n}\n" });
  if (toolsSince.length === 2) return call('write_file', { path: 'index.js', content: "import { greet } from './src/greet.js';\n\nconsole.log(greet(process.argv[2]));\n" });
  return { role: 'assistant', content: t('✦ Implementation report\n\n- **`src/greet.js`** exports `greet(name)`, with the empty-name fallback we agreed.\n- **`index.js`** imports it and prints the result for the name passed on the command line.\n\nI did not run anything yet. Try `node index.js Dakar`.\n\n✦ What you learned:\n- A module exports functions that other files import\n- A fallback value handles input you did not expect',
    '✦ Implementation report\n\n- **`src/greet.js`** exporte `greet(name)`, avec la valeur par défaut pour un nom vide qu’on a choisie.\n- **`index.js`** l’importe et affiche le résultat pour le nom passé en ligne de commande.\n\nJe n’ai encore rien lancé. Essaie `node index.js Dakar`.\n\n✦ What you learned:\n- Un module exporte des fonctions que d’autres fichiers importent\n- Une valeur par défaut gère une entrée inattendue') };
}

// Sent by the "Quiz me" button (web/src/AgentPanel.tsx sends the same text).
export const QUIZ_START = 'Quiz me on what we just did';
const MOCK_QUIZ = [
  'Why does `greet()` live in `src/greet.js` instead of in `index.js`?',
  'What does `greet(\'\')` return, and why did we add that case?',
  'If you wanted to test `greet()` without printing anything, which file would you import?',
];
const MOCK_QUIZ_FEEDBACK = [
  '(demo) A real model would check your answer here. The idea: keeping the logic in its own module lets other files and tests reuse it.',
  '(demo) It returns *Hello, stranger!*: the fallback avoids printing *Hello, !* when no name is given.',
  '(demo) `src/greet.js`: the module that holds the logic, so a test can call it directly.',
];
const MOCK_QUIZ_FR = [
  'Pourquoi `greet()` est dans `src/greet.js` plutôt que dans `index.js` ?',
  'Que renvoie `greet(\'\')`, et pourquoi a-t-on ajouté ce cas ?',
  'Pour tester `greet()` sans rien afficher, quel fichier importerais-tu ?',
];
const MOCK_QUIZ_FEEDBACK_FR = [
  '(démo) Un vrai modèle vérifierait ta réponse ici. L’idée : garder la logique dans son propre module permet à d’autres fichiers et aux tests de la réutiliser.',
  '(démo) Elle renvoie *Hello, stranger!* : la valeur par défaut évite d’afficher *Hello, !* quand aucun nom n’est donné.',
  '(démo) `src/greet.js` : le module qui contient la logique, pour qu’un test puisse l’appeler directement.',
];
