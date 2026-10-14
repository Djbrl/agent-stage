# agent-stage *(temporary name)*

A lightweight, **visual** coding agent. You give it a task, and instead of reading a wall of text
you **watch it work**: an agent marker moves across a map of your project, files light up as
they are read and edited, and failures show up in red. You can **stop** it, **ask** it
something mid-run, and **approve** every shell command.

It runs on **any open-weight model** behind an OpenAI-compatible API: NVIDIA, Ollama, vLLM,
LM Studio, OpenRouter.

> Open Source × AI Hackathon 2026 (Galsen Dev): track *Productivity & developer tools*.

## Status
Day 1: the agent loop and tools run from the terminal. The visual UI comes next.

## Quick start
Requires Node ≥ 22.18. No dependencies yet.

```bash
cp .env.example .env   # add your key / endpoint
node --env-file=.env src/cli.ts workspace "Create hello.js that prints a greeting, then run it."
```

Ctrl-C stops the agent.

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
