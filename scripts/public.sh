#!/bin/sh
# Put the live demo online from this computer: builds the sandbox image, starts the manager and a Cloudflare
# tunnel, and prints the public link. Ctrl-C takes everything offline again (sandboxes included).
# Options (env): INVITE=code  MAX_SESSIONS=5  IDLE_MIN=20  TOKEN_BUDGET=400000  NO_TUNNEL=1
set -e
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Docker Desktop is needed: https://www.docker.com/products/docker-desktop/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Start Docker Desktop first."; exit 1; }
PORT=${PORT:-8080}
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "The live demo (or something else) is already running on port $PORT. Stop it first (Ctrl-C in its terminal)."; exit 1
fi
echo "→ building the app and the sandbox image (first time takes a few minutes)…"
npm run build --silent >/dev/null
docker build -q -t agent-stage-sandbox -f public/Dockerfile . >/dev/null
docker image prune -f --filter label=agent-stage=sandbox >/dev/null  # older builds left untagged by this one
node src/public/manager.ts &
MANAGER=$!
# The fixed address (a small Vercel page, public/site) is pointed at this run's link, and back to "offline" after.
SITE=public/site
publish() { [ -d "$SITE/.vercel" ] && command -v vercel >/dev/null && { printf '{ "url": %s }\n' "$1" > "$SITE/live.json"; (cd "$SITE" && vercel deploy --prod --yes >/dev/null 2>&1) && return 0; }; return 1; }
cleanup() { trap - INT TERM EXIT; kill $MANAGER 2>/dev/null; [ -n "$TUNNEL" ] && kill $TUNNEL 2>/dev/null; [ -n "$URL" ] && { echo "Marking the demo offline…"; publish null; }; wait; }
trap cleanup INT TERM EXIT
if [ -z "$NO_TUNNEL" ]; then
  command -v cloudflared >/dev/null || { echo "Installing cloudflared…"; brew install cloudflared >/dev/null; }
  LOG=$(mktemp)
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 &
  TUNNEL=$!
  sleep 2; kill -0 $MANAGER 2>/dev/null || exit 1  # the manager failed to start: don't publish a dead link
  for i in $(seq 1 30); do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1); [ -n "$URL" ] && break; sleep 1; done
  [ -n "$URL" ] && publish "\"$URL\"" && STABLE=https://agent-stage-eta.vercel.app
  echo ""
  [ -n "$STABLE" ] && echo "  Share this:  $STABLE"
  echo "  Live demo:  ${URL:-(tunnel failed, see $LOG)}"
  [ -n "$INVITE" ] && echo "  Invite code: $INVITE"
  echo "  Ctrl-C to take it offline."
  echo ""
fi
wait $MANAGER
