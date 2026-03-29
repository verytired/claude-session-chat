import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// Auto-install dependencies if missing
const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(__dirname, "node_modules"))) {
  execSync("npm install --production", { cwd: __dirname, stdio: "ignore" });
}

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = await import("zod");

const DATA_DIR = path.join(os.tmpdir(), "claude-session-chat");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const MSG_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

fs.mkdirSync(DATA_DIR, { recursive: true });

// --- File locking ---
function withLock(file, fn) {
  const lockFile = `${file}.lock`;
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      try {
        return fn();
      } finally {
        try { fs.unlinkSync(lockFile); } catch {}
      }
    } catch (e) {
      if (e.code === "EEXIST") {
        // Check if lock holder is dead
        try {
          const pid = parseInt(fs.readFileSync(lockFile, "utf8"));
          process.kill(pid, 0);
        } catch {
          // Lock holder is dead, remove stale lock
          try { fs.unlinkSync(lockFile); } catch {}
          continue;
        }
        // Lock holder alive, wait
        const waitMs = 10 + Math.random() * 20;
        const end = Date.now() + waitMs;
        while (Date.now() < end) {} // busy wait (short)
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Failed to acquire lock on ${file}`);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function lockedRead(file, fallback) {
  return withLock(file, () => readJSON(file, fallback));
}
function lockedUpdate(file, fallback, fn) {
  return withLock(file, () => {
    const data = readJSON(file, fallback);
    const result = fn(data);
    writeJSON(file, result !== undefined ? result : data);
    return data;
  });
}

// --- PID check ---
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// --- Purge zombie sessions ---
function purgeZombies() {
  lockedUpdate(SESSIONS_FILE, {}, (sessions) => {
    for (const [id, v] of Object.entries(sessions)) {
      if (!isAlive(v.pid)) delete sessions[id];
    }
    return sessions;
  });
}

// --- Cleanup old messages ---
function cleanupMessages() {
  lockedUpdate(MESSAGES_FILE, [], (msgs) => {
    const cutoff = Date.now() - MSG_MAX_AGE_MS;
    return msgs.filter((m) => new Date(m.timestamp).getTime() > cutoff);
  });
}

// --- Auto-naming: env > cwd+branch ---
function autoName() {
  const cwd = process.cwd();
  const dir = path.basename(cwd);
  let branch = "";
  try {
    branch = execSync("git symbolic-ref --short HEAD 2>/dev/null", { cwd, encoding: "utf8" }).trim();
  } catch {}
  const base = branch ? `${dir}-${branch}` : dir;

  const sessions = lockedRead(SESSIONS_FILE, {});
  let name = base;
  let suffix = 2;
  while (sessions[name] && isAlive(sessions[name].pid)) {
    name = `${base}-${suffix}`;
    suffix++;
  }
  return name;
}

// Priority: env var > auto-name
let SESSION_ID = process.env.CLAUDE_SESSION_CHAT_NAME || autoName();

// Register this session
purgeZombies();
cleanupMessages();
lockedUpdate(SESSIONS_FILE, {}, (sessions) => {
  sessions[SESSION_ID] = {
    pid: process.pid,
    cwd: process.cwd(),
    started: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  return sessions;
});

// Cleanup on exit
function cleanup() {
  try {
    lockedUpdate(SESSIONS_FILE, {}, (s) => { delete s[SESSION_ID]; return s; });
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });

// Heartbeat + periodic maintenance
setInterval(() => {
  lockedUpdate(SESSIONS_FILE, {}, (s) => {
    if (s[SESSION_ID]) s[SESSION_ID].lastSeen = new Date().toISOString();
    // Purge zombies on every heartbeat
    for (const [id, v] of Object.entries(s)) {
      if (id !== SESSION_ID && !isAlive(v.pid)) delete s[id];
    }
    return s;
  });
}, 10000);

// Cleanup old messages every 5 minutes
setInterval(cleanupMessages, 5 * 60 * 1000);

const server = new McpServer({ name: "session-chat", version: "1.2.2" });

server.tool("list_sessions", "List active sessions", {}, async () => {
  const s = lockedRead(SESSIONS_FILE, {});
  const active = Object.entries(s)
    .filter(([, v]) => isAlive(v.pid))
    .map(([id, v]) => `${id === SESSION_ID ? "*" : " "}${id} ${v.cwd}`);
  return {
    content: [{ type: "text", text: active.length ? active.join("\n") : "No sessions." }],
  };
});

server.tool(
  "send_message",
  "Send message to session",
  {
    to: z.string().describe("Target session ID or 'all'"),
    message: z.string(),
  },
  async ({ to, message }) => {
    let warning = "";
    if (to !== "all") {
      const sessions = lockedRead(SESSIONS_FILE, {});
      if (!sessions[to] || !isAlive(sessions[to].pid)) {
        warning = " (inactive)";
      }
    }
    lockedUpdate(MESSAGES_FILE, [], (msgs) => {
      msgs.push({
        id: crypto.randomUUID(),
        from: SESSION_ID,
        to,
        message,
        timestamp: new Date().toISOString(),
        read: false,
      });
      return msgs;
    });
    return { content: [{ type: "text", text: `Sent${warning}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
