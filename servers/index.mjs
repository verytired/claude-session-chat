import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const DATA_DIR = path.join(os.tmpdir(), "claude-session-chat");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Register this session
const SESSION_ID = process.env.CLAUDE_SESSION_CHAT_NAME
  || `session-${crypto.randomBytes(3).toString("hex")}`;
const sessions = readJSON(SESSIONS_FILE, {});
sessions[SESSION_ID] = {
  pid: process.pid,
  cwd: process.cwd(),
  started: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
};
writeJSON(SESSIONS_FILE, sessions);

// Cleanup on exit
function cleanup() {
  try {
    const s = readJSON(SESSIONS_FILE, {});
    delete s[SESSION_ID];
    writeJSON(SESSIONS_FILE, s);
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });

// Heartbeat
setInterval(() => {
  const s = readJSON(SESSIONS_FILE, {});
  if (s[SESSION_ID]) {
    s[SESSION_ID].lastSeen = new Date().toISOString();
    writeJSON(SESSIONS_FILE, s);
  }
}, 10000);

const server = new McpServer({ name: "session-chat", version: "1.0.0" });

// List active sessions
server.tool("list_sessions", "List all active Claude Code sessions", {}, async () => {
  const s = readJSON(SESSIONS_FILE, {});
  const now = Date.now();
  const active = Object.entries(s)
    .filter(([, v]) => now - new Date(v.lastSeen).getTime() < 60000)
    .map(([id, v]) => `${id === SESSION_ID ? "* " : "  "}${id}  (cwd: ${v.cwd})`);
  return {
    content: [{
      type: "text",
      text: active.length
        ? `Active sessions (* = you):\n${active.join("\n")}`
        : "No other sessions found.",
    }],
  };
});

// Send message
server.tool(
  "send_message",
  "Send a message to another Claude Code session",
  { to: z.string().describe("Target session ID or 'all' for broadcast"), message: z.string() },
  async ({ to, message }) => {
    const msgs = readJSON(MESSAGES_FILE, []);
    msgs.push({
      id: crypto.randomUUID(),
      from: SESSION_ID,
      to,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    });
    writeJSON(MESSAGES_FILE, msgs);
    return { content: [{ type: "text", text: `Message sent to ${to}.` }] };
  }
);

// Read messages
server.tool(
  "read_messages",
  "Read unread messages for this session",
  { mark_read: z.boolean().optional().default(true).describe("Mark as read") },
  async ({ mark_read }) => {
    const msgs = readJSON(MESSAGES_FILE, []);
    const mine = msgs.filter(
      (m) => !m.read && (m.to === SESSION_ID || m.to === "all") && m.from !== SESSION_ID
    );
    if (mark_read) {
      for (const m of mine) m.read = true;
      writeJSON(MESSAGES_FILE, msgs);
    }
    if (!mine.length) return { content: [{ type: "text", text: "No new messages." }] };
    const text = mine
      .map((m) => `[${m.timestamp}] ${m.from}: ${m.message}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

// Read all message history
server.tool(
  "message_history",
  "Read full message history (including read messages)",
  { limit: z.number().optional().default(20) },
  async ({ limit }) => {
    const msgs = readJSON(MESSAGES_FILE, []);
    const relevant = msgs
      .filter((m) => m.from === SESSION_ID || m.to === SESSION_ID || m.to === "all")
      .slice(-limit);
    if (!relevant.length) return { content: [{ type: "text", text: "No message history." }] };
    const text = relevant
      .map((m) => `[${m.timestamp}] ${m.from} → ${m.to}: ${m.message}${m.read ? "" : " (unread)"}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
