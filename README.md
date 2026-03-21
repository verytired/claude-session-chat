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
/plugin marketplace add verytired/claude-session-chat
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

## Why session-chat over Agent Teams?

Claude Code has built-in [Agent Teams](https://code.claude.com/docs/en/agent-teams.md), but session-chat solves different problems:

| | session-chat | Agent Teams |
|---|---|---|
| **Model per session** | Each session can use a different model (Opus for design, Sonnet for coding, Haiku for tests) | All teammates inherit the lead's model |
| **Cross-project** | Sessions can run in different projects/directories and communicate across them | Same project scope |
| **Independence** | Fully independent sessions. Join/leave anytime | Lead controls all teammates' lifecycle |
| **Equality** | All sessions are peers, no hierarchy | Lead/teammate hierarchy |
| **Cost** | Only pay for communication overhead | Each teammate maintains its own full context |
| **Stability** | No experimental flags needed | Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` |

### Example: cross-project collaboration

```bash
# Terminal 1: Frontend project
CLAUDE_SESSION_CHAT_NAME=frontend claude --model sonnet
# "Ask backend what the /api/users response schema looks like"

# Terminal 2: Backend project
CLAUDE_SESSION_CHAT_NAME=backend claude --model haiku
# Automatically receives the question and responds from its own codebase context
```

## How it works

- MCP server provides messaging tools via shared JSON files in `$TMPDIR/claude-session-chat/`
- A `Stop` hook with `asyncRewake` polls for new messages every 3 seconds
- When a message arrives, Claude automatically wakes and processes it

## License

MIT
