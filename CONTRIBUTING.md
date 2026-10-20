# Contributing

Thanks for helping. Tandemcode is a coding-agent harness for people who want to keep learning while an AI agent codes
with them. It is small on purpose, so please keep changes focused. Contributions in English or French are both welcome.

New here? Look for issues labelled **good first issue**. The draft list is in [docs/ISSUES-DRAFT.md](docs/ISSUES-DRAFT.md).

## Run it
Requires Node ≥ 22.18 (CI uses Node 24) and git.

```bash
npm install
npm run mock       # http://localhost:3000 on the scripted model: no key, GPU or network needed
npm start          # the same with real models (add one in Settings → Models)
```

**Mock mode** (`npm run mock`, or `MODEL_API_KEY=mock`) replaces the model with a short script: it builds a tiny
greeter project, plants a bug, lets the done-check catch it and fixes it. Mention "page" or "web" in the task for the
browser variant; Learn mode has its own script with checkpoints and a quiz. Use it for any UI or harness change, and
use a real model only when the change depends on how models behave.

For UI work with hot reload, run `npm run dev` (server) and `npm run web` (Vite on :5173) side by side.

Your threads and settings live in `~/.agent-stage/`. Set `AGENT_STAGE_HOME=/some/tmp/dir` to try things without
touching them.

## Where things are
- [AGENTS.md](AGENTS.md): the handoff, with a table of every server file and the main UI files. Read it first.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the agent loop, events, map and engines fit together.
- `src/` is the server (Hono, Node runs the TypeScript directly), `web/src/` is the UI (React 19, Vite), `test/` the tests,
  `public/` the online demo.

## Checks
```bash
npm test           # node:test: unit tests plus an end-to-end run of the scripted model through the API (~20 s)
npm run typecheck  # tsc for the server and the UI
npm run build      # the UI bundle
```
CI (GitHub Actions) runs all three on every push and pull request. Tests use Node's built-in runner, so there is nothing
extra to install. A change to the tools, the done-check, git checkpoints, sessions or the demo's network filter should
come with a test.

## Ground rules
- **Node runs the server's TypeScript directly** (type stripping). Don't use parameter properties, `enum` or `namespace`
  in `src/`. `npm run typecheck` catches them.
- **Keep dependencies minimal.** Open an issue before adding one.
- **Safety first.** Tools must stay inside the project folder, and anything that executes code must go through
  `approve()`.
- **Plain words** in anything a user reads: short labels, no jargon, explain a term the first time it appears.
  The audience is people who are still learning.
- New tools need: a schema in `toolSchemas`, a case in `runTool`, an icon and label in the UI, and a line in
  `docs/ARCHITECTURE.md`.

## Proposing a change
1. For anything bigger than a small fix, open an issue first (bug or idea template) so we can agree on the approach.
2. Fork, create a branch, make the change, and run the checks above plus a mock run in the browser.
3. Open a pull request: one topic per PR, a short description of *why*, and a screenshot or GIF for UI changes.
   The PR template has a short checklist.

## Commit style
Look at `git log` for examples. One change per commit, with a subject that says what the user gets, in plain words:

```
Keep: after a task, commit just the files it changed, with a message the model writes
Map: hide generated folders and files (__pycache__, build output, venvs, .pyc, source maps)
Fixes from the button sweep: Escape and outside clicks close modals and popovers, …
```

An area prefix (`Map:`, `Learn:`, `Chat:`, `Online demo:`, `CI:`, `Docs:`) helps when the change has a clear home.
Dates in prose are written DD MM YYYY.

## Using AI agents to contribute
Most of Tandemcode was written with AI coding agents (Claude Code, and Tandemcode itself), with a human deciding
what to build, reviewing each change and testing it in a real browser. [docs/HOW-WE-BUILT-IT.md](docs/HOW-WE-BUILT-IT.md)
tells the story. You are welcome to work the same way, on these terms:
- **You own what you submit.** Read every line, and be able to explain it in the review.
- **Say so in the PR** (the template has a box), and name the tool and model.
- **Run the checks yourself** and try the change in the browser; don't trust an agent's "done".
- `AGENTS.md` (and `CLAUDE.md`, which points to it) is written for agents: point yours at it first.
- Using Tandemcode in Learn mode on Tandemcode itself is a good way to learn the codebase.

## Reporting bugs
Use the bug template. Include the model and provider you used: most agent bugs are model-specific.
Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Code of Conduct
Everyone taking part follows our [Code of Conduct](CODE_OF_CONDUCT.md).
