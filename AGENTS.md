# Handoff: Codetandem

Read this first. It's the full context as of **16 10 2026**. `CLAUDE.md` points here.

## What this is
Hackathon entry for the **Open Source × AI Hackathon 2026** (hacktoberfest.galsen.dev/hackathon). **The name is Codetandem** (chosen by Jib on 19 10 2026; it was "agent-stage" before). The brand is light, playful and sporty, like a tandem bike: the learner steers, the agent pedals. Lines: "You steer. It pedals." and "Code in tandem." Palette: lime, track orange, jersey blue, sun yellow and ink; Archivo for headlines, Figtree for body text. The icon is a tandem bike on track orange (`public/site/icon.svg`, copied to `web/public/icon.svg` for the app). The landing page uses the new style; the app itself only got the new name and icon.

**Still named agent-stage, on purpose** (renaming breaks existing data or links, so it's Jib's call): the data folder `~/.agent-stage` and `AGENT_STAGE_HOME`, `~/agent-stage-projects`, the git refs `refs/agent-stage/*`, the session file format id `agent-stage/session`, the Docker image `agent-stage-sandbox`, the npm package name, the GitHub repo `Djbrl/agent-stage` and the Vercel URL.

Codetandem is a **visual-first coding-agent harness**. You give a task, and the project is drawn as a map: the agent's marker moves to the files it reads and edits, and steps, diffs and explanations are one click away. It runs open models (Qwen3-Coder on our own Brev GPU, NVIDIA's API, Ollama…) through its own agent loop, or Claude Code through the Agent SDK. Since 19 10 it is positioned as **the coding-agent harness for learners** and entered in the **Éducation & apprentissage** track (prizes go to the top 3 overall; there is no separate education prize). The target is people who already code, not kids. Learn ("Guide me") is the default mode.

- **Submit by Mon 19 10 2026.** The jury wants a public repo, the MIT licence (done), a README with problem/solution, the AI's role, models and dependencies, visible git history, and a demo video of 3 minutes or less.
- **Final:** Dakar, 24 10 (a 7-minute pitch plus Q&A).
- **Scoring:** problem 25%, AI use 20%, technical quality 20%, **open-source practices 20%**, UX/pitch 15%.
- **Team:** Jib (Djbrl, owner) and one teammate.

## Run it
```bash
npm install
npm run mock      # UI with a scripted model, no key or GPU needed → http://localhost:3000
npm start         # real models; settings in ~/.agent-stage/settings.json (mode 600)
npm run public    # live online demo from this laptop (needs Docker Desktop), see docs/PUBLIC-DEMO.md
npm test          # node:test, files in test/ (tools, done-check, git checkpoints, the relay's address filter, notes and shared sessions)
npm run typecheck # tsc for the server (tsconfig.json) and the UI (web/tsconfig.json); CI runs both plus the build
```

**Node:** 24 runs `.ts` directly with **type stripping only**, so don't use parameter properties, enums or namespaces. `npm start` rebuilds `web/dist` first.

**Data:** stored in `~/.agent-stage/`: `settings.json`, `threads/*.json`, `shots/` (browser screenshots) and `summaries/`.

## Map of the code
**Server** (`src/`, Hono + SSE):

