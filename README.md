# agent-stage *(temporary name)*

[![CI](https://github.com/Djbrl/agent-stage/actions/workflows/ci.yml/badge.svg)](https://github.com/Djbrl/agent-stage/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Djbrl/agent-stage)](https://github.com/Djbrl/agent-stage/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node ≥ 22.18](https://img.shields.io/badge/node-%E2%89%A5%2022.18-brightgreen)](https://nodejs.org)

A lightweight, **visual** coding agent. You give it a task, and instead of reading a wall of text
you **watch it work**: an agent marker moves across a map of your project, files light up as
they are read and edited, and failures show up in red. You can **stop** it, **ask** it
something mid-run, and **approve** every shell command.

It runs on **open-weight models** (our own GPU with Qwen3-Coder, NVIDIA, Ollama, OpenRouter) through its own
agent loop, or on **Claude**: the Anthropic API in the same loop, or Anthropic's Claude Code agent. And it has a
**Learn mode** for people learning to code: you design, the agent teaches, and it can't touch a file until you approve.

> Open Source × AI Hackathon 2026 (Galsen Dev): track *Productivity & developer tools*.

![A finished run: the files the agent changed are lit on the map; the harness ran the tests, sent a failure back, and the agent fixed it](docs/screenshots/studio-light.png)

<!-- Demo video (≤ 3 min): add the link here before submitting. -->

## The problem
AI coding agents now write real code, but following what they do means reading long text logs
and reviewing a diff at the end. It is hard to see *where* the agent is, catch it going the wrong
way, or trust it with your machine. Most agents are also tied to one proprietary model.

## The solution
agent-stage makes the agent's work **visible, controllable and teachable**.

**See it work**
- **A live project map.** Folders and files are circles. The agent is a marker that moves to each file it reads or
  edits. Fresh edits glow, failures show, and the camera follows the work.
- **Plain-language steps.** Every action gets a short label and a "why". Any diff has "Explain this change".
  This works in English or French.
- **Replay** any thread and watch the agent walk the project again.

**Stay in control**
- **Approve** every shell command.
- **Stop** the agent at any time, or **steer** it mid-run.
- **Ask** a side question without interrupting. Ask reads a short brief of the thread, so it stays cheap.
- **Undo** puts back only the files a task changed. **Keep** commits them with a message the model writes.
- **Done means checked.** When the agent says it's finished, the harness runs the project's tests. A failure goes
  back to the agent ("not done yet"). A missing test tool is reported, not blamed on the agent.

**Learn while it builds**
- **You design, the agent teaches.**
  - It asks how *you* would do it, pushes back on a flawed choice, and gives hints before full code.
  - It explains each new term in plain words and ends with "What you learned".
  - The harness blocks file writes until you approve the step. You can also skip a step. Learn mode is inspired by
    [VibeWise](https://github.com/nykooi1/vibe-wise) (MIT).

**Practical**
- **Any model.** Our own GPU (one-click Brev + vLLM, auto-stop), NVIDIA, Ollama, OpenRouter, the Claude API, or the
  Claude Code engine. The map, Learn mode and approvals work the same on all of them.
- **Costs in view.** Tokens per thread, spend estimates, GPU time, and compact or clear a thread's context on demand.
- **Computer use.** The agent drives your Chrome as text (page text plus numbered controls), so open models can test
  the web apps they build.
- **Comfort.** Light and dark themes, voice prompting, works on a phone.
- **Live online demo.** Each visitor gets a private, sealed Docker sandbox ([docs/PUBLIC-DEMO.md](docs/PUBLIC-DEMO.md)).

![Mid-run, dark theme: the agent marker on the file it is editing](docs/screenshots/studio-dark.png)

## Status
Working and tested end to end:
- the scripted demo model;
- Qwen3-Coder on our GPU, locally and through the online demo;
- the Claude API and the Claude Code engine with a real key;
- Undo and Keep, the done-check, the browser tools, and the sandbox isolation.

Without a key the app runs a scripted demo model, so you can try it in 10 seconds.

## Quick start
Requires Node ≥ 22.18.

```bash
npm install
npm start            # → http://localhost:3000 (mock model, no key needed)
```

To use a real model, open Settings → Models in the app and add its key there. For Claude you can
instead put `ANTHROPIC_API_KEY` in a `.env` file (copy `.env.example`) and restart. Settings also has the
one-click GPU (Brev + vLLM).
The agent works inside `./workspace`; point it at another folder with `WORKSPACE=/path npm start`.

Self-hosting on your own GPU machine instead: run `scripts/serve-vllm.sh` on it, then set `TUNNEL_HOST`
(the server keeps the SSH tunnel up), and optionally `BREV_INSTANCE` and `GPU_HOURLY_USD` for the
status bar. See `.env.example`, which also explains when the server reads `.env`.

Terminal-only harness: `npm run agent -- workspace "your task"`.

## Architecture
```
browser (React, web/)  ──HTTP + Server-Sent Events──▶  Hono server (src/server.ts)
                                                          ├─ our agent loop (src/agent.ts)
                                                          │    ├─ model clients ──▶ OpenAI-compatible APIs (src/model.ts), Claude (src/anthropic.ts)
                                                          │    └─ tools (src/tools.ts, src/browser.ts) ──▶ files, shell, Chrome; locked to the project
                                                          ├─ Claude Code engine (src/claudecode.ts, Agent SDK)
                                                          └─ done-check (src/verify.ts) · git checkpoints (src/git.ts)
```

## Dependencies
Server: `hono`, `@hono/node-server`, `playwright-core` (drives your installed Chrome), `@anthropic-ai/sdk`,
`@anthropic-ai/claude-agent-sdk`, `zod`. UI: `react`, `react-dom`, `d3-hierarchy`, `vite`, `@vitejs/plugin-react`. Checks: `typescript` (type checking only).
Node 24 runs the TypeScript directly; there is no build step for the server. Tests use Node's built-in runner:
`npm test`, and `npm run typecheck`. GitHub Actions runs both, plus the UI build, on every push.

Live demo from your own computer, one private sandbox per visitor: `npm run public` ([docs/PUBLIC-DEMO.md](docs/PUBLIC-DEMO.md)).

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · how it was made: [docs/HOW-WE-BUILT-IT.md](docs/HOW-WE-BUILT-IT.md)

## How AI is used
The model is the agent. It decides which tool to call (`list_files`, `read_file`, `write_file`, `edit_file`, `search`,
`run_command`, the browser tools), the harness runs it inside the project folder, and the model gets the result back,
until the task is done. The harness keeps the model honest: it checks "done" by running the tests, enforces the Learn
write lock, and refuses a checkpoint until the learner's question got a visible answer.

The same model also writes the plain-language step labels, file summaries, "Explain this change", commit messages
for Keep, and the summary when you compact a thread. On your own GPU all of that is free.

AI tools used to build it (Claude Code, Mobbin MCP) are listed in
[docs/HOW-WE-BUILT-IT.md](docs/HOW-WE-BUILT-IT.md).

## Models
| Model | Provider | Role |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA API | default agent model |
| `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` | self-hosted with vLLM on one L40S GPU ([script](scripts/serve-vllm.sh)) | open-weight agent model we develop and demo with |
| `claude-opus-5-5`, `claude-sonnet-5-5` | Anthropic API, in our loop or through the Claude Code engine | strongest results; cost shown in Usage |
| any OpenAI-compatible model | Ollama, vLLM, LM Studio, OpenRouter | add it in Settings → Models |

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security problem? Please
report it privately, as explained in [SECURITY.md](SECURITY.md). Changes per release: [CHANGELOG.md](CHANGELOG.md).

## License
MIT
