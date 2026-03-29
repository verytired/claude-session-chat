#!/bin/bash
# Check for unread messages, deliver content, and mark as read
# Usage: check-messages.sh [--poll]
#   --poll: continuously poll every 3s until a message arrives (for asyncRewake)
#   (default): one-shot check, exit immediately
DATA_DIR="${TMPDIR:-/tmp}/claude-session-chat"
MESSAGES_FILE="$DATA_DIR/messages.json"
SESSIONS_FILE="$DATA_DIR/sessions.json"
LOCK_FILE="${MESSAGES_FILE}.lock"
MODE="${1:-oneshot}"

# Find this session's name: env var or lookup by cwd in sessions.json
SESSION_ID="${CLAUDE_SESSION_CHAT_NAME:-}"
if [ -z "$SESSION_ID" ] && [ -f "$SESSIONS_FILE" ]; then
  SESSION_ID=$(jq -r --arg cwd "$PWD" '
    to_entries[]
    | select(.value.cwd == $cwd)
    | .key
  ' "$SESSIONS_FILE" 2>/dev/null | head -1)
fi

[ -z "$SESSION_ID" ] && exit 0
[ ! -d "$DATA_DIR" ] && exit 0

# Kill any existing poller for this session before starting a new one
if [ "$MODE" = "--poll" ]; then
  PID_FILE="$DATA_DIR/poller-${SESSION_ID}.pid"
  if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$old_pid" ] && [ "$old_pid" != "$$" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null
      for i in $(seq 1 10); do
        kill -0 "$old_pid" 2>/dev/null || break
        sleep 0.1
      done
    fi
  fi
  echo $$ > "$PID_FILE"
  trap 'rm -f "$PID_FILE"' EXIT
fi

acquire_lock() {
  local attempts=0
  while [ "$attempts" -lt 50 ]; do
    if (set -C; echo $$ > "$LOCK_FILE") 2>/dev/null; then
      return 0
    fi
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
      rm -f "$LOCK_FILE"
      continue
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  return 1
}

release_lock() {
  rm -f "$LOCK_FILE"
}

# Deliver unread messages: output content and mark as read in one step
# Claude should NOT call read_messages after this - content is already delivered
deliver() {
  [ ! -f "$MESSAGES_FILE" ] && return 1

  local unread
  unread=$(jq -r --arg sid "$SESSION_ID" '
    [.[] | select(.read == false and (.to == $sid or .to == "all") and .from != $sid)]
    | length
  ' "$MESSAGES_FILE" 2>/dev/null)

  [ "$unread" -eq 0 ] 2>/dev/null && return 1

  local msgs
  msgs=$(jq -r --arg sid "$SESSION_ID" '
    [.[] | select(.read == false and (.to == $sid or .to == "all") and .from != $sid)]
    | map("[\(.from)] \(.message)")
    | join("\n")
  ' "$MESSAGES_FILE" 2>/dev/null)

  # Mark as read
  if acquire_lock; then
    jq --arg sid "$SESSION_ID" '
      [.[] | if (.read == false and (.to == $sid or .to == "all") and .from != $sid)
             then .read = true else . end]
    ' "$MESSAGES_FILE" > "${MESSAGES_FILE}.tmp" 2>/dev/null \
      && mv "${MESSAGES_FILE}.tmp" "$MESSAGES_FILE"
    release_lock
  fi

  echo "$msgs"
  return 0
}

if [ "$MODE" = "--poll" ]; then
  while true; do
    if deliver; then
      exit 2
    fi
    sleep 3
  done
else
  if deliver; then
    exit 0
  fi
  exit 0
fi
