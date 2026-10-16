#!/bin/sh
# Put the live demo online from this computer: builds the sandbox image, starts the manager and a Cloudflare
# tunnel, and prints the public link. Ctrl-C takes everything offline again (sandboxes included).
# Options (env): INVITE=code  MAX_SESSIONS=5  IDLE_MIN=20  TOKEN_BUDGET=400000  NO_TUNNEL=1
set -e
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Docker Desktop is needed: https://www.docker.com/products/docker-desktop/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Start Docker Desktop first."; exit 1; }
echo "→ building the app and the sandbox image (first time takes a few minutes)…"
npm run build --silent >/dev/null
docker build -q -t agent-stage-sandbox -f public/Dockerfile . >/dev/null
PORT=${PORT:-8080}
node src/public/manager.ts &
MANAGER=$!
trap 'kill $MANAGER 2>/dev/null; [ -n "$TUNNEL" ] && kill $TUNNEL 2>/dev/null; wait' INT TERM EXIT
if [ -z "$NO_TUNNEL" ]; then
  command -v cloudflared >/dev/null || { echo "Installing cloudflared…"; brew install cloudflared >/dev/null; }
  LOG=$(mktemp)
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 &
  TUNNEL=$!
  for i in $(seq 1 30); do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1); [ -n "$URL" ] && break; sleep 1; done
  echo ""
  echo "  Live demo:  ${URL:-(tunnel failed, see $LOG)}"
  [ -n "$INVITE" ] && echo "  Invite code: $INVITE"
  echo "  Ctrl-C to take it offline."
  echo ""
fi
wait $MANAGER
