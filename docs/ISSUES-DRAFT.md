# Good first issues (draft)

Candidates for newcomers, ready to paste into GitHub. Suggested labels: `good first issue` plus the one in brackets.
Each one can be done without a GPU or a paid key: `npm run mock` runs the app on the scripted model.

---

## 1. Ollama setup guide for offline and classroom use  [documentation]
Tandemcode already ships an "Ollama (this computer)" preset (`qwen3-coder:30b` on `http://localhost:11434/v1`), but
there is no guide. Write `docs/OLLAMA.md`: installing Ollama, which models fit 8 / 16 / 32 GB of RAM (and how slow they
are), pulling one, picking it in Settings → Models, and what to expect from a small model in Learn mode. Add a section
for a school lab: one machine serving Ollama on the local network for a whole class, with no API bill. Link it from the
README's Models table.

## 2. Translate the interface into French  [i18n]
The model's step labels, explanations and Learn-mode teaching already follow Settings → Learn → Language, but the
interface itself (buttons, tabs, empty states, the approval card) is English only. Add a small string table
(`web/src/i18n.ts`, no new dependency) with English and French, and switch the most visible screens first: the composer,
the Chat / Steps / Threads tabs and the approval and checkpoint cards. Keep the words short and plain. Follow-up issues
can cover the rest.

## 3. Wolof voice input  [enhancement]
Voice prompting (`web/src/voice.ts`) uses the browser's speech recognition, which has no Wolof. Investigate an
open-weight speech model that handles Wolof (for example a Whisper fine-tune) running locally or on our GPU, and write
down the findings in the issue: quality, speed, size, licence. A first PR can add a "speech server" setting that sends
the recording to an OpenAI-compatible `/audio/transcriptions` endpoint, so any such model can be plugged in.

## 4. A new sample project for learners  [samples]
The online demo offers two starting projects in `public/samples` (`todo-app`, `stats-py`). Add a third that is a good
first lesson in another area, such as a small HTML + CSS + JS quiz page, a command-line game in Python, or a tiny REST
API in Node with one test. Keep it under ~150 lines, give it a README that suggests two or three tasks to try in Learn
mode, and include a test so the done-check has something to run.

## 5. A keyboard shortcuts help panel  [ux]
The app has a few shortcuts (Escape closes modals and popovers, the key handlers in `web/src/App.tsx`) but nothing lists
them. Add a small panel opened with `?` (and from a button in the panel header) that lists every shortcut in plain
words. Check that it does not fire while the user is typing in the composer, and that Escape closes it.

## 6. Accessibility checks of the project map  [accessibility]
The map (`web/src/MapCanvas.tsx`) is a canvas, so screen readers see nothing in it. Audit it with VoiceOver or NVDA and
keyboard only, and write down what is missing. A first fix: a visually hidden live region that announces the agent's
moves ("Reading src/greet.js", "Edited index.js"), and a text list of files that can be reached by Tab. Check colour
contrast of the map labels in both themes.

## 7. A French README  [documentation, i18n]
Many of the learners we want to reach in Senegal and elsewhere read French first. Write `README.fr.md`: a faithful,
plain-French version of the README (the problem, how Learn mode works, quick start, models), not a word-for-word
machine translation. Link the two files to each other at the top, and keep code blocks and commands unchanged. Note in
CONTRIBUTING that README changes should be mirrored.

## 8. A Codex engine  [engine]
`/api/engines` already lists `codex` as "Coming soon". Following `src/claudecode.ts` (the Claude Code engine), add an
engine that drives OpenAI's open-source Codex CLI and maps its events to ours (`tool_start`, `tool_end`,
`file_change`, `approval`, `done`), so the map, approvals and Undo work the same. Start with Build mode only, and
document what does not work yet. This one is bigger: comment on the issue first so we can agree on the approach.
