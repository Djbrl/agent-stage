# Handoff for agents working on this repo

Read this first. It is the full context from the setup session (14 10 2026).

## What this is
Hackathon entry: **Open Source × AI Hackathon 2026** (hacktoberfest.galsen.dev/hackathon).
A lightweight, **visual** coding agent (a mini Claude Code / Codex): the user prompts, then text
takes a back seat and they **watch the agent work** on a project map (an agent marker moves to the
files it touches, edits glow, errors show red). The user can **stop** it, **ask** it questions mid-run,
and **approve** shell commands. It runs on **any open-weight model** via an OpenAI-compatible API.
Default provider: NVIDIA (build.nvidia.com), using Jib's $100 of credits.

Same concept family as Jib's earlier project Rundown (github.com/Djbrl/brainstorm), but **new code
in a new repo**. Don't copy code from Rundown; rebuild it.

## Hard constraints
- **Submit by Mon 19 10 2026**: public repo, explicit OSS license (MIT, done), useful README,
  install/usage docs, visible git history, list of major dependencies, description of the
  problem and solution, **clear explanation of the AI's role**, list of models/APIs/tools, demo
  video of 3 minutes or less. Final in Dakar on 24 10 (7-min pitch and 3 min of Q&A).
- Scoring: problem 25% · AI use 20% · technical quality 20% · **open-source practices 20%** · UX/pitch 15%.
- **Commit small and often.** The judges see the Git history.
- Team of 2.

## What exists
- `src/model.ts`: OpenAI-compatible chat client (fetch, no SDK). Config comes from `.env`.
- `src/tools.ts`: 6 tools (list_files, read_file, write_file, edit_file, search, run_command),
  locked to the workspace root. run_command calls `ctx.approve()`.
- `src/agent.ts`: the agent loop. `run()`, `stop()` (aborts), `interject()` (adds a user message
  mid-run). Emits `AgentEvent`s; the UI should be built on these.
- `src/cli.ts`: terminal harness for testing models.
- No dependencies. Node ≥ 22.18 runs `.ts` directly (type stripping only: **no parameter
  properties, enums or namespaces**).

## Status
- Verified: code loads and reaches NVIDIA's API. **Not yet tested end to end with a key.**
- Default model `nvidia/nemotron-3-super-120b-a12b`. Candidates: `moonshotai/kimi-k2.6`,
  `z-ai/glm-5.3`, `openai/gpt-oss-20b`. Pick the one whose tool calling is reliable.

## Plan
| Date | Goal |
|---|---|
| 14–15 10 | Model shoot-out with the CLI; harden the loop (retries, malformed tool calls) |
| 16 10 | HTTP server + SSE event stream; web UI with the file map and moving agent marker |
| 17 10 | Stop, ask and approve in the UI; diff previews; red errors; model/endpoint settings |
| 18 10 | Polish; README sections (problem, AI role, models, deps, architecture); CONTRIBUTING |
| 19 10 | Demo video, then submit |

Out of scope: multiple agents, history slider, external "places" tracking.

## Owner
Jib (Djbrl). Dakar, UTC+0, works roughly 12:00–03:00. Planner pointer: `~/life_planner/projects/agent-stage/`.
