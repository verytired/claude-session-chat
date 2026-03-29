# session-chat

Inter-session messaging plugin for Claude Code. Send and receive messages between Claude Code sessions running in different terminal panes.

## Features

- **list_sessions** — View all active Claude Code sessions
- **send_message** — Send a message to a specific session or broadcast to all (with destination validation)
- **read_messages** — Read unread messages
- **message_history** — View full conversation history with reply threading
- **rename_session** — Rename your session at any time
- **Auto-naming** — Sessions auto-named from `directory-branch` (e.g. `myapp-main`)
- **Auto-wake** — Sessions automatically wake up when a message arrives
- **Reliability** — File locking, zombie session purging, auto message cleanup

## Setup

### Install via plugin

```
/plugin marketplace add verytired/claude-session-chat
/plugin install session-chat
```

### Start sessions

Sessions are automatically named from directory and git branch:

```bash
# Auto-named as "frontend-main"
cd ~/projects/frontend && claude

# Auto-named as "backend-develop"
cd ~/projects/backend && claude
```

Or set a custom name:

```bash
CLAUDE_SESSION_CHAT_NAME=designer claude
```

## Usage

Just talk naturally:

- "What sessions are running?" → calls `list_sessions`
- "Ask backend if the API is ready" → calls `send_message`
- "Any new messages?" → calls `read_messages`
- "Rename this session to designer" → calls `rename_session`

Messages are automatically detected and Claude wakes up to respond.

### Reply threading

Messages include IDs for threading. Claude can reply to a specific message, and the conversation thread is visible in `message_history`.

## Why session-chat over Agent Teams?

Claude Code has built-in [Agent Teams](https://code.claude.com/docs/en/agent-teams.md), but session-chat solves different problems:

| | session-chat | Agent Teams |
|---|---|---|
| **Model per session** | Each session can use a different model (Opus for design, Sonnet for coding, Haiku for tests) | All teammates inherit the lead's model |
| **Cross-project** | Sessions can run in different projects/directories and communicate across them | Same project scope |
| **Independence** | Fully independent sessions. Join/leave anytime | Lead controls all teammates' lifecycle |
| **Equality** | All sessions are peers, no hierarchy | Lead/teammate hierarchy |
| **Cost** | Same token cost as normal user chat per message | Each teammate maintains its own full context |
| **Transparency** | All messages visible in terminal and inspectable as JSON | Internal coordination is opaque |
| **Stability** | No experimental flags needed | Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` |

### Example: cross-project collaboration

```bash
# Terminal 1: Frontend project (auto-named "frontend-main")
cd ~/projects/frontend && claude --model sonnet
# "Ask backend-main what the /api/users response schema looks like"

# Terminal 2: Backend project (auto-named "backend-main")
cd ~/projects/backend && claude --model haiku
# Automatically receives the question and responds from its own codebase context
```

## How it works

- MCP server provides messaging tools via shared JSON files in `$TMPDIR/claude-session-chat/`
- `SessionStart` hook polls for new messages every 3 seconds with `asyncRewake`
- When a message arrives, the hook delivers content directly and marks it as read — no extra tool call needed
- `Stop` hook provides a one-shot fallback check if the poller dies
- Token cost per message equals normal user chat (2 rounds, no duplicate context reads)
- File locking prevents concurrent write corruption
- Zombie sessions are purged via PID check on every heartbeat
- Messages older than 24 hours are automatically cleaned up
- Messages to inactive sessions are delivered with a warning (not blocked)

## License

MIT
