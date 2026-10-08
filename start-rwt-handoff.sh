#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

export RWT_PORT="${RWT_PORT:-4317}"
export CODEX_BIN="${CODEX_BIN:-$(command -v codex 2>/dev/null || true)}"
export CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude 2>/dev/null || true)}"
export CLAUDE_PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-bypassPermissions}"
export CLAUDE_MODEL="${CLAUDE_MODEL:-}"
export CODEX_MODEL="${CODEX_MODEL:-}"
export PM_MODE="${PM_MODE:-auto}"
export RWT_CONTROL_ISSUE="${RWT_CONTROL_ISSUE:-1258}"

URL="http://127.0.0.1:${RWT_PORT}/"

# Back up a prior SQLite database, including WAL state. Newest modified sibling wins.
python3 migrate_state.py

echo "RWT Board v4.6.16 (deadlock.4): $URL"
echo "Use 127.0.0.1, not localhost."
echo "Control issue: #${RWT_CONTROL_ISSUE}"

if [ -z "${CODEX_BIN}" ] || [ ! -x "${CODEX_BIN}" ]; then
  echo "CLI PM transport: Codex CLI NOT FOUND. Install Codex and sign in with ChatGPT."
else
  if env -u OPENAI_API_KEY -u OPENAI_ADMIN_KEY -u CODEX_API_KEY "${CODEX_BIN}" login status >/tmp/rwt-codex-status.$$ 2>&1; then
    echo "CLI PM: Codex CLI · ChatGPT subscription login (${CODEX_MODEL:-CLI default model})"
  else
    echo "CLI PM: Codex CLI found, but sign-in is required. Run: codex"
  fi
  rm -f /tmp/rwt-codex-status.$$ || true
fi

if [ -z "${CLAUDE_BIN}" ] || [ ! -x "${CLAUDE_BIN}" ]; then
  echo "CLI Dev transport: Claude CLI NOT FOUND. Install Claude Code and sign in."
else
  echo "CLI Dev: Claude CLI · existing subscription login (${CLAUDE_MODEL:-CLI default model}; permission=${CLAUDE_PERMISSION_MODE})"
fi

echo "API-key variables are not passed to Codex/Claude child processes in subscription mode."

python3 server.py &
SERVER_PID=$!
cleanup(){ if kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
sleep 0.7
if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true; fi
wait "$SERVER_PID"
