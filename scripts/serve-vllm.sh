#!/usr/bin/env bash
# Run ON the GPU machine (e.g. a Brev instance). Serves an open coding model with an
# OpenAI-compatible API on :8000, with tool calling on, inside tmux so it survives disconnects.
#   bash serve-vllm.sh                 # default model
#   MODEL=... PARSER=... bash serve-vllm.sh
set -euo pipefail
# FlashInfer's sampler JIT-compiles on first use and needs nvcc, which many GPU images lack: disabled below.

MODEL="${MODEL:-Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8}"
PARSER="${PARSER:-qwen3_coder}"          # tool-call parser matching the model family
MAX_LEN="${MAX_LEN:-65536}"
KEY_FILE="$HOME/.vllm-key"

[ -f "$KEY_FILE" ] || openssl rand -hex 24 > "$KEY_FILE"
KEY="$(cat "$KEY_FILE")"

if [ ! -x "$HOME/vllm-env/bin/vllm" ]; then
  echo "→ installing vLLM (a few minutes, first time only)"
  command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  uv venv "$HOME/vllm-env" --python 3.12
  VIRTUAL_ENV="$HOME/vllm-env" uv pip install vllm
fi

command -v tmux >/dev/null || sudo apt-get install -y tmux
tmux kill-session -t vllm 2>/dev/null || true
tmux new-session -d -s vllm "VLLM_USE_FLASHINFER_SAMPLER=0 $HOME/vllm-env/bin/vllm serve $MODEL --port 8000 --host 0.0.0.0 \
  --api-key $KEY --enable-auto-tool-choice --tool-call-parser $PARSER --max-model-len $MAX_LEN \
  2>&1 | tee $HOME/vllm.log"

echo
echo "vLLM is starting in tmux (model download + load takes ~5–10 min). Watch: tail -f ~/vllm.log"
echo "Ready when this prints a model list:  curl -s localhost:8000/v1/models -H 'Authorization: Bearer $KEY'"
echo
echo "Put these in the .env of your Codetandem checkout:"
echo "  MODEL_BASE_URL=http://localhost:8000/v1"
echo "  MODEL_API_KEY=$KEY"
echo "  MODEL_NAME=$MODEL"
