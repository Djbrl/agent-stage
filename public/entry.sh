#!/bin/sh
# Fresh copies of the sample projects, each with version history so Undo works from the first task.
set -e
mkdir -p /work
for d in /samples/*/; do
  name=$(basename "$d"); cp -r "$d" "/work/$name"
  git -C "/work/$name" init -q
  git -C "/work/$name" add -A
  git -C "/work/$name" -c user.name=agent-stage -c user.email=agent-stage@localhost commit -q -m "Sample project"
done
cd /app && exec node src/server.ts