| File | What it does |
|---|---|
| `server.ts` | Every API route. `open()` shares one in-memory `Live` per thread; concurrent loads must not create two copies, which was a real bug. `GET /threads/:id/events` is SSE and starts with a `hello` event; `/log?from=n` is the polling fallback. |
| `agent.ts` | Our own agent loop: tools, context trimming, repeat guard, Learn-mode write lock, done-check. |
| `claudecode.ts` | Claude Code engine (Agent SDK, **API key only, never claude.ai login**). Its events are mapped to ours. The browser tools are exposed to it through an in-process MCP server. |
| `model.ts` / `anthropic.ts` | OpenAI-compatible client and native Claude client. `MODEL_API_KEY=mock` gives the scripted model (build, web and learn scripts). |
| `tools.ts` | File, search and shell tools, confined to the thread folder. Shell commands need approval; `background: true` runs dev servers. |
| `browser.ts` | Computer use, text-first: the page text plus numbered controls, with a screenshot per action, on the user's Chrome via playwright-core. Local pages are free, other sites ask once, `open_on_computer` asks every time. |
| `verify.ts` | Done-check. When the agent says it's done, it runs the project's tests (or typecheck/build, pytest, cargo, go). Failures go back to the agent, up to 3 times. If the project has no check, the agent gets one nudge to test its work. |
| `git.ts` | A checkpoint before every task, as a commit under `refs/agent-stage/*` built with a private index (the user's branch and staging are untouched). `restore()` powers Undo. |
| `gpu.ts`, `tunnel.ts`, `health.ts` | One-click Brev GPU: create → install vLLM → load the model, auto-stop after 20 idle minutes, destroy on stop. The SSH tunnel uses **local port 18000** (port 8000 clashes with other Docker apps on Jib's Mac) and only runs while a GPU exists. |
| `insight.ts`, `learn.ts`, `mapdata.ts`, `store.ts` | Step labels and summaries, Learn-mode prompts (adapted from VibeWise, credited), map data, and settings/threads. |
| `session.ts` | Lesson notes (Markdown study sheet from the events) and session files: export a thread, import it as a read-only replay (`thread.shared`; the server refuses anything that would run or change files for it). |
| `public/manager.ts`, `public/relay.ts` | The online demo (see below). |

**UI** (`web/src/`, Vite + React 19):
- `App.tsx` picks the layout. **Studio** (default) is the map full-screen plus one floating panel with Chat / Steps / Threads tabs. **Classic** is the sidebar, chat column and map. Both are in `ThreadView.tsx`.
- `MapCanvas.tsx` draws the canvas circle-pack map, steered by `director.ts` (the auto camera). `Stage.tsx` holds the floating tools, caption, approval card and browser window.
- `useAgent.ts` turns events into state: it reduces events and handles replay, SSE with the polling fallback, undo and verify entries.
- `AgentPanel.tsx` is the chat and composer. `StepsSheet.tsx` shows step detail (diff, screenshot, explain). `PublicWelcome.tsx` is the demo's welcome card.
- Design rules from Jib: visual first, map above text, details on demand, **no coloured border stripes**, quiet chrome, plain words.

## Online demo (`npm run public`)
How it fits together:
1. Vercel landing page `public/site` → https://agent-stage-eta.vercel.app (Vercel team "bountbi"). It reads `live.json`.
2. A Cloudflare quick tunnel → the manager on `:8080`.
3. One Docker container per visitor (`public/Dockerfile`, image `agent-stage-sandbox`), with the app in `PUBLIC=1` mode and the sample projects in `public/samples`.

How it's sealed:
- **Network:** sandboxes sit on an `--internal` Docker network. Their only door is the relay container: model calls, plus (on by default with an invite code, `INTERNET=0` to turn off) a proxy to public websites on 80/443 that refuses private addresses. The manager adds the real key and enforces a 400k-token budget per sandbox.
- **Containers:** 1 CPU, 1.5 GB RAM, all capabilities dropped, non-root.
- **App:** public mode hides settings, keys, the GPU controls and the folder pickers.
- **Session limits:** at most 5 sandboxes; one is deleted after 20 idle minutes; all are deleted on Ctrl-C or a crash.

Ops:
- **Admin page:** http://localhost:8080/__admin, reachable from this machine only.
- **Model:** the sandboxes use the model active in local settings when it answers, otherwise the scripted model. Keep `npm start` running so the GPU tunnel and auto-stop work.
- **Cloudflare quick tunnels don't stream SSE,** so the UI falls back to polling after 3 seconds without the `hello` event.
- **Only one copy at a time.** `public.sh` refuses to start a second one; a failed copy never touches Docker.

## Rules
- **Ask Jib before pushing.** Small local commits are fine; the history is public and the jury reads it.
- **Never leave a paid GPU running.** Brev `agent-gpu` costs about $1.06/h. Turn it off by default and destroy it after tests.
- **Leave nothing behind in Docker** when something fails.
- Prose dates are written DD MM YYYY. Write plainly, no jargon, in user-facing text.
- Verify UI changes in a real browser (playwright-core with `channel: 'chrome'` works well) before saying something is done.

## State now (17 10 2026)
- **All work is pushed to `main`** (the UX pass and the open-work pass of 16–17 10).
- The GPU is off (it auto-stopped), the live demo is offline, no sandboxes are running.
- **New since 16 10:**
  - light theme (Settings → Appearance; dark is the original near-black);
  - tabs Threads | Chat | Steps; Learn checkpoints with Skip and replies through the main input; better teaching;
  - voice prompting (`web/src/voice.ts`); token meter with Compact / Clear context; typing animation and elapsed times;
  - Undo scoped to the thread's own files (`task_end` events) and **Keep** (commit with a model-written message);
  - Ask reads a short brief instead of the whole thread; Usage shows estimated spend;
  - `idle` event so the chat never sticks on "Thinking…"; Claude models fall back to `ANTHROPIC_API_KEY` from `.env`;
  - online demo: invite code by default, disk watchdog (`DISK_MB`).
- **Task tracker:** https://claude.ai/artifact/Y4yUKmMFfCVH43gKAEQWmf (private to Jib).
- **Verified end to end:**
  - mock model locally; Qwen3-Coder on the Brev GPU, locally and through the public link; Undo; browser tools; sandbox isolation;
  - Claude (Anthropic API) in Build and Learn, including switching a thread from Build to Learn;
  - **the Claude Code engine with a real key** (17 10: build, stop, approvals, done-check).
- **Not verified:** NVIDIA-hosted Nemotron (no key in settings yet). Voice input only checked for presence (headless browsers have no microphone).
- **Reviews:** `review/UX-REVIEW.md` (16 10 hands-on review) and `review/ASK-AND-DISCUSS.md` (design and token cost of Ask/Discuss). Not committed.

## New on 19 10 (learner pass)
- **First launch** (`web/src/Welcome.tsx`): "Stay in the loop.", level and language chips (saved to the Learn settings), *Open a project* first, *Try a guided demo* second (an empty project seeded with an intro and three starter ideas, no model call). No mode or engine choice: new threads are Learn with the active model, and a one-time note says both can be changed. The New thread dialog is just folder / empty project / recent.
- **Contextual tips** (`web/src/Tips.tsx`) replace the deleted 9-stop tour: each fires once, when it becomes relevant (agent moves, approval, checkpoint, first edit, task done, camera taken).
- **Progressive interface:** Steps tab after the first step, Threads tab with a second thread, map tools and the terminal/browser circles once used, model picker only with several usable models, token meter on hover.
- **What you learned** (`web/src/Learned.tsx`, `learnedFromTask` in `src/insight.ts`): after a task that changed something, a `learned` event with 2–3 concepts and a "Try it yourself" exercise, plus "concepts so far" per thread.
- **Plain words and French** across the interface (`web/src/i18n.ts`, `useT()`); modes renamed *Guide me* / *Just build it* in the UI (values stay `learn` / `build`).
- **Side questions from anywhere** (`web/src/AskWindow.tsx`): select text in a message, step, diff or code block (*Ask about this*), the "?" on a message, ⌘K or *Ask why* opens a floating window (drag, resize, shrink to a pill, Esc) running a read-only side session (`/ask-thread`) while the main agent keeps working; *Save to notes* keeps it. Replaces the docked side thread.
- **Scratchpad** (20 10, `web/src/Sketch.tsx`, `src/sketch.ts`): the side-question window is now Scratchpad, also opened by the button under the chat box. A page to draw on (4 colours, 2 sizes, eraser, undo) or to mark up a picture (file, paste or drop). The sketch goes up as a PNG (`POST /api/sketches`, saved in `shots/`) and rides on `ask-thread` and `task` as `images`. Claude (our loop) and Claude Code get it as image blocks (both checked with a real key); OpenAI-style models get a note that a sketch was attached, since most open coding models can't see images. *Make it a task* sends the note and sketch to the main session.
- Open-source kit: smoke test (`test/smoke.test.ts`), CI, CONTRIBUTING, Code of Conduct, templates; good first issues #1–#7 on GitHub.

## Open work, roughly by value
1. **Demo video (≤3 min) and submission by 19 10** (Jib, later). The README is updated; add the video link where its hidden comment says.
2. A stable demo URL without the Vercel redeploy trick needs a domain and a named Cloudflare tunnel (Jib, later).
3. A branch per thread (Keep and Undo are built). Doing it properly means a git worktree per thread (its own folder),
   which changes how threads and folders work; left for after the submission on purpose (18 10).

Added 18 10: tests and CI, release v0.1.0, SECURITY.md, Quiz me, lesson notes, shared sessions (export / import as a
read-only replay), plus fixes for links out of the project, Windows paths and screen readers. See CHANGELOG.md.

Out of scope for now (Jib, 17 10): Wolof voice input and the Codex engine.

## Owner
Jib (Djbrl), Dakar, UTC+0, works roughly 12:00–03:00. Planner: `~/life_planner/projects/agent-stage/`.
