#!/bin/bash
# Poll for unread messages, mark as read, and rewake Claude with message content
DATA_DIR="${TMPDIR:-/tmp}/claude-session-chat"
MESSAGES_FILE="$DATA_DIR/messages.json"
SESSIONS_FILE="$DATA_DIR/sessions.json"
LOCK_FILE="${MESSAGES_FILE}.lock"

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

# Simple file lock (compatible with the Node.js server's locking)
acquire_lock() {
  local attempts=0
  while [ "$attempts" -lt 50 ]; do
    if (set -C; echo $$ > "$LOCK_FILE") 2>/dev/null; then
      return 0
    fi
    # Check if lock holder is dead
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

# Poll every 3 seconds until a message arrives
while true; do
  if [ -f "$MESSAGES_FILE" ]; then
    unread=$(jq -r --arg sid "$SESSION_ID" '
      [.[] | select(.read == false and (.to == $sid or .to == "all") and .from != $sid)]
      | length
    ' "$MESSAGES_FILE" 2>/dev/null)

    if [ "$unread" -gt 0 ]; then
      # Extract messages before marking read
      msgs=$(jq -r --arg sid "$SESSION_ID" '
        [.[] | select(.read == false and (.to == $sid or .to == "all") and .from != $sid)]
        | map("[\(.from)] \(.message)")
        | join("\n")
      ' "$MESSAGES_FILE" 2>/dev/null)

      # Mark as read with lock
      if acquire_lock; then
        jq --arg sid "$SESSION_ID" '
          [.[] | if (.read == false and (.to == $sid or .to == "all") and .from != $sid)
                 then .read = true else . end]
        ' "$MESSAGES_FILE" > "${MESSAGES_FILE}.tmp" 2>/dev/null \
          && mv "${MESSAGES_FILE}.tmp" "$MESSAGES_FILE"
        release_lock
      fi

      echo "📨 ${SESSION_ID} 宛のメッセージが${unread}件届きました:"
      echo ""
      echo "$msgs"
      echo ""
      echo "上記のメッセージの内容に応じて対応してください。必要であれば send_message で返信してください。"
      exit 2
    fi
  fi
  sleep 3
done
