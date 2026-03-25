#!/usr/bin/env bash
set -euo pipefail

RECEIPT_WORKDIR="${RECEIPT_WORKDIR:-/workspace/receipt}"
PORT="${PORT:-8787}"
RESONATE_HTTP_URL="${RESONATE_URL:-http://127.0.0.1:8001}"
RESONATE_SQLITE_PATH="${RESONATE_SQLITE_PATH:-${RECEIPT_WORKDIR}/.receipt/resonate/resonate.db}"
HOME="${HOME:-/tmp/receipt-home}"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"

cd "${RECEIPT_WORKDIR}"

mkdir -p \
  "$(dirname "${RESONATE_SQLITE_PATH}")" \
  "${HOME}" \
  "${CODEX_HOME}" \
  "${RECEIPT_WORKDIR}/.receipt"

if [ ! -d node_modules ] || [ ! -e node_modules/.bin/tailwindcss ]; then
  echo "[entrypoint] installing Bun dependencies"
  bun install --frozen-lockfile
fi

shutdown() {
  local exit_code="${1:-0}"
  trap - INT TERM
  if [ -n "${receipt_pid:-}" ] && kill -0 "${receipt_pid}" 2>/dev/null; then
    kill "${receipt_pid}" 2>/dev/null || true
  fi
  if [ -n "${resonate_pid:-}" ] && kill -0 "${resonate_pid}" 2>/dev/null; then
    kill "${resonate_pid}" 2>/dev/null || true
  fi
  wait "${receipt_pid:-}" 2>/dev/null || true
  wait "${resonate_pid:-}" 2>/dev/null || true
  exit "${exit_code}"
}

trap 'shutdown 143' INT TERM

echo "[entrypoint] starting Resonate with SQLite at ${RESONATE_SQLITE_PATH}"
resonate serve --aio-store-sqlite-path "${RESONATE_SQLITE_PATH}" &
resonate_pid=$!

for _ in $(seq 1 60); do
  if curl -fsS "${RESONATE_HTTP_URL}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${RESONATE_HTTP_URL}/healthz" >/dev/null 2>&1; then
  echo "[entrypoint] Resonate failed to become healthy" >&2
  exit 1
fi

echo "[entrypoint] starting Receipt on port ${PORT}"
bun run start &
receipt_pid=$!

wait -n "${resonate_pid}" "${receipt_pid}"
shutdown "$?"
