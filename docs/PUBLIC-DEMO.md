# Live demo from your own computer

```bash
npm run public                   # no code: anyone with the link ($5 of Claude, 60 GPU minutes per sandbox, 5 at a time)
INVITE=random npm run public     # a fresh invite code (e.g. dakar-40213) printed with the link
INVITE=dakar2026 npm run public  # choose the code
```

It prints a `https://….trycloudflare.com` link. Share it. Ctrl-C takes everything offline and deletes every sandbox.

Needs Docker Desktop running. The first run builds the sandbox image (a few minutes) and installs `cloudflared`.

## What a visitor gets

Their own **sandbox**: a container with Tandemcode in public mode, two sample projects (`todo-app` and `stats-py`, each with
a few ideas in its README), git, Node, Python and Chromium. The agent really edits files, runs commands and tests, and uses
the browser, but only inside that container. It is deleted 20 minutes after their last activity.

## Who is using it

Open **http://localhost:8080/__admin** on this computer while the demo runs: every sandbox, the visitor's IP, country and
browser, when it started, when it was last active, its model tokens and its threads. "Look inside" opens that sandbox
in your browser; "Stop" deletes it. The page only answers on this computer (requests through the tunnel get a 404).
The terminal also prints a line each time a sandbox is created or removed.

## The model

The sandboxes use the model that is active in Tandemcode's settings on this computer (for example your Brev GPU, so keep
`npm start` running with the GPU on), or the one given by `PUBLIC_MODEL_URL` / `PUBLIC_MODEL_KEY` / `PUBLIC_MODEL_NAME`.
If none is usable, they fall back to the scripted demo model. The key never enters a sandbox: model calls go through
the manager, which adds the key and stops a sandbox after `TOKEN_BUDGET` tokens (400k by default).

## How it is sealed

```
visitor ── https ── Cloudflare tunnel ── manager (this computer, :8080)
                                              │  one cookie = one sandbox
                                              ▼
                                    relay (container on both networks)
                                              │
                          ┌───────────────────┴──── sealed network, no internet ────┐
                          sess-a1b2c3            sess-d4e5f6           …
```

- Sandboxes sit on an internal Docker network with **no internet** and no route to this computer. Their only way out is
  the relay, which forwards model calls (`/v1/…`) and nothing else.
- The relay forwards a visitor's browser traffic to a sandbox only with a secret that only the manager holds, so
  sandboxes can't reach each other through it.
- Each sandbox: 1 CPU, 1.5 GB RAM, 512 processes, all Linux capabilities dropped, no privilege escalation, non-root user.
- Public mode in the app hides settings, keys, the GPU controls and the folder pickers; the browser tool only opens
  pages served inside the sandbox; "open on my computer" is off.
- At most `MAX_SESSIONS` sandboxes (5) at once.

Internet: with an invite code (or `INTERNET=1`), sandboxes reach public websites on ports 80 and 443 through a proxy in the relay (`HTTP(S)_PROXY`), so `npm install`, `pip install` and `git clone https://…` work. The proxy resolves every name itself and refuses private, loopback and link-local addresses, so a sandbox still can't reach this computer, the home network or other containers. `INTERNET=0` seals them again.
