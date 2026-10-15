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
- **Small local commits are fine; never push until Jib reviews them** (`git log origin/main..HEAD`). The history is public and read by the jury. Document how things were built in `docs/HOW-WE-BUILT-IT.md`.
- Team of 2.

## What exists
- `src/model.ts`: OpenAI-compatible chat client (fetch, no SDK). Config comes from `.env`.
- `src/tools.ts`: 6 tools (list_files, read_file, write_file, edit_file, search, run_command),
  locked to the workspace root. run_command calls `ctx.approve()`.
- `src/agent.ts`: the agent loop. `run()`, `stop()` (aborts), `interject()` (adds a user message
  mid-run). Emits `AgentEvent`s; the UI should be built on these.
- `src/cli.ts`: terminal harness for testing models.
- `src/server.ts`: **Hono** server on :3000 (chosen by Jib). Routes: GET /api/state,
  GET /api/events (SSE, replays history), POST /api/task|steer|ask|stop|approve|reset (ask = side question, no tools; steer = queued for next step). Serves web/dist.
- `web/`: Vite + React UI. `useAgent.ts` turns events into state; `MapCanvas.tsx` is the canvas project map
  (circle-packed folders, recency colours, agent marker + follow camera; see docs/ARCHITECTURE.md); `App.tsx` holds the side panel (messages, step list, ask box) and the approval prompt.
- **Mock model**: when MODEL_API_KEY is empty or `mock`, `model.ts` plays a scripted run. Useful for UI work.
- Node ≥ 22.18 runs `.ts` directly on the server (type stripping only: **no parameter
  properties, enums or namespaces**). `npm start` builds the UI, then serves everything.

## Status
- 14 10: full UI loop verified in the browser with the mock model (writes, red error, approval, done).
- 15 10 (overnight): UI redesigned from Mobbin references (Linear frame, Vercel-style log, agent-panel groups); diff view; Ask vs Steer; loop hardening (retries, text tool-call recovery, bad-JSON feedback, repeat guard); docs (ARCHITECTURE, HOW-WE-BUILT-IT, CONTRIBUTING, CoC, issue templates). **Uncommitted, awaiting Jib's review.**
- 15 10: real model verified: Qwen3-Coder-30B-FP8 on vLLM, Brev L40S (`scripts/serve-vllm.sh`). The Brev instance was deleted afterwards to stop billing (this provider type can't pause). Recreate: `brev create agent-gpu --type massedcompute_L40S`, scp+run serve-vllm.sh (~10 min). `.env` keeps the key; the script makes a new one, so update MODEL_API_KEY or copy the old key to ~/.vllm-key first.
- 16 10 (night): canvas project map (`web/src/MapCanvas.tsx`, server `src/mapdata.ts`), health/status bar (`src/health.ts`, `src/tunnel.ts`, `web/src/StatusBar.tsx`), usage/cost, smarter loop guard, markdown replies. All committed locally, **not pushed**.
- 16 10 (late): harness shell (sidebar threads, folder picker, settings: models/keys/learning/usage/safety), Claude via Anthropic SDK (`src/anthropic.ts`), Learn mode after VibeWise (`src/learn.ts`, harness write-lock until an implementation checkpoint), AI labels/summaries/explain (`src/insight.ts`), Ask side threads (read-only, temp), replay (`useAgent` cursor + `ReplayBar`), readmap, tour. Data lives in `~/.agent-stage/`. `npm run mock` = demo model.
- 17 10 (night): UI hierarchy rework. ThreadView = chat column | Resizer | Stage (map + floating tools + caption + StepsSheet). Chat-only until work starts. Director camera in `web/src/director.ts` (Rundown's rules), map props `insets/readmap/following/lit`. Text↔map hover via `highlight.tsx`. Removed Inspector/ReplayBar. Sidebar rail (⌘B), sizes in localStorage.
- Known rough edges: a failed read of a nonexistent file still adds a red tile (arguably a feature); mock durations show 0.0s; map layout is simple columns (fine up to ~40 files).
- Default model `nvidia/nemotron-3-super-120b-a12b`. Candidates: `moonshotai/kimi-k2.6`,
  `z-ai/glm-5.3`, `openai/gpt-oss-20b`. Pick the one whose tool calling is reliable.

## Plan
| Date | Goal |
|---|---|
| 14–15 10 | Model shoot-out with the CLI; harden the loop (retries, malformed tool calls) |
| 16 10 | ~~server + SSE + map~~ (done 14 10). Diff previews, nicer map layout |
| 17 10 | Stop, ask and approve in the UI; diff previews; red errors; model/endpoint settings |
| 18 10 | Polish; README sections (problem, AI role, models, deps, architecture); CONTRIBUTING |
| 19 10 | Demo video, then submit |

Out of scope: multiple agents, history slider, external "places" tracking.

## Owner
Jib (Djbrl). Dakar, UTC+0, works roughly 12:00–03:00. Planner pointer: `~/life_planner/projects/agent-stage/`.
