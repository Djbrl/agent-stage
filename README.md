# agent-stage *(temporary name)*

A lightweight, **visual** coding agent. You give it a task, and instead of reading a wall of text
you **watch it work**: an agent marker moves across a map of your project, files light up as
they are read and edited, and failures show up in red. You can **stop** it, **ask** it
something mid-run, and **approve** every shell command.

It runs on **any open-weight model** behind an OpenAI-compatible API: NVIDIA, Ollama, vLLM,
LM Studio, OpenRouter.

> Open Source × AI Hackathon 2026 (Galsen Dev): track *Productivity & developer tools*.

## The problem
AI coding agents now write real code, but following what they do means reading long text logs
and reviewing a diff at the end. It is hard to see *where* the agent is, catch it going the wrong
way, or trust it with your machine. Most agents are also tied to one proprietary model.

## The solution
agent-stage makes the agent's work **visible and controllable**:
- a **live project map**: your project as circle-packed folders and files; the agent is a marker
  that glides to each file it edits, fresh edits glow orange, failures turn red, and the camera
  follows the work;
- a **status bar**: model, GPU and tunnel health, tokens per second and GPU cost, so you know
  it's ready *before* you send a prompt;
- an **activity log and diff view**: every step with its timing, and exactly what changed;
- **human controls**: Stop, Steer (redirect mid-run), Ask (side question, changes nothing) and
  Approve (every shell command needs your OK);
- **Learn mode**: you design, the agent teaches. It asks for your approach first, explains concepts, and the
  harness *physically blocks* file writes until you approve an Implementation checkpoint (inspired by
  [VibeWise](https://github.com/nykooi1/vibe-wise), MIT);
- **every step explained**: plain-language labels and a "why" for each action, one-line file summaries, and
  "Explain this change" on any diff, from the same model, so free on a self-hosted GPU, in English or French;
- **replay**: rewind any thread and watch the agent walk the project again; a **readmap** shows what it read;
- **Ask** opens a temporary read-only side thread, so questions never disturb the work;
- **engines**: run each thread on agent-stage's own open harness, or on **Claude Code** (Anthropic's agent, via the
  official Agent SDK and your API key). The map, Learn mode and approvals work the same on both;
- **undo**: a git checkpoint before every task (your branch and staging untouched) and an Undo button per task;
- **computer use**: the agent drives your installed Chrome as text (page text + numbered controls), so open
  models can test the web apps they build; screenshots show up on the stage. Local pages are free, other sites
  and "open on my computer" ask first. Long-running dev servers can run in the background;
- **threads per folder**, a first-run tour, and **any model**: Claude, OpenAI, NVIDIA, OpenRouter, Ollama or
  your own GPU with vLLM.

## Status
Working prototype: agent loop hardened for open models, Hono server, live visual UI (project
map, agent marker and trail, activity log, diff view, stop / steer / ask / approve). A **mock model** runs when no key is set, so the UI can be
tried in 10 seconds.

## Quick start
Requires Node ≥ 22.18.

```bash
npm install
npm start            # → http://localhost:3000 (mock model, no key needed)
```

To use a real model, copy `.env.example` to `.env` and fill in the key, then run `npm start` again.
The agent works inside `./workspace`; point it at another folder with `WORKSPACE=/path npm start`.

Self-hosting on a GPU: run `scripts/serve-vllm.sh` on the GPU machine, then set `TUNNEL_HOST`
(the server keeps the SSH tunnel up), and optionally `BREV_INSTANCE` and `GPU_HOURLY_USD` for the
status bar. See `.env.example`.

Terminal-only harness: `npm run agent -- workspace "your task"`.

## Architecture
```
browser (React, web/)  ──HTTP + Server-Sent Events──▶  Hono server (src/server.ts)
                                                          └─ Agent loop (src/agent.ts)
                                                               ├─ model client (src/model.ts) ──▶ any OpenAI-compatible API
                                                               └─ tools (src/tools.ts) ──▶ files + shell, locked to the workspace
```

## Dependencies
`hono`, `@hono/node-server`, `playwright-core` (uses your installed Chrome) (server) · `react`, `react-dom`, `d3-hierarchy`, `vite`, `@vitejs/plugin-react` (UI).

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · how it was made: [docs/HOW-WE-BUILT-IT.md](docs/HOW-WE-BUILT-IT.md)

## How AI is used
The model is the agent. It decides which tool to call (`list_files`, `read_file`, `write_file`,
`edit_file`, `search`, `run_command`), the harness runs the tool inside a sandboxed workspace
folder, and the model gets the result back. That loop repeats until the task is done. The same
model answers **side questions** mid-run from its current context.

AI tools used to build it (Claude Code, Mobbin MCP) are listed in
[docs/HOW-WE-BUILT-IT.md](docs/HOW-WE-BUILT-IT.md).

## Models
| Model | Provider | Role |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA API | default agent model |
| `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` | self-hosted with vLLM on one L40S GPU ([script](scripts/serve-vllm.sh)) | open-weight agent model we develop and demo with |
| any OpenAI-compatible model | Ollama, vLLM, LM Studio, OpenRouter | swap via `.env` |

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## License
MIT
