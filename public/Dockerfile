# One visitor's sandbox for the online demo: agent-stage in public mode, with git, Node, Python and Chromium.
# Built and run by src/public/manager.ts. Nothing secret goes in here: the model key stays with the manager.
FROM node:24-bookworm-slim
LABEL agent-stage=sandbox
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 python3-pytest python3-pip python3-venv chromium fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY web/dist ./web/dist
COPY public/samples /samples
COPY public/entry.sh /entry.sh
# pip installs into ~/.local (the image is the only user of its Python)
ENV PIP_BREAK_SYSTEM_PACKAGES=1 PIP_USER=1
ENV PUBLIC=1 WORKSPACE=/work AGENT_STAGE_HOME=/home/node/.agent-stage CHROME_PATH=/usr/bin/chromium PORT=3000
RUN mkdir -p /work && chown node:node /work
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/entry.sh"]
