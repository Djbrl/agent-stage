# Architecture

agent-stage is three small pieces running on your machine. The only thing that leaves it is the
request to the model provider you configure.

```
┌──────────── browser ────────────┐        ┌──────────────── Node process ────────────────┐
│  React UI (web/)                │  HTTP  │  Hono server (src/server.ts)                  │
│  · project map + agent marker   │ ─────▶ │   POST /api/task  /steer  /ask  /stop  /approve│
│  · activity log + diff view     │ ◀───── │   GET  /api/events  (Server-Sent Events)      │
│  · agent panel + composer       │  SSE   │        │                                      │
└─────────────────────────────────┘        │        ▼                                      │
                                           │  Agent loop (src/agent.ts)                    │
                                           │   ├─ model client (src/model.ts) ─────────────┼──▶ OpenAI-compatible API
                                           │   └─ tools (src/tools.ts) ──▶ workspace folder │     (NVIDIA, Ollama, vLLM…)
                                           └───────────────────────────────────────────────┘
```

## The agent loop
1. Send the conversation plus the list of tools to the model.
2. The model either answers in plain text (the task is finished) or asks for tool calls.
3. The harness runs each tool inside the workspace and appends the result to the conversation.
4. Repeat, up to a step limit.

The model never touches the disk. It only *asks*, and the harness decides what actually runs.

## Tools
| Tool | What it does | Safety |
|---|---|---|
| `list_files` | lists the workspace | skips dotfiles and `node_modules` |
| `read_file` | reads a file | path must stay inside the workspace |
| `write_file` | creates or overwrites a file | same; emits a diff |
| `edit_file` | replaces one exact string | same; emits a diff |
| `search` | finds lines containing text | capped at 50 hits |
| `run_command` | runs a shell command | **requires human approval in the UI**, 60 s timeout |

## Events
Everything the UI shows comes from one stream of events: `user`, `thinking`, `tool_start`,
`tool_end`, `file_change`, `approval`, `question`, `answer`, `done`, `error`. Each has a
timestamp. Late-joining browsers get the full history replayed, so a refresh never loses the run.

## Human control
- **Stop** aborts the in-flight model request and denies any pending approval.
- **Steer** (Enter while running) queues a message the agent reads before its next step.
- **Ask** is a side question, answered immediately from the current context with no tools. The
  main run is not modified.
- **Approve / Deny** gates every shell command.

## Working with open-weight models
Open models are less consistent at tool calling than frontier APIs, so the loop is defensive:
- retries rate limits and 5xx errors with exponential backoff;
- recovers tool calls a model writes into its text (`<tool_call>{…}</tool_call>`);
- feeds invalid JSON arguments back as an error so the model can correct itself;
- detects the same call repeated 3 times and nudges the model to change approach.

## The project map
`GET /api/map` returns every workspace file with its line count, plus relative imports
(JS/TS/Python) as edges. The UI (`web/src/MapCanvas.tsx`) draws it on one canvas:
- **Layout**: the folder tree is circle-packed (`d3-hierarchy`). Folders are circles, files are
  dots sized by line count, and single-child folders are merged (`web/src`). It's deterministic,
  so nothing jitters, and new files glide into place.
- **Colour = recency**: hot orange for a fresh edit, fading to warm over 5 minutes, then cool grey
  for untouched. Read files are blue, failures red. Each edit gives one ripple.
- **Agent marker**: sits on the last file written, or on the *terminal* / *scan & search*
  islands. It glides between them, leaves a fading trail through recent writes, and draws a
  dotted line of sight to files it reads. Its ring shows state: breathing = thinking,
  amber = waiting for your approval, red pulse = a step failed.
- **Camera**: wheel to zoom, drag to pan. It follows the agent but only moves when the marker
  leaves the middle 60% of the view. Any manual move hands you control; **F** or 60 s idle
  gives it back. **0** fits the whole project.
- **Hover** a file to see its imports (blue) and the files that import it (green).

## Status and cost
`GET /api/health` (polled every 5 s) reports:
- **Model**: reachable, latency, API key accepted, right model served.
- **GPU**: Brev instance state, when `BREV_INSTANCE` is set.
- **Tunnel**: when `TUNNEL_HOST` is set, the server itself keeps `ssh -L` open and reconnects it.
- **Usage**: tokens in and out, tokens per second, and GPU cost (`GPU_HOURLY_USD` × the time the GPU
  was seen running), plus the effective price per million tokens.

The UI turns the worst problem into one plain sentence above the prompt box: "GPU is off, start
it…", "tunnel down, reconnecting…", "model still loading…".

## Engines
A thread runs on one engine, chosen when it starts:
- **agent-stage** (`src/agent.ts`): our own loop and tools, any OpenAI-compatible or Anthropic model.
- **Claude Code** (`src/claudecode.ts`): Anthropic's agent loop through the Claude Agent SDK, authenticated with an
  Anthropic **API key**. We translate its messages into our events (Read → `read_file`, Edit → `edit_file`,
  Bash → `run_command`…), route Bash through our approval card (`canUseTool`), enforce the Learn-mode lock with a
  `PreToolUse` hook, expose the checkpoint tool through an in-process MCP server, compute diffs with
  Pre/PostToolUse hooks, and resume the SDK session per thread. Ask side threads fork that session in plan mode.
  We never offer claude.ai login or touch subscription credentials, per Anthropic's terms for third-party apps.

Both engines emit the same event stream, so the UI doesn't know or care which one is running.

## Context
Our engine keeps the model's context bounded: files are read 400 lines at a time, and when the conversation passes
~120k characters older tool outputs are replaced by short stubs (the model can re-read). `AGENTS.md` / `CLAUDE.md`
at the project root are loaded as project instructions.

## Lesson notes and shared sessions
`src/session.ts` turns a thread into something to keep or pass on, from its events alone (no model call):
- `GET /api/threads/:id/notes`: a Markdown study sheet. It picks the tutor's `✦ Concept`, `✦ Why this matters` and
  `✦ What you learned` callouts out of its messages, the checkpoints with the learner's answers, the quiz, the files
  changed, the done-checks and the step labels.
- `GET /api/threads/:id/export`: a session file (`agent-stage/session`, version 1) with the events (without token usage)
  and the map as it is now.
- `POST /api/threads/import`: checks the file's shape, then creates a thread marked `shared`, with an empty folder of
  its own under `~/.agent-stage/shared/` and the exported map. Every route that would run the agent, undo, commit or
  touch git answers 403 for it; only "Explain this change" works, since it reads the diff alone.

## Mock mode
With no API key, `src/model.ts` plays a scripted run. The whole UI can be developed, tested
and demoed offline.
