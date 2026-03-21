# session-chat

Inter-session messaging plugin for Claude Code. Send and receive messages between Claude Code sessions running in different terminal panes.

## Features

- **list_sessions** — View all active Claude Code sessions
- **send_message** — Send a message to a specific session or broadcast to all
- **read_messages** — Read unread messages
- **message_history** — View full conversation history
- **Auto-wake** — Sessions automatically wake up when a message arrives

## Setup

### Install via plugin

```
/plugin marketplace add yutakakn/claude-session-chat
/plugin install session-chat
```

### Start sessions with names

```bash
CLAUDE_SESSION_CHAT_NAME=frontend claude
CLAUDE_SESSION_CHAT_NAME=backend claude
```

## Usage

Just talk naturally:

- "What sessions are running?" → calls `list_sessions`
- "Ask backend if the API is ready" → calls `send_message`
- "Any new messages?" → calls `read_messages`

Messages are automatically detected and Claude wakes up to respond.

## How it works

- MCP server provides messaging tools via shared JSON files in `$TMPDIR/claude-session-chat/`
- A `Stop` hook with `asyncRewake` polls for new messages every 3 seconds
- When a message arrives, Claude automatically wakes and processes it

## License

MIT
