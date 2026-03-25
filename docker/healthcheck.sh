#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8787}"
RESONATE_HTTP_URL="${RESONATE_URL:-http://127.0.0.1:8001}"

curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null
curl -fsS "${RESONATE_HTTP_URL}/healthz" >/dev/null

