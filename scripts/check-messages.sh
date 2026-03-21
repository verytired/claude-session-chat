#!/bin/bash
# Poll for unread messages and rewake Claude when one arrives
DATA_DIR="${TMPDIR:-/tmp}/claude-session-chat"
MESSAGES_FILE="$DATA_DIR/messages.json"
SESSIONS_FILE="$DATA_DIR/sessions.json"

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

# Poll every 3 seconds until a message arrives
while true; do
  if [ -f "$MESSAGES_FILE" ]; then
    unread=$(jq -r --arg sid "$SESSION_ID" '
      [.[] | select(.read == false and (.to == $sid or .to == "all") and .from != $sid)]
      | length
    ' "$MESSAGES_FILE" 2>/dev/null)

    if [ "$unread" -gt 0 ]; then
      msgs=$(jq -r --arg sid "$SESSION_ID" '
        [.[] | select(.read == false and (.to == $sid or .to == "all") and .from != $sid)]
        | map("[\(.from)] \(.message)")
        | join("\n")
      ' "$MESSAGES_FILE" 2>/dev/null)
      echo "📨 未読メッセージが${unread}件あります:"
      echo "$msgs"
      echo ""
      echo "read_messagesツールで読み取り、内容に応じて返信してください。"
      exit 2
    fi
  fi
  sleep 3
done
