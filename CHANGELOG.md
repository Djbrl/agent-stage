# Changelog

What changed in each release of Codetandem (called agent-stage until 19 10 2026). Dates are day month year.

## Unreleased

### Added
- **Quiz me** (Learn mode): after a finished step, the tutor asks three short questions about it, one at a time, gives
  feedback on each answer and ends with a score. The scripted demo model plays a quiz too.
- **Lesson notes**: the thread's "⋯" menu downloads a Markdown study sheet built from the session: what you asked, the
  decisions at each checkpoint, the ideas explained, what you learned, the quiz, the files changed, the checks and the
  steps. No model call.
- **Share a session**: the same menu exports the thread as a file. *New thread → Open a shared session…* opens it as a
  read-only replay with the map as it was; it can't run the agent, undo or commit, and gets an empty folder of its own.

- **End-to-end smoke test** (`test/smoke.test.ts`): `npm test` now boots the server on the scripted model in a temp
  home and free port, runs a task through the HTTP API, approves its commands and the done-check, checks the files it
  wrote and that Undo removes them. CI sets a git identity and runs the typecheck, the UI build and all the tests.
- **Community files**: a fuller CONTRIBUTING (mock mode, checks, commit style, contributing with AI agents), the Code
  of Conduct (Contributor Covenant 2.1) with a contact address, bug and idea issue templates, a pull request template,
  and draft *good first issues* in `docs/ISSUES-DRAFT.md`.

### Changed
- **New name: Codetandem.** The app, its tab title, the live demo page, shared session files and the docs now say
  Codetandem, and the favicon and logo are a tandem bike on track orange. The data folder `~/.agent-stage`, the git
  refs, the session format id, the Docker image, the npm package and the repository keep the old name, so existing
  threads, checkpoints, shared files and links keep working.
- **Positioning**: Codetandem is now presented as the coding-agent harness for learners (track *Éducation &
  apprentissage*), with Learn mode as the default. The README leads with the learning features and has a French summary.

### Fixed
- **Links can't lead the file tools out of the project.** A symbolic link inside the project that pointed elsewhere let
  `read_file`, `write_file` and `edit_file` reach its target; search no longer follows links either.
- **Windows:** file paths use `/` everywhere (the map showed `src\greet.js` as a loose file outside its folder, and
  import lines were missing), and `npm run mock` works (npm runs scripts with `cmd.exe` there).
- **Screen readers:** every icon-only button now has a name (Close, Stop the agent, Speak your prompt, the replay and
  map controls…), and toggles say whether they are on.

## 0.1.0 · 18 10 2026

The first release, built in five days for the Open Source × AI Hackathon 2026.

### See the agent work
- **Project map.** Folders and files drawn as circles. The agent's marker moves to each file it reads or edits,
  fresh edits glow, failures show, and the camera follows the work.
- **Plain-language steps.** Every action gets a short label and a "why"; any diff has "Explain this change".
  English or French.
- **Replay** any thread step by step on the map.
- **Studio layout** (the map fills the window, one floating panel with Chat, Steps and Threads) and a classic layout.
- **Light and dark themes**, voice prompting, and a layout that works on a phone.

### Stay in control
- **Approve every shell command** before it runs.
- **Stop** the agent at any time, **steer** it mid-run, or **Ask** a side question that reads a short brief of the
  thread instead of the whole conversation.
- **Undo** puts back only the files a task changed. **Keep** commits them with a message the model writes. Both rely on
  git checkpoints kept under private refs, so your branch and staged files are never touched.
- **Done means checked.** When the agent says it's finished, the harness runs the project's tests (or typecheck, build,
  pytest, cargo, go) and sends failures back, up to three times.
- **Costs in view**: tokens per thread, spend estimates, GPU time, and compact or clear a thread's context on demand.

### Learn while it builds
- **Learn mode** (inspired by [VibeWise](https://github.com/nykooi1/vibe-wise)): you design, the agent teaches. It asks
  for your approach, pushes back on flawed choices, gives hints before full code, and explains new terms in plain words.
- The harness blocks file writes until you approve each step. You can also skip a step.

### Any model
- **Our own agent loop** for open-weight models: Qwen3-Coder on a self-hosted GPU, NVIDIA, Ollama, OpenRouter, any
  OpenAI-compatible API, and the Claude API. It is hardened for open models: retries, recovery of tool calls written as
  text, a repeat guard and a context budget.
- **The Claude Code engine** through the Claude Agent SDK, with the same map, approvals and Learn mode.
- **One-click GPU** on Brev with vLLM: create, load the model, auto-stop when idle, destroy on stop.
- **Computer use**: the agent drives your Chrome as text (page text plus numbered controls), so open models can test the
  web apps they build.

### Online demo
- `npm run public` puts Codetandem online from your own computer. Each visitor gets a private, sealed Docker sandbox:
  no access to your computer or home network, the model key stays with the manager, a spending cap per sandbox,
  disk and idle limits, and an invite code by default.

### Quality
- 29 tests with Node's built-in runner (the file tools, the done-check, git checkpoints, the demo's network filter), a
  typecheck for the server and the UI, and GitHub Actions running both plus the UI build on every push.
- The tests found and fixed two bugs: a valid file name like `..notes.md` was refused, and the demo's internet proxy
  let IPv6 written the long way (`0:0:0:0:0:0:0:1`) reach its own loopback.
