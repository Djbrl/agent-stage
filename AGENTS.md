# Handoff: agent-stage

Read this first. It's the full context as of **16 10 2026**. `CLAUDE.md` points here.

## What this is
Hackathon entry for the **Open Source × AI Hackathon 2026** (hacktoberfest.galsen.dev/hackathon). The name "agent-stage" is temporary.

agent-stage is a **visual-first coding-agent harness**. You give a task, and the project is drawn as a map: the agent's marker moves to the files it reads and edits, and steps, diffs and explanations are one click away. It runs open models (Qwen3-Coder on our own Brev GPU, NVIDIA's API, Ollama…) through its own agent loop, or Claude Code through the Agent SDK. It is aimed at the **education prize**: Learn mode, plain-language step labels, replay.

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
- **Network:** sandboxes sit on an `--internal` Docker network with no internet. Their only door is the relay container, which forwards model calls only. The manager adds the real key and enforces a 400k-token budget per sandbox.
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
- **Local commits on `main` not pushed yet** (the UX pass of 16–17 10, see `git log origin/main..main`). Ask Jib before pushing.
- The GPU is off (it auto-stopped), the live demo is offline, no sandboxes are running.
- **New since 16 10:** light theme + lighter indigo dark theme (Settings → Appearance, `web/src/theme.ts`, map palettes in `MapCanvas.tsx`); tabs Threads | Chat | Steps; Learn checkpoints with Skip and replies through the main input; voice prompting (browser speech, `web/src/voice.ts`); token meter; Undo scoped to the thread's own files (`task_end` events); `idle` event so the chat never sticks on "Thinking…"; Claude models fall back to `ANTHROPIC_API_KEY` from `.env`.
- **Verified end to end:**
  - mock model locally; Qwen3-Coder on the Brev GPU, locally and through the public link; Undo; browser tools; sandbox isolation;
  - Claude (Anthropic API) in Build and Learn, including switching a thread from Build to Learn;
  - **the Claude Code engine with a real key** (17 10: build, stop, approvals, done-check).
- **Not verified:** NVIDIA-hosted Nemotron (no key in settings yet). Voice input only checked for presence (headless browsers have no microphone).
- **Reviews:** `review/UX-REVIEW.md` (16 10 hands-on review) and `review/ASK-AND-DISCUSS.md` (design and token cost of Ask/Discuss). Not committed.

## Open work, roughly by value
1. **Demo video (≤3 min) and submission by 19 10.** README sections need a final pass against the jury checklist.
2. **Invite code on by default** for `npm run public` (`INVITE=…`), now that the GPU-backed demo is shareable.
3. **Wolof voice input.** English/French voice prompting is built (browser speech recognition). Still to do for Wolof:
   - Wolof via Meta Omnilingual ASR or `CAYTU/whosper-large` on our GPU, then NLLB translation, showing both lines.
4. A per-sandbox disk cap or watchdog (Docker Desktop has no per-container disk limit).
5. Hide `__pycache__` / build folders on the map (`src/mapdata.ts`).
5b. Smaller items from the 17 10 QA: replay counter counts events not steps and loses labels; Learn teaching quality (push back, hints before code, gloss jargon, recap); the Ask "small context" option in `review/ASK-AND-DISCUSS.md`; map labels missing for some files.
6. Review-before-keep (Keep → AI commit message / Discard) and a branch per thread. These are the git items 3 and 4 not built yet.
7. Codex engine (shows "coming soon").
8. A stable demo URL without the Vercel redeploy trick needs a domain and a named Cloudflare tunnel.

## Owner
Jib (Djbrl), Dakar, UTC+0, works roughly 12:00–03:00. Planner: `~/life_planner/projects/agent-stage/`.
