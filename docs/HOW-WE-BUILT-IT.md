# How we built it

A transparent log of how agent-stage was made, for the jury and for anyone curious.
Open Source × AI Hackathon 2026, 14 → 19 October 2026.

## The idea
Coding agents are powerful but hard to follow: you get a wall of text and a diff at the end.
We wanted the opposite. Text takes a back seat and you **watch the agent move through your
project**, with the controls a human needs: stop, ask, steer, approve. It also had to run on
**open-weight models**, so anyone can use it without a proprietary API.

## Day 1: the core (14 10)
- **Backend first, no UI.** We wrote the agent loop as plain TypeScript with no dependencies: a
  model client using `fetch` against the OpenAI-compatible chat API, six sandboxed tools, and a
  terminal harness to test models.
- **Any provider.** Speaking the OpenAI-compatible protocol means NVIDIA's API, Ollama, vLLM, LM
  Studio and OpenRouter all work by changing a URL.
- **Server.** We compared Express, Fastify, Nest.js and Hono. We picked **Hono**: it's tiny, and
  streaming events to the browser (Server-Sent Events) is built in. Nest.js was overkill for
  5 routes.
- **Mock model.** A scripted fake model lets us build and demo the UI with no key or network.

## Day 2: the UI and hardening (15 10)
- **Design research with the Mobbin MCP.** We used [Mobbin](https://mobbin.com)'s MCP server
  from our coding assistant to pull real screens from leading developer tools and design from
  them, rather than guessing:
  - **Linear**: the near-black frame with one inset rounded surface, hairline borders, quiet type;
  - **Vercel** deployment logs: the monospace activity log with timestamps and red error rows;
  - **Cursor, Framer, Snowflake, Replit** agent panels: tool calls collapsed into one-line
    summaries ("Read 1 file, changed 2"), and a composer card with a model chip.
- **Diff view.** Every write/edit emits a before/after event. The UI computes a line diff (LCS),
  shows `+N −M` on each file card, and opens the full diff in the inspector.
- **Ask vs Steer.** Ask is a side question answered right away without tools. Steer is a message
  the agent reads before its next step.
- **Hardening for open models**: retries with backoff, recovery of tool calls written as text,
  invalid-JSON feedback, and a repeat-call guard. Each was tested against a fake model that
  misbehaves on purpose.

## Self-hosting the model (15 10)
To keep the whole stack open, we serve the model ourselves: **Qwen3-Coder 30B (FP8)** with
**vLLM** on a single NVIDIA L40S rented through NVIDIA Brev (about $1/hour). vLLM exposes the same
OpenAI-compatible API, so agent-stage needed zero code changes, only three lines of `.env`.
`scripts/serve-vllm.sh` does the whole setup in one command. One snag: vLLM's FlashInfer sampler
compiles GPU code at startup and needs `nvcc`, which the image lacked, so the script turns that
sampler off. First real run: a 3-file task with clean tool calls in about 4 seconds.

## AI in this project
| Where | What | Why |
|---|---|---|
| **In the product** | an open-weight LLM (we use Qwen3-Coder 30B, self-hosted with vLLM; NVIDIA's hosted API also works) drives the agent: it chooses every tool call | the core of the app |
| **In the product** | the same model answers side questions mid-run | lets the human understand without interrupting |
| **Building it** | Claude Code, an AI coding assistant, for pair-programming | speed in a 5-day window |
| **Building it** | Mobbin MCP, giving the assistant UI references | design grounded in real products |

Every line was reviewed and steered by the team. The assistant drafted and we decided.

## Tools and dependencies
- Runtime: Node.js ≥ 22.18 (runs TypeScript natively)
- Server: `hono`, `@hono/node-server`
- UI: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`
- Fonts: Inter, JetBrains Mono (Google Fonts)
- Models: see the README
