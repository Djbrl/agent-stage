# Security

Tandemcode lets an AI model change files and run commands on your computer, so we take safety reports seriously.

## Reporting a vulnerability

Please report it privately, not in a public issue: open the repository's **Security** tab and choose
**Report a vulnerability**. Include what you did, what happened, and the model and provider you used if it matters.

We will reply within a few days. Once a fix is out, we will credit you in the release notes unless you prefer not to be named.

Only the latest release gets security fixes.

## What protects you today

**On your computer**
- **Every shell command needs your approval** before it runs, and so does the done-check's test command (once per thread).
- **File tools are locked to the project folder.** Paths that point outside it (`../`, absolute paths, another drive)
  are refused, and so are links inside the project that lead outside it.
- **Undo always works.** A git checkpoint is taken before every task, under private refs, so your branch, history and
  staged files are never touched.
- **The browser asks before going online.** Pages served on your own computer open freely; any other website asks once
  per session. "Open on my computer" asks every time.
- **Learn mode blocks file writes** until you approve the step.
- **Keys stay local.** Settings, including API keys, are saved in `~/.agent-stage/settings.json`, readable by your user only.

**In the online demo** (`npm run public`, details in [docs/PUBLIC-DEMO.md](docs/PUBLIC-DEMO.md))
- Each visitor gets their own Docker container: 1 CPU, 1.5 GB of memory, all Linux capabilities dropped, no privilege
  escalation, a non-root user.
- Containers sit on a sealed network. Their only way out is a relay that forwards model calls and, when internet is on,
  public websites on ports 80 and 443. The relay resolves every name itself and refuses private, loopback and link-local
  addresses, so a sandbox can't reach the host computer, the home network or other sandboxes.
- The model key never enters a sandbox. Each sandbox has a token and spending cap, and is deleted after 20 idle minutes
  or if it writes too much to disk.
- Public mode hides settings, keys, the GPU controls and the folder pickers.

## What is not protected

- **An approved command can do anything your user account can do.** The approval is the safeguard: read the command
  before you click Run it. For untrusted tasks, run Tandemcode in a container or a throwaway account.
- **Models can be tricked by what they read.** A web page or file can contain instructions aimed at the agent. Approval
  of commands and websites limits the damage; it doesn't make the model immune.
- **The online demo runs on the host's computer.** It is built for short public demos, not as a permanent service.
