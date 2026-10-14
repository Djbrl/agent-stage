# agent-stage *(temporary name)*

A lightweight, **visual** coding agent. You give it a task, and instead of reading a wall of text
you **watch it work**: an agent marker moves across a map of your project, files light up as
they are read and edited, and failures show up in red. You can **stop** it, **ask** it
something mid-run, and **approve** every shell command.

It runs on **any open-weight model** behind an OpenAI-compatible API: NVIDIA, Ollama, vLLM,
LM Studio, OpenRouter.

> Open Source × AI Hackathon 2026 (Galsen Dev): track *Productivity & developer tools*.

## Status
Working prototype: agent loop, Hono server, live visual UI (project map, moving agent marker,
red errors, stop / ask / approve). A **mock model** runs when no key is set, so the UI can be
tried in 10 seconds.

## Quick start
Requires Node ≥ 22.18.

```bash
npm install
npm start            # → http://localhost:3000 (mock model, no key needed)
```

To use a real model, copy `.env.example` to `.env` and fill in the key, then run `npm start` again.
The agent works inside `./workspace`; point it at another folder with `WORKSPACE=/path npm start`.

Terminal-only harness: `npm run agent -- workspace "your task"`.

## Architecture
```
browser (React, web/)  ──HTTP + Server-Sent Events──▶  Hono server (src/server.ts)
                                                          └─ Agent loop (src/agent.ts)
                                                               ├─ model client (src/model.ts) ──▶ any OpenAI-compatible API
                                                               └─ tools (src/tools.ts) ──▶ files + shell, locked to the workspace
```

## Dependencies
`hono`, `@hono/node-server` (server) · `react`, `react-dom`, `vite`, `@vitejs/plugin-react` (UI).

## How AI is used
The model is the agent. It decides which tool to call (`list_files`, `read_file`, `write_file`,
`edit_file`, `search`, `run_command`), the harness runs the tool inside a sandboxed workspace
folder, and the model gets the result back. That loop repeats until the task is done.

## Models
| Model | Provider | Role |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA API | default agent model |

## License
MIT
