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

## Mock mode
With no API key, `src/model.ts` plays a scripted run. The whole UI can be developed, tested
and demoed offline.
