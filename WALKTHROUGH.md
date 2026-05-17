# Claude Code Always-On: Student Walkthrough

**Build a 24/7 AI assistant that lives in your pocket.**

This guide walks you through building a Telegram bot that relays messages to Claude Code CLI running in headless mode. Unlike a simple chatbot that calls an API, this system gives your bot access to real tools -- it can read files, write code, run shell commands, and manage goals on your behalf. By the end, you will have a production-grade personal assistant running as a macOS daemon with semantic memory backed by PostgreSQL and pgvector.

---

## Table of Contents

- [Part 0: Prerequisites and Setup](#part-0-prerequisites-and-setup)
- [Part 1: Understanding the Architecture](#part-1-understanding-the-architecture)
- [Part 2: Building the Bot Foundation](#part-2-building-the-bot-foundation)
- [Part 3: The Claude Code Relay](#part-3-the-claude-code-relay)
- [Part 4: Database and Semantic Memory](#part-4-database-and-semantic-memory)
- [Part 5: Multi-Modal Input](#part-5-multi-modal-input)
- [Part 6: Goal Tracking and Proactive Features](#part-6-goal-tracking-and-proactive-features)
- [Part 7: Monitoring and Production](#part-7-monitoring-and-production)
- [Part 8: Security Hardening](#part-8-security-hardening)
- [Part 9: Voice Integration](#part-9-voice-integration)
- [Part 10: Project File Map and Review](#part-10-project-file-map-and-review)
- [Part 11: Conversation Context and Memory](#part-11-conversation-context-and-memory)
- [Part 12: Natural Language Commands](#part-12-natural-language-commands)
- [Part 13: Enhanced Proactive Intelligence](#part-13-enhanced-proactive-intelligence)
- [Part 14: Running as a macOS Daemon](#part-14-running-as-a-macos-daemon)
- [Appendix: Challenge Exercises](#appendix-challenge-exercises)

---

## Part 0: Prerequisites and Setup

### What You Will Build

You are building a system with three layers:

1. **Telegram Bot** -- A Grammy-powered bot that accepts text, photos, voice notes, documents, and video from your phone.
2. **Claude Code Relay** -- A process manager that spawns the Claude Code CLI in headless mode, giving the AI access to bash, file read, and file write tools.
3. **Semantic Memory** -- A Supabase (PostgreSQL + pgvector) backend that stores conversation history, user goals, and facts as vector embeddings for intelligent retrieval.

When you send a message from Telegram, it flows through authentication middleware, gets routed to the relay, Claude Code processes it (potentially running commands or reading files), and the response comes back to your phone. All of this runs as a macOS `launchd` daemon that auto-restarts on crash.

### Prerequisites

Before you begin, make sure you have the following installed and configured:

| Tool | Version | Why |
|------|---------|-----|
| **Bun** | >= 1.0 | Runtime and package manager. TypeScript-native, fast startup, built-in `.env` loading. |
| **Claude Code CLI** | Latest | The `claude` command must be available in your PATH. Install via `npm install -g @anthropic-ai/claude-code`. |
| **Telegram account** | Any | You need a Telegram account to create a bot via @BotFather. |
| **Supabase account** | Free tier | PostgreSQL database with pgvector extension for semantic search. |
| **OpenAI API key** | Any | For generating text embeddings (text-embedding-3-large model). |

Check your installations:

```bash
bun --version       # Should print 1.x.x
claude --version    # Should print claude-code version
```

### Creating the Project Structure

```bash
mkdir claude-code-always-on
cd claude-code-always-on

# Initialize a Bun project
bun init

# Install dependencies
bun add grammy @supabase/supabase-js dotenv
bun add -d @types/bun @types/node
```

**Why these dependencies?**

- `grammy` -- The Grammy framework for Telegram bots. It is TypeScript-first, supports middleware composition, and has excellent documentation.
- `@supabase/supabase-js` -- Official Supabase client for database operations including vector search via RPC calls.
- `dotenv` -- Included for compatibility, but Bun actually loads `.env` files automatically. We include it so the project works if someone runs it with Node.js.

Create the directory structure:

```bash
mkdir -p src/middleware src/database src/services scripts supabase/migrations logs tmp
```

Your project tree should look like this:

```
claude-code-always-on/
  src/
    index.ts              # Entry point
    bot.ts                # Telegram bot handlers
    relay.ts              # Claude Code CLI relay
    middleware/
      auth.ts             # User whitelist authentication
      parser.ts           # Multi-modal message parsing
      security.ts         # Input validation and safety
    database/
      supabase.ts         # Supabase client setup
      client.ts           # High-level database client
      messages.ts         # Message CRUD operations
      goals.ts            # Goal CRUD operations
      user-facts.ts       # User facts CRUD operations
      index.ts            # Database exports
    services/
      logger.ts           # Structured JSON logging
      cost-tracker.ts     # API cost estimation
      goals.ts            # Goal detection via Claude
      proactive.ts        # Proactive check-in service
      embeddings.ts       # OpenAI embedding generation
      memory.ts           # Voice context memory
      voice.ts            # ElevenLabs + Twilio voice
      twilio-webhook.ts   # Twilio webhook handlers
      heartbeat.service.ts# Heartbeat for launchd
      context-builder.ts  # System prompt + conversation memory assembly
      nlp-commands.ts     # Local NLP command handling (remind, note, search)
  scripts/
    start-bot.sh          # Startup script for launchd
    install-service.sh    # Service installer
  supabase/
    migrations/
      001_initial_schema.sql
  .env.example
  .gitignore
  package.json
  tsconfig.json
  com.claudecode.bot.plist
```

### Environment Configuration

Copy the example and fill in your values:

```bash
cp .env.example .env
```

At minimum, you need:

```env
# REQUIRED
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=your_user_id_here
CLAUDE_TIMEOUT=300000

# OPTIONAL (for memory features)
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key_here
VOYAGE_API_KEY=your_voyage_api_key_here

# OPTIONAL (for monitoring)
LOG_LEVEL=info
```

**How to get your Telegram Bot Token:**

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts to name your bot.
3. Copy the token BotFather gives you.

**How to find your Telegram User ID:**

1. Send any message to your new bot.
2. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser.
3. Find `"from":{"id":123456789}` in the JSON response -- that number is your user ID.

> **Checkpoint 0:** Can you run `bun --version` and `claude --version` successfully? Do you have a Telegram bot token from @BotFather?

---

## Part 1: Understanding the Architecture

### Why Telegram?

We chose Telegram over other messaging platforms for several practical reasons:

1. **Mobile-first** -- Telegram works on iOS, Android, desktop, and web. Your AI assistant is always in your pocket.
2. **Rich Bot API** -- Telegram's Bot API supports text, photos, voice notes, documents, videos, inline keyboards, and more. Grammy wraps this API cleanly.
3. **No approval process** -- Unlike WhatsApp Business API or iMessage, you can create a Telegram bot instantly via @BotFather with zero gatekeeping.
4. **Free** -- No per-message costs from Telegram's side.
5. **Privacy** -- You control who can access your bot via a user ID whitelist. No data goes through third-party services beyond Telegram itself.

### Why Bun?

Bun is our runtime instead of Node.js because:

1. **TypeScript-native** -- Bun runs `.ts` files directly. No `tsc` compilation step, no `ts-node` wrapper.
2. **Built-in `.env` loading** -- Bun reads `.env` files automatically. No `dotenv.config()` call needed.
3. **Fast startup** -- Bun starts in under 50ms compared to Node's 200-400ms. This matters for a daemon that may restart frequently.
4. **Web-standard APIs** -- Bun uses `ReadableStream`, `fetch`, and `Response` natively. This is important because the Claude Code relay reads stdout via `ReadableStream.getReader()`, not Node's `stream.on("data")`.

### Why Claude Code CLI in Headless Mode?

This is the most important architectural decision in the project. We do NOT call the Anthropic API directly. Instead, we spawn the `claude` CLI process with the `-p` (prompt) flag and `--output-format json`.

**Why does this matter?**

When you call the Anthropic API directly (via `fetch` to `https://api.anthropic.com/v1/messages`), you get a language model that can only generate text. It cannot:

- Read files on your machine
- Run shell commands
- Write files
- Search the web

When you use Claude Code CLI in headless mode, you get all of those tools. The CLI handles tool execution internally. Your bot sends a prompt, the CLI may invoke `bash`, `read`, or `write` tools as needed, and then returns the final result.

```bash
# Direct API call = text generation only
curl https://api.anthropic.com/v1/messages ...

# Claude Code CLI = text generation + tool use
claude -p "List all TypeScript files in src/" --output-format json --allowedTools "bash,read"
```

This is the "killer feature" of this project. Your Telegram bot effectively has access to your entire development environment.

### Architecture Diagram

```
                                 +------------------+
                                 |    Your Phone    |
                                 |   (Telegram App) |
                                 +--------+---------+
                                          |
                                          | HTTPS
                                          v
                                 +------------------+
                                 |  Telegram Servers |
                                 +--------+---------+
                                          |
                          Long Polling or Webhook
                                          v
+-------------------------------------------------------------------------+
|                        Your Machine (macOS)                             |
|                                                                         |
|  +-----------------+     +-----------------+     +------------------+   |
|  |   src/index.ts  |---->|   src/bot.ts    |---->| src/relay.ts     |   |
|  |   (Entry Point) |     | (Grammy Bot)    |     | (CLI Spawner)    |   |
|  +-----------------+     +--------+--------+     +--------+---------+   |
|                                   |                       |             |
|                          +--------+--------+     +--------v---------+   |
|                          | src/middleware/  |     |   claude CLI     |   |
|                          | auth.ts         |     |   (headless)     |   |
|                          | parser.ts       |     |   -p "prompt"    |   |
|                          | security.ts     |     |   --output json  |   |
|                          +-----------------+     +------------------+   |
|                                                                         |
|  +--------------------+     +--------------------+                      |
|  | src/database/      |     | src/services/      |                      |
|  | supabase.ts        |<--->| goals.ts           |                      |
|  | messages.ts        |     | proactive.ts       |                      |
|  | goals.ts           |     | embeddings.ts      |                      |
|  | user-facts.ts      |     | cost-tracker.ts    |                      |
|  +--------+-----------+     | logger.ts          |                      |
|           |                 +--------------------+                      |
|           v                                                             |
|  +--------------------+                                                 |
|  | Supabase (Cloud)   |                                                 |
|  | PostgreSQL +       |                                                 |
|  | pgvector           |                                                 |
|  +--------------------+                                                 |
+-------------------------------------------------------------------------+
```

### Data Flow: What Happens When You Send a Message

1. You type "What files are in my src directory?" in Telegram.
2. Telegram servers forward the message to your bot via long polling.
3. `src/bot.ts` receives the update. Grammy's middleware chain fires.
4. `auth.ts` checks if your Telegram user ID is in the `ALLOWED_USER_IDS` whitelist. If not, the chain terminates with "not authorized."
5. `parser.ts` determines the message type (text, photo, voice, document, video) and extracts content.
6. The bot sends a "Thinking..." placeholder message to Telegram so you see immediate feedback.
7. `relay.ts` spawns `claude -p "What files are in my src directory?" --output-format json --allowedTools "bash,read,write"`.
8. Claude Code internally uses the `bash` tool to run `ls src/`, then returns the result as JSON.
9. `relay.ts` parses the JSON output, extracts the `result` field, truncates it to fit Telegram's 4096-character limit.
10. The bot deletes the "Thinking..." message and sends the actual response.
11. In the background, goal detection runs asynchronously to check if the message contained any trackable goals.

> **Checkpoint 1:** In your own words, explain why spawning the Claude Code CLI is more powerful than calling the Anthropic API directly. What tools does the CLI provide that the API does not?

---

## Part 2: Building the Bot Foundation

### Step 1: The Entry Point (src/index.ts)

The entry point is responsible for:
- Validating environment variables
- Starting the bot in either polling or webhook mode
- Setting up graceful shutdown handlers
- Starting ancillary services (heartbeat, proactive check-ins)

```typescript
// src/index.ts
// Application entry point for Claude Code Always-On

// Bun auto-loads .env, no dotenv needed

import { bot, handleWebhookUpdate } from "./bot.js";
import { startHeartbeat, stopHeartbeat } from "./services/heartbeat.service.js";
import { getProactiveService } from "./services/proactive.js";
import { createLogger } from "./services/logger.js";
import { getGlobalStats } from "./services/cost-tracker.js";

const log = createLogger("index");

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_MODE = process.env.BOT_MODE || "polling";
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "3000", 10);
```

**Why polling mode by default?** Long polling is simpler for development. Your bot repeatedly asks Telegram "any new messages?" over HTTPS. No public URL or SSL certificate needed. For production, webhook mode is more efficient -- Telegram pushes updates to your server.

**Graceful shutdown** is critical for a daemon. When macOS sends `SIGTERM` (e.g., during restart), we need to:
1. Stop accepting new messages
2. Finish processing in-flight requests
3. Stop the heartbeat service
4. Exit cleanly

```typescript
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log.warn("Shutdown already in progress, ignoring signal");
    return;
  }

  isShuttingDown = true;
  log.info("Shutting down gracefully", { signal });

  const shutdownTimeout = setTimeout(() => {
    log.error("Shutdown timeout reached, forcing exit");
    process.exit(1);
  }, 10000);

  try {
    const proactiveService = getProactiveService();
    proactiveService.stop();

    stopHeartbeat();
    await bot.stop();

    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
```

The `isShuttingDown` guard prevents double-shutdown if multiple signals arrive. The 10-second timeout ensures the process dies even if something hangs.

**The health endpoint** returns JSON with uptime, cost, and error stats when you `GET /health`:

```typescript
function buildHealthResponse(): Response {
  const stats = getGlobalStats();
  const uptimeSec = Math.floor(stats.uptimeMs / 1000);
  const body = {
    status: "ok",
    uptime: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    totalInvocations: stats.totalInvocations,
    totalTokens: stats.totalTokens,
    estimatedCost: `$${stats.totalCost.toFixed(4)}`,
    recentErrors: stats.recentErrors,
  };
  return Response.json(body, { status: 200 });
}
```

### Step 2: The Grammy Bot (src/bot.ts)

Grammy is a Telegram bot framework for TypeScript. Its design is based on middleware composition -- the same pattern used by Express.js and Koa.

```typescript
// src/bot.ts
import { Bot } from "grammy";
import { requireAuth } from "./middleware/auth.js";
import { parseMessage, MessageType } from "./middleware/parser.js";
import { invokeClaudeCode } from "./relay.js";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN environment variable is not set");
  process.exit(1);
}

export const bot = new Bot(token);

// Apply authentication middleware to ALL handlers
bot.use(requireAuth);
```

**The middleware pattern:** `bot.use(requireAuth)` means every incoming update passes through `requireAuth` before reaching any command or message handler. If `requireAuth` does not call `next()`, the chain stops. This is how we enforce authentication globally.

**Command handlers** respond to `/start`, `/help`, `/status`, `/goals`, and `/costs`:

```typescript
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to Claude Code Always-On!\n\n" +
    "I'm your personal AI assistant powered by Claude Code.\n\n" +
    "Commands:\n" +
    "/start - Show this welcome message\n" +
    "/help - Show available commands\n" +
    "/status - Check bot status\n\n" +
    "Just send me a message and I'll help you out!",
    { parse_mode: "Markdown" }
  );
});

bot.command("status", async (ctx) => {
  const uptime = process.uptime();
  const uptimeStr = formatUptime(uptime);

  await ctx.reply(
    `Status: Online\n` +
    `Uptime: ${uptimeStr}\n` +
    `User: @${ctx.from?.username || "N/A"}\n` +
    `User ID: ${ctx.from?.id}`,
    { parse_mode: "Markdown" }
  );
});
```

**The text message handler** is where the real work happens:

```typescript
bot.on("message:text", async (ctx) => {
  const parsed = parseMessage(ctx);
  if (!parsed || parsed.type !== MessageType.TEXT) return;

  // Send "thinking" indicator
  const thinkingMsg = await ctx.reply("Thinking...");

  // Invoke Claude Code relay
  const response = await invokeClaudeCode({
    prompt: parsed.content,
    allowedTools: ["bash", "read", "write"],
    timeout: 120000,
    maxOutputLength: 3500
  });

  // Delete the thinking message
  await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

  if (response.success && response.output) {
    // Try Markdown first, fall back to plain text
    try {
      await ctx.reply(response.output, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(response.output);
    }
  } else {
    await ctx.reply(`Error: ${response.error || "Unknown error occurred"}`);
  }
});
```

**Why the Markdown try/catch?** Claude Code may return output with backticks, asterisks, or other characters that conflict with Telegram's Markdown parser. If `parse_mode: "Markdown"` fails, we send the message as plain text rather than losing the response entirely. This is a defensive pattern you will see throughout the codebase.

### Step 3: Authentication Middleware (src/middleware/auth.ts)

Security starts at the perimeter. Our bot should only respond to authorized users.

```typescript
// src/middleware/auth.ts
import { Context } from "grammy";

function parseAllowedUserIds(): Set<number> {
  const envVar = process.env.ALLOWED_USER_IDS;

  if (!envVar) {
    console.warn("[auth] ALLOWED_USER_IDS not set - no users will be authorized");
    return new Set<number>();
  }

  const ids = envVar
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const num = Number.parseInt(s, 10);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid user ID: "${s}"`);
      }
      return num;
    });

  return new Set(ids);
}

const ALLOWED_IDS = parseAllowedUserIds();
```

**Why a `Set`?** The `Set.has()` operation is O(1) -- constant time lookup regardless of how many users are in the whitelist. An array `.includes()` is O(n). For a personal bot with 1-3 users this does not matter, but it is a good habit. The Set is parsed once at startup and cached in module scope.

```typescript
export async function requireAuth(
  ctx: Context,
  next: () => Promise<void>,
): Promise<void> {
  if (isAuthenticated(ctx)) {
    await next();
    return;
  }

  await ctx.reply(
    `Sorry, you're not authorized to use this bot.\n` +
    `Your user ID: ${ctx.from?.id ?? "unknown"}\n` +
    `Please contact the bot owner if you believe this is an error.`,
    { parse_mode: "Markdown" },
  );
}
```

When an unauthorized user messages the bot, they see their user ID. This is intentional -- it makes it easy for the bot owner to add them to the whitelist without having to look up IDs manually.

### Step 4: Message Parser (src/middleware/parser.ts)

Telegram sends different message types with different structures. The parser normalizes them into a single `ParsedMessage` interface.

```typescript
export enum MessageType {
  TEXT = "text",
  PHOTO = "photo",
  VOICE = "voice",
  DOCUMENT = "document",
  VIDEO = "video",
}

export interface ParsedMessage {
  type: MessageType;
  content: string;          // Text body or caption
  fileId?: string;          // Telegram file ID for media
  metadata?: MessageMetadata;
}
```

**Why an enum?** The `MessageType` enum provides exhaustive type checking. If you add a new message type later, TypeScript will warn you about unhandled cases in any `switch` statements.

The parser extracts the largest photo (Telegram sends multiple resolutions), the file ID for voice notes, the filename for documents, and resolution metadata for videos:

```typescript
// PHOTO: Get the largest photo (last element in array)
if (message.photo && message.photo.length > 0) {
  const largestPhoto = message.photo[message.photo.length - 1];
  return {
    type: MessageType.PHOTO,
    content: message.caption || "",
    fileId: largestPhoto.file_id,
    metadata: {
      date: message.date,
      width: largestPhoto.width,
      height: largestPhoto.height,
    },
  };
}
```

**Why the last element?** Telegram stores photo sizes in ascending order. `message.photo[0]` is a tiny thumbnail. `message.photo[message.photo.length - 1]` is the full resolution. We always want the largest version for analysis.

### First Test

At this point, you can run the bot and test basic commands:

```bash
bun run src/index.ts
```

Open Telegram, find your bot, and send `/start`. You should see the welcome message. Send a text message and watch the "Thinking..." indicator appear, followed by a response from Claude Code.

> **Checkpoint 2:** Send `/start`, `/help`, and `/status` to your bot. Do all three commands respond correctly? Send a text message like "What is 2 + 2?" and verify you get a response from Claude Code.

---

## Part 3: The Claude Code Relay

This is the heart of the system. The relay spawns Claude Code CLI as a child process, collects its output, parses the JSON, and returns a structured response.

### Key Concept: Headless Mode

Claude Code CLI supports a headless mode that is purpose-built for programmatic usage:

```bash
claude -p "List files in the current directory" \
  --output-format json \
  --allowedTools "bash,read,write"
```

The flags mean:
- `-p "prompt"` -- Pass the prompt directly (non-interactive)
- `--output-format json` -- Return structured JSON instead of terminal-formatted text
- `--allowedTools "bash,read,write"` -- Specify which tools Claude can use

The JSON output looks like:

```json
{
  "type": "result",
  "result": "Here are the files in the current directory:\n- src/\n- package.json\n- ...",
  "usage": {
    "total_tokens": 1234
  }
}
```

**Critical detail:** The response text is in the `result` field, not `output`. This caught us during development (see Bug Journal below).

### Building src/relay.ts

The relay module defines clean TypeScript interfaces for request/response:

```typescript
export interface ClaudeCodeRequest {
  prompt: string;
  allowedTools?: string[];
  timeout?: number;
  stream?: boolean;
  workingDirectory?: string;
  maxOutputLength?: number;
}

export interface ClaudeCodeResponse {
  success: boolean;
  output?: string;
  error?: string;
  toolCalls?: ToolCall[];
  metadata?: {
    tokensUsed?: number;
    duration: number;
    truncated: boolean;
    exitCode: number | null;
  };
}
```

**Spawning the process with Bun:**

```typescript
export async function invokeClaudeCode(
  request: ClaudeCodeRequest,
  streamCallback?: StreamCallback
): Promise<ClaudeCodeResponse> {
  const startTime = Date.now();
  const timeout = request.timeout ?? 300000; // 5 minutes default
  const maxOutputLength = request.maxOutputLength ?? 3500;

  // Build command arguments
  const args: string[] = [
    "-p", request.prompt,
    "--output-format", "json",
  ];

  if (request.allowedTools && request.allowedTools.length > 0) {
    args.push("--allowedTools", request.allowedTools.join(","));
  }

  // Spawn the process
  const proc = Bun.spawn(["claude", ...args], {
    cwd: request.workingDirectory || process.cwd(),
    stdout: "pipe",
    stderr: "pipe"
  });
```

**Reading stdout with Bun's ReadableStream:**

This is where a common bug lives. Bun uses Web ReadableStream, not Node.js streams. You must use `.getReader()`:

```typescript
  const stdout = proc.stdout;
  const decoder = new TextDecoder();
  const reader = stdout.getReader();   // NOT stdout.on("data", ...)

  let outputBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    outputBuffer += decoder.decode(value);
  }
```

**Timeout handling with Promise.race:**

```typescript
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      proc.kill();
      reject(new Error(`Claude Code timed out after ${timeout}ms`));
    }, timeout);
  });

  const result = await Promise.race([outputPromise, timeoutPromise]);
```

`Promise.race` returns whichever promise settles first. If the output collection finishes before the timeout, we get the result. If the timeout fires first, we kill the process and return an error. The process is killed via `proc.kill()` to prevent zombie processes.

**JSON output parsing:**

```typescript
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(result.output);
  } catch {
    // Not JSON, return raw output
    return { success: true, output: result.output, ... };
  }

  // Extract response from parsed JSON
  // Claude Code CLI returns: { type: "result", result: "...", usage: {...} }
  const obj = parsedOutput as Record<string, unknown>;
  let outputText = (obj.result ?? obj.output ?? obj.response ?? "") as string;
```

**Why try multiple fields?** The CLI output format may vary across versions. We check `result` first (the current format), then fall back to `output`, `response`, `text`, `message`, and `content`. This makes the relay resilient to format changes.

**Output truncation for Telegram:**

Telegram messages have a 4096 character limit. We truncate intelligently:

```typescript
function truncateOutput(
  text: string,
  maxLength: number
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  const truncated = text.substring(0, maxLength - 20);

  // Try to cut at a sentence boundary
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");
  const cutoff = Math.max(lastPeriod, lastNewline);

  if (cutoff > maxLength * 0.5) {
    return {
      text: truncated.substring(0, cutoff + 1) + "\n\n_... (output truncated)_",
      truncated: true
    };
  }

  return {
    text: truncated + "\n\n_... (output truncated)_",
    truncated: true
  };
}
```

We prefer cutting at sentence boundaries (`.` or `\n`) so the output reads naturally rather than stopping mid-word.

### Bug Journal

These are real bugs encountered during development. Documenting them helps you understand why certain design decisions were made.

**Bug 1: `reader.read is not a function`**

- **Symptom:** Crash on first message with `TypeError: reader.read is not a function`.
- **Cause:** Initial code used `stdout.on("data", callback)` which is the Node.js stream API. Bun's `proc.stdout` returns a Web `ReadableStream`, not a Node.js `Readable`.
- **Fix:** Changed to `stdout.getReader()` and the `while (true) { const { done, value } = await reader.read(); ... }` pattern.
- **Lesson:** Always check the runtime's stream API. Bun and Node diverge here.

**Bug 2: Raw JSON sent to Telegram**

- **Symptom:** User received `{"type":"result","result":"Here are the files..."}` instead of just the text.
- **Cause:** The relay was returning the entire JSON blob. Claude Code CLI returns `{ type: "result", result: "..." }`, but the code was looking for an `output` field.
- **Fix:** Added `obj.result` as the first field to check when extracting the response text.
- **Lesson:** Always log raw output during development to understand the actual format.

**Bug 3: Telegram Markdown parse failure**

- **Symptom:** `Bad Request: can't parse entities: Can't find end of the entity...` error, message never delivered.
- **Cause:** Claude Code output contained unbalanced markdown characters (e.g., a single `*` or unclosed backticks) that Telegram's Markdown parser rejected.
- **Fix:** Wrapped every `ctx.reply(..., { parse_mode: "Markdown" })` in a try/catch that falls back to plain text.
- **Lesson:** Never trust external output to be valid Markdown. Always have a plain text fallback.

**Bug 4: Permission denied for /tmp files**

- **Symptom:** When the bot downloaded a photo and saved it to `/tmp/`, Claude Code could not read it due to macOS sandbox restrictions.
- **Cause:** Claude Code CLI runs with its own permissions context. Files in `/tmp/` may not be accessible depending on the system configuration.
- **Fix:** Changed download directory to the project's own `tmp/` directory (`import.meta.url` relative path).
- **Lesson:** Save files within the project directory tree where Claude Code has guaranteed access.

> **Checkpoint 3:** Send your bot a message like "What is the current directory?" and verify Claude Code processes it. Check the console output for the JSON response. Do you see the `result` field?

---

## Part 4: Database and Semantic Memory

### Why Supabase?

We need a database that supports:
1. **Standard SQL** for CRUD operations on messages, goals, and facts
2. **Vector similarity search** for semantic memory (finding relevant past conversations)
3. **Free tier** for development
4. **REST API** for easy access from TypeScript

Supabase provides all four. It is PostgreSQL with the `pgvector` extension pre-installed, plus a JavaScript client that wraps the REST API.

### Setting Up the Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. From your project's Settings > API, copy:
   - **Project URL** (goes in `SUPABASE_URL`)
   - **Service Role Key** (goes in `SUPABASE_SERVICE_ROLE_KEY`)
3. The anon key is also available but the service role key bypasses Row Level Security, which is what we need for server-side operations.

### Database Schema Design

The migration file (`supabase/migrations/001_initial_schema.sql`) creates four tables:

**messages** -- Conversation history with embeddings:

```sql
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL,
  telegram_message_id BIGINT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- This is the key column: a 3072-dimensional vector
  embedding vector(3072),

  -- Optional metadata JSON
  metadata JSONB DEFAULT '{}'::jsonb
);
```

**Why `vector(3072)`?** We use OpenAI's `text-embedding-3-large` model which produces 3072-dimensional vectors. These vectors encode the semantic meaning of text. Two messages about similar topics will have vectors that are close together in 3072-dimensional space. `pgvector` can efficiently search these vectors using cosine distance.

**goals** -- User goals with priority and category:

```sql
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  category TEXT,
  embedding vector(3072),
  metadata JSONB DEFAULT '{}'::jsonb
);
```

**user_facts** -- Facts about users for personalization:

```sql
CREATE TABLE IF NOT EXISTS user_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL,
  fact_type TEXT NOT NULL,   -- 'preference', 'context', 'relationship', 'habit'
  fact_text TEXT NOT NULL,
  confidence INTEGER DEFAULT 5 CHECK (confidence BETWEEN 1 AND 10),
  source TEXT,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INTEGER DEFAULT 0,
  embedding vector(3072),

  UNIQUE (telegram_user_id, fact_type, fact_text)
);
```

**Why confidence scoring?** Not all facts are equally reliable. A fact stated directly by the user ("I'm a Python developer") gets confidence 9-10. A fact inferred from context ("user seems to prefer morning meetings") gets confidence 5-6. Lower-confidence facts can be deprioritized or eventually pruned.

**conversation_contexts** -- Session tracking:

```sql
CREATE TABLE IF NOT EXISTS conversation_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL,
  session_id TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  summary TEXT,
  summary_embedding vector(3072),
  message_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,

  UNIQUE (telegram_user_id, session_id)
);
```

### HNSW Indexes for Fast Vector Search

```sql
CREATE INDEX idx_messages_embedding ON messages
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**HNSW** (Hierarchical Navigable Small World) is a graph-based index that makes approximate nearest neighbor search fast. Without it, every search would require comparing against every vector in the table (O(n)). With HNSW, searches are approximately O(log n).

The parameters:
- `m = 16` -- Maximum number of connections per node in the graph. Higher = more accurate but more memory.
- `ef_construction = 64` -- Size of the dynamic candidate list during index building. Higher = more accurate index but slower construction.

### Search Functions

The schema includes three PostgreSQL functions for semantic search:

```sql
CREATE OR REPLACE FUNCTION search_similar_messages(
  query_embedding vector(3072),
  target_user_id BIGINT DEFAULT NULL,
  limit_count INTEGER DEFAULT 10,
  similarity_threshold REAL DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  telegram_user_id BIGINT,
  role TEXT,
  content TEXT,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.telegram_user_id, m.role, m.content,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM messages m
  WHERE
    m.embedding IS NOT NULL
    AND (target_user_id IS NULL OR m.telegram_user_id = target_user_id)
    AND (1 - (m.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**How cosine distance works:** The `<=>` operator computes cosine distance between two vectors. Cosine distance = 1 - cosine similarity. A cosine similarity of 1.0 means identical vectors (identical meaning). A similarity of 0.0 means completely unrelated. We filter with a threshold of 0.7, meaning we only return results that are at least 70% similar.

Similar functions exist for `search_relevant_goals` and `search_relevant_facts`, each with their own default thresholds.

### Row Level Security

```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
ON messages FOR SELECT
USING (telegram_user_id = current_setting('app.current_user_id', true)::BIGINT);
```

**RLS** ensures that even if there is a bug in the application layer, one user cannot accidentally access another user's data. The `current_setting('app.current_user_id')` is set per-request by the application.

### The Database Client (src/database/client.ts)

The `DatabaseClient` class combines Supabase operations with embedding generation:

```typescript
export class DatabaseClient {
  private supabase: SupabaseClient;
  private embeddingConfig: EmbeddingConfig;

  async storeUserMessage(
    userId: number,
    content: string,
  ): Promise<MessageRow | null> {
    // Generate embedding, then store
    const embedding = await generateEmbedding(content, this.embeddingConfig);
    return storeMessage(this.supabase, userId, "user", content, embedding);
  }

  async getQueryContext(
    userId: number,
    query: string,
  ): Promise<QueryContext> {
    const queryEmbedding = await generateEmbedding(query, this.embeddingConfig);

    // Search for similar content in parallel
    const [relevantMessages, relevantGoals, relevantFacts, userFacts] =
      await Promise.all([
        searchSimilarMessages(this.supabase, queryEmbedding, userId),
        searchRelevantGoals(this.supabase, queryEmbedding, userId),
        searchRelevantFacts(this.supabase, queryEmbedding, userId),
        getUserFacts(this.supabase, userId),
      ]);

    return { conversation, relevantMessages, relevantGoals, relevantFacts, userFacts };
  }
}
```

**Why `Promise.all`?** The four search queries are independent -- they do not depend on each other's results. Running them in parallel with `Promise.all` means the total time is the maximum of the four, not the sum.

### Embeddings Integration (src/services/embeddings.ts)

The embeddings service calls the OpenAI API to convert text into vectors:

```typescript
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const response = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-large",
      input: text,
      encoding_format: "float",
    }),
  });

  const data: OpenAIEmbeddingResponse = await response.json();
  return data.data[0].embedding;
}
```

**Batch embedding** is more efficient for multiple texts:

```typescript
export async function generateEmbeddings(
  texts: string[],
  config: EmbeddingConfig,
): Promise<number[][]> {
  const response = await fetch(`${baseURL}/embeddings`, {
    body: JSON.stringify({
      model: "text-embedding-3-large",
      input: texts,  // Array of strings
      encoding_format: "float",
    }),
  });

  const data: OpenAIEmbeddingResponse = await response.json();
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
}
```

**Why sort by index?** The OpenAI API does not guarantee that results come back in the same order as the input. Each result has an `index` field. We sort by index to ensure the embeddings array aligns with the input texts array.

The module also includes a `cosineSimilarity` function for local similarity computation without a database query:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

> **Checkpoint 4:** Run the migration SQL against your Supabase project via the SQL editor. Verify the four tables exist. Can you insert a test message and query it back?

---

## Part 5: Multi-Modal Input

The bot handles five message types: text, photos, documents, voice notes, and video. Each requires different download and processing strategies.

### Handling Photos

When a user sends a photo, we need to:
1. Get the file ID from Telegram
2. Download the photo to a local directory
3. Pass the file path to Claude Code so it can read/analyze the image

```typescript
// In src/bot.ts
bot.on("message:photo", async (ctx) => {
  const parsed = parseMessage(ctx);
  if (!parsed || parsed.type !== MessageType.PHOTO || !parsed.fileId) return;

  const thinkingMsg = await ctx.reply("Analyzing image...");

  // Download the photo
  const localPath = await downloadTelegramFile(parsed.fileId);

  const prompt = `The user sent this photo. The image has been saved to ${localPath}. ` +
    `Please analyze the image and describe what you see.`;

  const response = await invokeClaudeCode({
    prompt,
    allowedTools: ["bash", "read"],
    timeout: 120000,
    maxOutputLength: 3500
  });

  await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
  // ... send response
});
```

**The `downloadTelegramFile` helper:**

```typescript
async function downloadTelegramFile(
  fileId: string,
  filename?: string
): Promise<string> {
  // Get file path from Telegram
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file path");
  }

  // Download from Telegram's file API
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  // Save to project's tmp/ directory (NOT /tmp/)
  const ext = file.file_path.split(".").pop() || "bin";
  const localName = filename || `telegram_${fileId.substring(0, 12)}.${ext}`;
  const tmpDir = new URL("../tmp", import.meta.url).pathname;
  const localPath = `${tmpDir}/${localName}`;

  await Bun.write(localPath, buffer);
  return localPath;
}
```

**Why save to the project directory?** As noted in the Bug Journal, Claude Code may not have permission to read from `/tmp/` depending on macOS sandbox settings. By saving to the project's own `tmp/` directory, we guarantee Claude Code can access the file.

**Why `import.meta.url`?** This gives us the absolute path to the current module. `new URL("../tmp", import.meta.url).pathname` resolves to the project root's `tmp/` directory regardless of the current working directory.

### Handling Documents

Documents require different processing depending on whether they are text-based or binary:

```typescript
bot.on("message:document", async (ctx) => {
  const parsed = parseMessage(ctx);
  const localPath = await downloadTelegramFile(parsed.fileId, fileName);

  // Try to read as text
  const textContent = await readTextFile(localPath);

  if (textContent) {
    // Text file: pass content directly to Claude
    prompt = `The user sent "${fileName}". Here is the content:\n\n${textContent}`;
  } else {
    // Binary file: just acknowledge and describe
    prompt = `The user sent a binary file "${fileName}". Saved to ${localPath}.`;
  }
});
```

**Text file detection** uses a whitelist of extensions:

```typescript
async function readTextFile(filePath: string): Promise<string | null> {
  const textExtensions = [
    ".txt", ".md", ".json", ".csv", ".py", ".ts", ".js", ".jsx", ".tsx",
    ".html", ".css", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bash", ".zsh", ".sql", ".rb", ".go", ".rs", ".java",
    ".c", ".cpp", ".h", ".hpp", ".swift", ".kt", ".r", ".lua", ".log"
  ];

  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  if (!textExtensions.includes(ext)) {
    return null;
  }

  try {
    const file = Bun.file(filePath);
    return await file.text();
  } catch {
    return null;
  }
}
```

### Handling Voice Notes

Voice notes are `.ogg` files. Full transcription requires a speech-to-text service (like Whisper API), which is not yet integrated:

```typescript
bot.on("message:voice", async (ctx) => {
  const localPath = await downloadTelegramFile(
    parsed.fileId,
    `voice_${Date.now()}.ogg`
  );

  await ctx.reply(
    `Voice note received and saved\n` +
    `Duration: ${duration} seconds\n` +
    `File: ${localPath}\n\n` +
    `Transcription requires Whisper API integration (not yet configured).`,
    { parse_mode: "Markdown" }
  );
});
```

### Handling Video

Video files receive metadata-based processing:

```typescript
bot.on("message:video", async (ctx) => {
  const localPath = await downloadTelegramFile(
    parsed.fileId,
    `video_${Date.now()}.mp4`
  );

  const prompt = `The user sent a video.\n` +
    `Duration: ${duration} seconds\n` +
    `Resolution: ${width}x${height}\n` +
    `Size: ${fileSize}\n` +
    `Saved to: ${localPath}`;

  const response = await invokeClaudeCode({ prompt, ... });
});
```

### The "Thinking Message" Pattern

Every handler follows this pattern:
1. Send a "thinking" message immediately (fast feedback for the user)
2. Process the request (may take seconds to minutes)
3. Delete the thinking message
4. Send the actual response

```typescript
const thinkingMsg = await ctx.reply("Processing...");
// ... long operation ...
await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
await ctx.reply(result);
```

This prevents the user from wondering if the bot received their message. The thinking indicator appears within 100ms, even if the actual response takes 30 seconds.

> **Checkpoint 5:** Send your bot a photo, a text file, and a voice note. Does each type get handled correctly? Check the `tmp/` directory -- do you see the downloaded files?

---

## Part 6: Goal Tracking and Proactive Features

### Goal Detection from Natural Language

The goal service uses Claude Code itself to parse natural language and detect goals:

```typescript
// src/services/goals.ts

const GOAL_DETECTION_PROMPT = `Analyze the following user message and extract any goals.

For each goal found, return a JSON array with objects containing:
- "description": A clear description of the goal
- "deadline": ISO 8601 format if mentioned, or null
- "priority": 1-10 based on urgency (default 5)
- "category": "personal", "work", "health", etc., or null

If no goals found, return: []

Do NOT detect goals from:
- Questions about existing goals
- General conversation or greetings
- Past tense statements about completed tasks

Return ONLY the JSON array, no other text.

User message: "MESSAGE_CONTENT"`;
```

**Why use Claude Code for detection?** Regular expressions and keyword matching would miss nuanced goal statements. "I need to finish the report by Friday" is a goal. "Remember when I finished that report?" is not. Claude Code understands this difference.

```typescript
export class GoalService {
  async detectGoals(message: string): Promise<DetectedGoal[]> {
    // Skip very short messages or commands
    if (message.length < 5 || message.startsWith("/")) {
      return [];
    }

    const response = await invokeClaudeCode({
      prompt: GOAL_DETECTION_PROMPT
        .replace("CURRENT_DATE", new Date().toISOString())
        .replace("MESSAGE_CONTENT", message),
      timeout: 30000,
      maxOutputLength: 2000,
    });

    return this.parseGoalResponse(response.output);
  }
```

**The JSON parsing is defensive:**

```typescript
  private parseGoalResponse(output: string): DetectedGoal[] {
    let cleaned = output.trim();

    // Strip markdown code block wrappers
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);

    // Find the JSON array in the output
    const startIdx = cleaned.indexOf("[");
    const endIdx = cleaned.lastIndexOf("]");
    if (startIdx === -1 || endIdx === -1) return [];

    const parsed = JSON.parse(cleaned.substring(startIdx, endIdx + 1));

    // Validate each entry has a description field
    return parsed
      .filter((item) => typeof item === "object" && "description" in item)
      .map((item) => ({
        description: item.description,
        deadline: typeof item.deadline === "string" ? item.deadline : null,
        priority: typeof item.priority === "number"
          ? Math.max(1, Math.min(10, item.priority))
          : 5,
        category: typeof item.category === "string" ? item.category : null,
      }));
  }
```

**Why strip markdown wrappers?** Claude sometimes wraps JSON in ` ```json ... ``` ` code blocks even when instructed not to. We handle this gracefully rather than crashing.

### Goal Lifecycle

Goals progress through three states: `active` -> `completed` -> `archived`.

The `/goals` command displays active goals with priority indicators:

```typescript
bot.command("goals", async (ctx) => {
  const goalService = getGoalService();
  const activeGoals = await goalService.getActiveGoals(userId);
  const formatted = goalService.formatGoalsList(activeGoals);
  await ctx.reply(formatted, { parse_mode: "Markdown" });
});
```

The formatting uses color-coded priority emojis:

```typescript
formatGoalsList(goals: GoalRow[]): string {
  if (goals.length === 0) {
    return "You don't have any active goals right now.";
  }

  const lines: string[] = ["Your active goals:\n"];
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    const emoji = goal.priority >= 8 ? "RED" : goal.priority >= 5 ? "YELLOW" : "GREEN";
    const category = goal.category ? ` [${goal.category}]` : "";
    lines.push(`${i + 1}. ${emoji} ${goal.title}${category}`);
  }
  return lines.join("\n");
}
```

### Proactive Check-Ins

The `ProactiveService` runs every 30 minutes and checks if any users need notifications:

```typescript
export class ProactiveService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  start(): void {
    // Run first check after 10 seconds (let bot fully initialize)
    setTimeout(() => this.checkIn().catch(console.error), 10000);

    // Then every 30 minutes
    this.intervalHandle = setInterval(() => {
      this.checkIn().catch(console.error);
    }, 30 * 60 * 1000);
  }

  async checkIn(): Promise<void> {
    const userIds = getAllowedUserIds();
    const goalService = getGoalService();

    for (const userId of userIds) {
      const activeGoals = await goalService.getActiveGoals(userId);
      if (activeGoals.length === 0) continue;

      const deadlines = await goalService.checkDeadlines();
      const userDeadlines = deadlines.filter(
        (d) => d.goal.telegram_user_id === userId
      );

      // Ask Claude Code: should we notify?
      const decision = await this.decideNotification(activeGoals, userDeadlines);

      if (decision.shouldNotify) {
        await this.sendNotification(userId, decision.message);
      }
    }
  }
```

**Why ask Claude Code to decide?** A simple rule ("notify if deadline within 30 minutes") would be too rigid. Claude Code can make nuanced decisions: "The user has 3 active goals but none are urgent -- don't bother them" vs. "This deadline is in 10 minutes and the user hasn't mentioned it today -- send a gentle reminder."

The prompt for the notification decision includes the full context:

```typescript
const NOTIFICATION_DECISION_PROMPT = `You are a helpful assistant deciding whether to notify a user.

Current time: CURRENT_TIME

Active goals:
GOALS_LIST

Approaching deadlines:
DEADLINES_LIST

Consider:
- Only notify if genuinely useful
- Don't be annoying
- Be encouraging, not nagging

Respond with ONLY a JSON object:
{ "shouldNotify": true/false, "message": "..." }`;
```

**Fallback logic:** If Claude Code is unavailable (network error, timeout), a simple fallback kicks in:

```typescript
  private fallbackDecision(deadlines: ApproachingDeadline[]): NotificationDecision {
    const urgent = deadlines.filter((d) => d.minutesUntilDeadline <= 15);

    if (urgent.length === 0) {
      return { shouldNotify: false, message: "" };
    }

    const lines = urgent.map((d) =>
      d.minutesUntilDeadline < 0
        ? `- "${d.goal.title}" is ${d.timeRemaining}`
        : `- "${d.goal.title}" has ${d.timeRemaining}`
    );

    return {
      shouldNotify: true,
      message: "Quick heads-up about your goals:\n\n" + lines.join("\n")
    };
  }
```

### Background Processing Pattern

Goal detection runs in the background so it does not slow down message responses:

```typescript
// In the text message handler
if (userId) {
  detectAndTrackGoals(userId, messageContent).catch((err) => {
    log.error("Background goal detection error", { error: String(err) });
  });
}
```

The `.catch()` ensures that goal detection errors are logged but do not crash the message handler. The user gets their response immediately; goals are tracked asynchronously.

> **Checkpoint 6:** Send your bot a message like "I need to finish my essay by tomorrow at 5pm." Then send `/goals`. Does the goal appear in the list? What priority was assigned?

---

## Part 7: Monitoring and Production

### Structured Logging

The logger produces JSON lines that can be parsed by log aggregation tools:

```typescript
// src/services/logger.ts
type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

function emit(
  level: LogLevel,
  component: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (LOG_LEVELS[level] < currentLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg, meta) => emit("debug", component, msg, meta),
    info: (msg, meta) => emit("info", component, msg, meta),
    warn: (msg, meta) => emit("warn", component, msg, meta),
    error: (msg, meta) => emit("error", component, msg, meta),
  };
}
```

**Why component-scoped loggers?** Each module creates its own logger:

```typescript
const log = createLogger("bot");    // In bot.ts
const log = createLogger("relay");  // In relay.ts
const log = createLogger("index");  // In index.ts
```

When you see a log line like `{"component":"relay","message":"Claude Code timed out"}`, you immediately know which module produced it. This is invaluable when debugging production issues.

**Why JSON logs?** JSON is machine-parseable. You can pipe logs through `jq` for filtering:

```bash
# Show only errors from the relay module
cat logs/bot-stdout.log | jq 'select(.component == "relay" and .level == "error")'
```

### Cost Tracking

The cost tracker maintains in-memory statistics per user:

```typescript
// src/services/cost-tracker.ts
export function estimateCost(tokensUsed: number): number {
  // Blended rate: ~$6 per million tokens
  // (Claude Sonnet: $3/M input + $15/M output, averaged)
  return (tokensUsed / 1_000_000) * 6;
}

export function recordCost(entry: CostEntry): void {
  entries.push(entry);
}

export function formatCostsMessage(userId: number): string {
  const stats = getUserStats(userId);
  if (stats.invocations === 0) {
    return "No usage recorded since last restart.";
  }

  return (
    "Usage Stats (this session)\n\n" +
    `Invocations: ${stats.invocations}\n` +
    `Total tokens: ${stats.totalTokens.toLocaleString()}\n` +
    `Estimated cost: $${stats.totalCost.toFixed(4)}\n`
  );
}
```

**Why in-memory?** Cost data resets on restart. For a personal bot, this is sufficient. You can see session-level costs via `/costs`. For persistent cost tracking, you would write entries to Supabase.

### Health Endpoint

When running in webhook mode, the server exposes a `/health` endpoint:

```typescript
if (req.method === "GET" && pathname === "/health") {
  return buildHealthResponse();
}
```

This returns JSON with uptime, invocation count, token usage, estimated cost, and error count. You can monitor it with any uptime service or a simple `curl`:

```bash
curl http://localhost:3000/health
```

### launchd Daemon for 24/7 Operation

On macOS, `launchd` is the system-level process manager (similar to `systemd` on Linux). The `com.claudecode.bot.plist` file tells launchd how to run the bot:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claudecode.bot</string>

    <key>ProgramArguments</key>
    <array>
        <string>/path/to/scripts/start-bot.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/path/to/claude-code-always-on</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>StandardOutPath</key>
    <string>/path/to/logs/bot-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>/path/to/logs/bot-stderr.log</string>
</dict>
</plist>
```

**Key settings:**
- `RunAtLoad: true` -- Start the bot when you log in.
- `KeepAlive.SuccessfulExit: false` -- Restart if the process exits with an error code.
- `KeepAlive.Crashed: true` -- Restart if the process crashes.
- `ThrottleInterval: 5` -- Wait 5 seconds before restarting to avoid rapid crash loops.

**The install script** (`scripts/install-service.sh`) handles the full lifecycle:

```bash
bash scripts/install-service.sh install    # Install and start
bash scripts/install-service.sh uninstall  # Stop and remove
bash scripts/install-service.sh status     # Check status
bash scripts/install-service.sh restart    # Restart
bash scripts/install-service.sh logs       # Tail logs
```

**The startup script** (`scripts/start-bot.sh`) handles pre-flight checks:

```bash
#!/bin/bash
set -euo pipefail

# Check for lock file (prevent duplicate instances)
check_lock

# Verify .env exists and token is configured
check_env

# Verify bun is installed
check_bun

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    bun install --production
fi

# Start the bot
exec bun run src/index.ts
```

The `exec` at the end replaces the shell process with the Bun process. This means the PID that launchd monitors is the actual Bun process, not a wrapper shell. If Bun crashes, launchd knows immediately.

### Heartbeat Monitoring

The heartbeat service writes a Unix timestamp to `logs/heartbeat.timestamp` every 5 minutes:

```typescript
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function updateHeartbeat(): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  await fs.writeFile(HEARTBEAT_FILE, timestamp, 'utf-8');
}

export function startHeartbeat(): void {
  updateHeartbeat();
  heartbeatTimer = setInterval(() => updateHeartbeat(), HEARTBEAT_INTERVAL);
}
```

An external monitoring script can check this file to verify the bot is alive:

```bash
# Is the heartbeat older than 10 minutes?
LAST=$(cat logs/heartbeat.timestamp)
NOW=$(date +%s)
AGE=$((NOW - LAST))
if [ $AGE -gt 600 ]; then
  echo "Bot appears to be stuck!"
fi
```

> **Checkpoint 7:** Run `bun run src/index.ts` and send `/costs` and `/status` to your bot. Install the launchd service with `bash scripts/install-service.sh install`. Verify it starts automatically after you `launchctl stop com.claudecode.bot`.

---

## Part 8: Security Hardening

### Layer 1: Authentication

The user ID whitelist (covered in Part 2) is the first line of defense. Only users in `ALLOWED_USER_IDS` can interact with the bot.

### Layer 2: Input Validation

The security module (`src/middleware/security.ts`) validates all inputs:

```typescript
export const INPUT_LIMITS = {
  MAX_TEXT_LENGTH: 4000,
  MAX_CAPTION_LENGTH: 1024,
  MAX_COMMAND_LENGTH: 100,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,  // 50MB
  MAX_CONCURRENT_REQUESTS: 10,
} as const;

export function validateStringInput(
  input: string,
  maxLength: number = INPUT_LIMITS.MAX_TEXT_LENGTH
): { isValid: boolean; error?: string } {
  if (typeof input !== "string") {
    return { isValid: false, error: "Input is not a string" };
  }
  if (input.length > maxLength) {
    return { isValid: false, error: `Input exceeds ${maxLength} characters` };
  }
  if (input.trim().length === 0) {
    return { isValid: false, error: "Input is empty" };
  }
  return { isValid: true };
}
```

### Layer 3: Dangerous Command Detection

Since Claude Code can execute shell commands, we must detect and block dangerous patterns:

```typescript
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/,       // rm -rf with absolute path
  /\bdd\s+if=/,                // dd command (disk destruction)
  /\bmkfs\./,                  // Filesystem creation
  /\bchmod\s+000/,             // Removing all permissions
  /\bshutdown\b/,              // System shutdown
  /\breboot\b/,                // System reboot
  />\s*\/\s*(dev|proc|sys)\//, // Redirect to system dirs
  /curl.*\|\s*(sh|bash)/,      // Pipe curl to shell
  /wget.*\|\s*(sh|bash)/,      // Pipe wget to shell
  /eval.*\$\(.*curl/,          // Eval with curl substitution
  /eval.*\$\(.*wget/,          // Eval with wget substitution
];

export function checkCommandSafety(
  command: string
): { isSafe: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        isSafe: false,
        reason: `Matches dangerous pattern: ${pattern.source}`,
      };
    }
  }
  return { isSafe: true };
}
```

**Why regex-based detection?** This is a heuristic, not a guarantee. It catches the most common destructive commands. A determined attacker could potentially bypass these patterns. The real safety comes from the fact that only whitelisted users can access the bot in the first place.

### Layer 4: Rate Limiting

The `RateLimiter` class prevents abuse by tracking request timestamps per user:

```typescript
export class RateLimiter {
  private requests: Map<number, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  checkLimit(userId: number): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];

    // Remove requests outside the time window
    const validRequests = userRequests.filter(
      (time) => now - time < this.windowMs
    );

    if (validRequests.length >= this.maxRequests) {
      return false;  // Rate limit exceeded
    }

    validRequests.push(now);
    this.requests.set(userId, validRequests);
    return true;
  }
}
```

**Why a sliding window?** A fixed window (e.g., "10 requests per minute starting at :00") allows burst behavior at window boundaries. A sliding window counts requests within the last N milliseconds, providing smoother rate limiting.

### Layer 5: Permission Levels

Claude Code's tool access is configurable per request:

```typescript
export enum PermissionLevel {
  READ_ONLY = "read_only",   // Can view files only
  SAFE = "safe",             // Read + search, no writes
  STANDARD = "standard",     // Read + write + bash + search
  FULL = "full",             // All tools
}

export const PERMISSION_TOOLS: Record<PermissionLevel, readonly string[]> = {
  [PermissionLevel.READ_ONLY]: ["read"],
  [PermissionLevel.SAFE]: ["read", "web-search", "grep"],
  [PermissionLevel.STANDARD]: ["read", "write", "bash", "web-search", "grep"],
  [PermissionLevel.FULL]: ["*"],
};
```

The `claude-wrapper.ts` module provides a permission-gated interface that combines all these security layers:

```typescript
export class ClaudeCodeWrapper {
  async execute(request: ClaudeCodeRequest): Promise<ClaudeCodeResult> {
    // 1. Validate environment
    const envCheck = validateEnvironment();
    if (!envCheck.isValid) return { success: false, error: "..." };

    // 2. Check prompt safety
    const safetyCheck = checkCommandSafety(request.prompt);
    if (!safetyCheck.isSafe) return { success: false, error: "..." };

    // 3. Build allowed tools from permission level
    const allowedTools = this.buildAllowedTools(config);

    // 4. Execute with timeout
    return this.executeWithTimeout(request.prompt, allowedTools, timeout);
  }
}
```

### Layer 6: Environment Protection

The `.gitignore` excludes sensitive files:

```
.env
.env.local
.env.*.local
logs/
```

The `.env.example` file uses placeholder values that fail validation:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

The startup validation catches placeholder values:

```typescript
if (TELEGRAM_BOT_TOKEN === "your_bot_token_here") {
  errors.push("TELEGRAM_BOT_TOKEN is using placeholder value");
}
```

> **Checkpoint 8:** Review the dangerous patterns list. Can you think of a command that should be blocked but is not in the list? What would you add? Try sending your bot a message that references a dangerous command and observe the behavior.

---

## Part 9: Voice Integration

The voice integration connects ElevenLabs (conversational AI) with Twilio (phone infrastructure) to enable voice calls to your AI assistant.

**Note:** This feature requires ElevenLabs and Twilio API keys. It is not configured in the base setup and serves as an advanced extension.

### Architecture Overview

```
                Phone Call
                    |
                    v
             +------+------+
             |   Twilio     |
             |  (phone)     |
             +------+------+
                    |
             TwiML: Connect to ElevenLabs
                    |
                    v
             +------+------+
             | ElevenLabs  |
             | (voice AI)  |
             +------+------+
                    |
             Context injection from Supabase
                    |
                    v
             +------+------+
             |  Supabase   |
             | (memory)    |
             +--------------+
```

### Webhook Routes

The server handles three voice-related POST endpoints:

```typescript
// /voice/inbound - Twilio calls this when a call comes in
if (pathname === "/voice/inbound") {
  const { CallSid, From } = await req.json();
  const result = await voiceHandlers.inboundCall({ body: { CallSid, From } });
  return new Response(result.body, {
    status: result.statusCode,
    headers: result.headers,  // Content-Type: application/xml (TwiML)
  });
}

// /voice/status - Twilio calls this with call status updates
if (pathname === "/voice/status") {
  const result = await voiceHandlers.callStatus({ body });
  return new Response(result.body, { status: result.statusCode });
}

// /voice/elevenlabs - ElevenLabs calls this with agent events
if (pathname === "/voice/elevenlabs") {
  const result = await voiceHandlers.agentEvent({ body });
  return new Response(result.body, { status: result.statusCode });
}
```

### Context Injection

Before a voice call starts, the system fetches context from Supabase and formats it as a prompt for the ElevenLabs agent:

```typescript
generateContextPrompt(context: VoiceContext): string {
  const sections: string[] = [];

  sections.push(`Current time: ${context.currentTime.toISOString()}`);

  if (context.recentMessages.length > 0) {
    sections.push("\n=== Recent Telegram Messages ===");
    for (const msg of context.recentMessages.slice(-15)) {
      sections.push(`[${msg.role}]: ${msg.content}`);
    }
  }

  if (context.goals.length > 0) {
    sections.push("\n=== Active Goals ===");
    for (const goal of context.goals) {
      const deadline = goal.deadline ? ` (due: ${goal.deadline})` : "";
      sections.push(`- ${goal.description}${deadline}`);
    }
  }

  if (context.facts.length > 0) {
    sections.push("\n=== Known Facts ===");
    for (const fact of context.facts) {
      sections.push(`- ${fact.key}: ${fact.value} (confidence: ${fact.confidence})`);
    }
  }

  return sections.join("\n");
}
```

This means when you call your AI assistant by phone, it knows about your recent Telegram conversations and active goals. The voice agent can say "I see you've been working on your essay -- how's that going?"

### TwiML Response

Twilio expects XML-formatted instructions (TwiML) telling it what to do with the call:

```typescript
generateInboundTwiML(): string {
  const agentUrl = this.getAgentUrl();
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${agentUrl}" />
  </Connect>
</Response>`;
}
```

The `<Stream>` element tells Twilio to pipe the audio to the ElevenLabs agent URL, creating a real-time voice conversation.

### Call Session Management

Active calls are tracked in memory with their transcripts:

```typescript
export interface CallSession {
  sessionId: string;
  callSid: string;
  direction: "inbound" | "outbound";
  phoneNumber: string;
  context: VoiceContext;
  startedAt: Date;
  transcript: Array<{
    role: "user" | "agent";
    text: string;
    timestamp: Date;
  }>;
  isActive: boolean;
}
```

When a call ends, the transcript is processed to extract tasks and actions that can be synced back to Telegram. The `processCompletedCall` method analyzes the transcript for goal-related keywords, reminders, and messages to send.

### Phone-to-User Mapping

The system maps phone numbers to Telegram user IDs via the `PHONE_USER_MAP` environment variable:

```typescript
const phoneMap = process.env.PHONE_USER_MAP || "";
for (const entry of phoneMap.split(",").filter(Boolean)) {
  const [phone, userId] = entry.split(":");
  phoneToUserId.set(phone.replace(/[\s\-\+]/g, ""), parseInt(userId, 10));
}
```

Format: `PHONE_USER_MAP="+15551234567:123456789,+15559876543:987654321"`

> **Checkpoint 9:** Review the voice service code. Can you trace the data flow from an incoming phone call through to context injection? What would happen if ElevenLabs was unavailable -- where would the error be caught?

---

## Part 10: Project File Map and Review

### Complete File Listing

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 297 | Entry point, startup, shutdown, health endpoint, webhook server |
| `src/bot.ts` | 575 | Grammy bot handlers for all message types, file download, goal detection |
| `src/relay.ts` | 536 | Claude Code CLI spawner, JSON parser, output truncation |
| `src/middleware/auth.ts` | 137 | User ID whitelist, Set-based O(1) lookup |
| `src/middleware/parser.ts` | 187 | Multi-modal message type detection and metadata extraction |
| `src/middleware/security.ts` | 369 | Input validation, dangerous command detection, rate limiting, permission levels |
| `src/database/supabase.ts` | 211 | Supabase client setup, Row types, RLS user context |
| `src/database/client.ts` | 473 | High-level database client combining Supabase + embeddings |
| `src/database/messages.ts` | 360 | Message CRUD, semantic search, conversation context |
| `src/database/goals.ts` | 302 | Goal CRUD, semantic search, category management |
| `src/database/user-facts.ts` | 352 | Facts CRUD, semantic search, confidence scoring |
| `src/database/index.ts` | 90 | Re-exports all database modules |
| `src/services/logger.ts` | 66 | Structured JSON logger with component scoping |
| `src/services/cost-tracker.ts` | 140 | In-memory per-user cost estimation and tracking |
| `src/services/goals.ts` | 372 | Goal detection via Claude Code, deadline checking |
| `src/services/proactive.ts` | 362 | Periodic check-in service, notification decisions |
| `src/services/embeddings.ts` | 281 | OpenAI embedding generation, cosine similarity, batch ops |
| `src/services/memory.ts` | 471 | Voice context memory service |
| `src/services/voice.ts` | 585 | ElevenLabs + Twilio voice integration |
| `src/services/twilio-webhook.ts` | 540 | Twilio webhook handlers, agent events |
| `src/services/heartbeat.service.ts` | 81 | Heartbeat file for launchd monitoring |
| `src/services/context-builder.ts` | 234 | System prompt, conversation history, semantic memory assembly |
| `src/services/nlp-commands.ts` | 310 | Local NLP command handling (reminders, notes, memory search) |
| `scripts/start-bot.sh` | 147 | Startup script with pre-flight checks |
| `scripts/install-service.sh` | 244 | launchd service installer/uninstaller |
| `supabase/migrations/001_initial_schema.sql` | 351 | Database schema, indexes, functions, RLS |
| `com.claudecode.bot.plist` | 90 | macOS launchd service definition |

### Dependency Graph

```
src/index.ts
  |-- src/bot.ts
  |     |-- src/middleware/auth.ts
  |     |-- src/middleware/parser.ts
  |     |-- src/relay.ts
  |     |     |-- src/services/logger.ts
  |     |-- src/services/goals.ts
  |     |     |-- src/relay.ts
  |     |     |-- src/database/goals.ts
  |     |     |     |-- src/database/supabase.ts
  |     |-- src/services/cost-tracker.ts
  |     |     |-- src/services/logger.ts
  |-- src/services/heartbeat.service.ts
  |-- src/services/proactive.ts
  |     |-- src/services/goals.ts
  |     |-- src/relay.ts
  |     |-- src/middleware/auth.ts
  |-- src/services/twilio-webhook.ts
  |     |-- src/services/voice.ts
  |     |-- src/services/memory.ts
  |           |-- src/services/embeddings.ts
  |-- src/services/logger.ts
  |-- src/services/cost-tracker.ts
```

### Environment Variable Reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | -- | Bot token from @BotFather |
| `ALLOWED_USER_IDS` | Yes | -- | Comma-separated Telegram user IDs |
| `CLAUDE_TIMEOUT` | No | 300000 | Max execution time (ms) |
| `DEFAULT_PERMISSION_LEVEL` | No | standard | Tool access level |
| `BOT_MODE` | No | polling | polling or webhook |
| `WEBHOOK_URL` | Webhook only | -- | Public URL for webhook |
| `WEBHOOK_SECRET` | No | -- | Telegram webhook verification |
| `WEBHOOK_PORT` | No | 3000 | HTTP server port |
| `SUPABASE_URL` | For memory | -- | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For memory | -- | Supabase service role key |
| `SUPABASE_ANON_KEY` | For memory | -- | Supabase anonymous key |
| `VOYAGE_API_KEY` | For embeddings | -- | Voyage AI API key |
| `LOG_LEVEL` | No | info | debug, info, warn, error |
| `RATE_LIMIT_MAX_REQUESTS` | No | 10 | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | 60000 | Rate limit window (ms) |
| `ELEVENLABS_API_KEY` | For voice | -- | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | For voice | -- | ElevenLabs agent ID |
| `ELEVENLABS_VOICE_ID` | For voice | -- | ElevenLabs voice ID |
| `ELEVENLABS_REGION` | For voice | us | ElevenLabs API region |
| `TWILIO_ACCOUNT_SID` | For voice | -- | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | For voice | -- | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | For voice | -- | Twilio phone number |
| `PHONE_USER_MAP` | For voice | -- | Phone-to-user mapping |
| `FEATURE_VOICE_ENABLED` | No | false | Enable voice features |
| `FEATURE_MEMORY_ENABLED` | No | false | Enable semantic memory |
| `FEATURE_PROACTIVE_CHECKINS` | No | false | Enable proactive check-ins |

### Common Troubleshooting

**"Module not found"**
- You are probably running the command from the wrong directory. `cd` into the project root first.
- Run `bun install` to ensure dependencies are installed.

**"reader.read is not a function"**
- You are using Node.js stream syntax with Bun. Use `stdout.getReader()` instead of `stdout.on("data", ...)`.

**"Can't parse entities" from Telegram**
- Claude Code returned output with invalid Markdown characters. Ensure every `ctx.reply(..., { parse_mode: "Markdown" })` is wrapped in a try/catch that falls back to plain text.

**"Permission denied" when Claude Code reads a file**
- The file is outside the project directory or in a sandboxed location. Save files to the project's `tmp/` directory.

**"Timeout" on Claude Code invocations**
- Increase `CLAUDE_TIMEOUT` in `.env`. The default is 300000ms (5 minutes).
- Check that the `claude` CLI is functioning: `claude -p "Hello" --output-format json`.

**Bot stops receiving messages after a while**
- In polling mode, the bot may lose its connection. Restart with `launchctl kickstart -k gui/$UID/com.claudecode.bot`.
- Consider switching to webhook mode for production.

**"SUPABASE_URL environment variable is not set"**
- The memory features require Supabase. Either set the environment variables or disable memory features by setting `FEATURE_MEMORY_ENABLED=false`.

> **Checkpoint 10:** Can you draw the complete data flow from a user sending a photo on Telegram to receiving the analysis response? Trace it through every file in the project.

---

## Part 11: Conversation Context and Memory

The original bot was stateless -- each message was processed in isolation. This part adds persistent memory and a rich system prompt that makes the bot feel like a real assistant.

### The Context Builder (src/services/context-builder.ts)

The context builder assembles a full prompt by combining multiple sources:

```typescript
export async function buildContext(
  userId: number,
  userMessage: string,
): Promise<BuiltContext> {
  const [recentResult, goals, facts, semanticHits] = await Promise.all([
    getRecentMessages(client, userId, 15),
    getActiveGoals(client, userId),
    getUserFacts(client, userId, undefined, 3),
    searchSemanticMemory(client, userId, userMessage),
  ]);

  // Assemble: system prompt + time + goals + facts + memory + conversation
  const prompt = SYSTEM_PROMPT
    .replace("CURRENT_TIME_BLOCK", timeBlock)
    .replace("GOALS_BLOCK", goalsBlock)
    .replace("FACTS_BLOCK", factsBlock)
    .replace("MEMORY_BLOCK", memoryBlock)
    .replace("CONVERSATION_BLOCK", conversationBlock);

  return { prompt, conversationLength, memoryHits };
}
```

**Why `Promise.all`?** The four data sources are independent. Fetching them in parallel means the total latency is the slowest single query, not the sum of all four.

**The system prompt** defines the bot's personality:

```
You are ${OWNER_NAME}'s personal AI assistant, available 24/7 through Telegram.
Your name is ${BOT_NAME}.

## Who You Are
- You're warm, direct, and genuinely helpful
- You remember past conversations and bring up relevant context naturally
- You're proactive: if you notice a connection to something ${OWNER_NAME} mentioned before, say so
- You keep responses concise for Telegram (short paragraphs, use bullet points)
```

### Semantic Memory Search

When a message comes in, the context builder searches for semantically relevant past conversations using pgvector:

```typescript
async function searchSemanticMemory(
  client: SupabaseClient,
  userId: number,
  query: string,
): Promise<Array<{ role: string; content: string }>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return []; // Graceful degradation

  const { generateEmbedding } = await import("./embeddings.js");
  const embedding = await generateEmbedding(query, { apiKey });
  const results = await searchSimilarMessages(client, embedding, userId, 5, 0.72);

  return results.map((r) => ({ role: r.role, content: r.content }));
}
```

**Graceful degradation:** If the OpenAI API key is not configured, semantic search silently returns an empty array. The bot still works -- it just does not have memory-augmented context.

### Message Storage

Every user message and assistant response is stored in Supabase. User messages also get async embedding generation:

```typescript
export async function storeUserMessage(
  userId: number,
  content: string,
  telegramMessageId?: number,
): Promise<void> {
  const client = getSupabaseClient();
  await storeMessage(client, userId, "user", content, undefined, undefined, telegramMessageId);

  // Generate embedding asynchronously (non-blocking)
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    generateAndStoreEmbedding(client, userId, content).catch(() => {});
  }
}
```

**Why async embedding?** Generating an embedding takes 200-500ms. By doing it asynchronously, the user gets their response immediately. The embedding is written to the database in the background and will be available for future semantic searches.

> **Checkpoint 11:** Send several messages to your bot. Then ask "what did we talk about?" -- does it return relevant past conversations? Check `contextMessages` in the logs to verify conversation history is being included.

---

## Part 12: Natural Language Commands

Not every message needs a full Claude Code invocation. Simple commands like "remind me to..." or "remember that..." can be handled locally in milliseconds instead of waiting 5-10 seconds for Claude Code.

### The NLP Command Handler (src/services/nlp-commands.ts)

The handler uses regex pattern matching to detect actionable commands:

```typescript
const REMINDER_PATTERNS = [
  /^remind me (?:to |that )?(.+?)(?:\s+(?:at|by|on|before)\s+(.+))?$/i,
  /^set (?:a )?reminder[: ]+(.+?)(?:\s+(?:at|by|on|before)\s+(.+))?$/i,
];

const NOTE_PATTERNS = [
  /^(?:remember|note|save|store)(?: that)?\s+(.+)/i,
  /^(?:keep in mind|fyi|btw)[,:]?\s+(.+)/i,
];

const MEMORY_QUERY_PATTERNS = [
  /^what did (?:we|I) (?:talk|chat|discuss) about\s*(.*)$/i,
  /^do you remember (?:when|what)\s+(.+)$/i,
];

const FORGET_PATTERNS = [
  /^forget (?:about |that )?(.+)/i,
];
```

**Why regex instead of Claude Code?** Speed. A regex match takes microseconds. A Claude Code invocation takes 5-10 seconds. For well-defined patterns like "remind me to X at Y", regex is the right tool.

### Integration in bot.ts

The NLP handler runs before the Claude Code relay. If it matches, the response is sent immediately:

```typescript
// Try NLP command handling first (instant response)
const nlpResult = await handleNLPCommand(userId, parsed.content);
if (nlpResult.handled && nlpResult.response) {
  await ctx.reply(nlpResult.response, { parse_mode: "Markdown" });
  storeAssistantMessage(userId, nlpResult.response).catch(() => {});
  return; // Skip Claude Code entirely
}

// No NLP match -- fall through to Claude Code relay
const thinkingMsg = await ctx.reply("Thinking...");
```

### Time Parsing

The reminder handler includes a lightweight time parser:

```typescript
function parseTimeHint(hint: string): Date | undefined {
  // "in 30 minutes" / "in 2 hours" / "in 3 days"
  const relativeMatch = hint.match(/^in\s+(\d+)\s+(minute|hour|day)s?$/i);

  // "at 3pm" / "at 14:30"
  const atTimeMatch = hint.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

  // "tomorrow" / "tomorrow at 9am"
  const tomorrowMatch = hint.match(/^tomorrow(?:\s+at\s+(\d{1,2})...)?$/i);
}
```

### Supported Commands

| Pattern | Example | What It Does |
|---------|---------|-------------|
| `remind me to...` | "remind me to call mom tomorrow at 3pm" | Creates a goal with deadline |
| `remember that...` | "remember that I prefer dark mode" | Stores a user fact |
| `what did we talk about...` | "what did we talk about yesterday" | Semantic + keyword search |
| `forget about...` | "forget about my preference for tabs" | Deletes matching facts |
| `daily summary` | "what happened today" | Recaps today's messages |

> **Checkpoint 12:** Send "remind me to buy groceries tomorrow at 5pm" to your bot. Did it respond instantly (under 1 second)? Now send "what did we talk about?" -- does it show recent conversation topics?

---

## Part 13: Enhanced Proactive Intelligence

The original proactive service ran every 30 minutes and only checked goal deadlines. The enhanced version adds time-aware intelligence with morning briefings, evening summaries, and smarter deadline alerts.

### Time-Aware Check-Ins

The service now runs every 15 minutes and checks the user's local time to decide what to do:

```typescript
async checkIn(): Promise<void> {
  const now = getUserLocalTime(); // PST/PDT
  const hour = now.getHours();

  for (const userId of userIds) {
    const state = this.getDailyState(userId);

    // Morning briefing (8-9am, once per day)
    if (hour >= 8 && hour < 9 && !state.morningBriefingSent) {
      await this.sendMorningBriefing(userId, state);
    }

    // Deadline checks (always active)
    await this.checkDeadlines(userId, state);

    // Evening summary (9-10pm, once per day)
    if (hour >= 21 && hour < 22 && !state.eveningSummarySent) {
      await this.sendEveningSummary(userId, state);
    }
  }
}
```

### Daily State Tracking

A per-user `DailyState` object prevents duplicate notifications:

```typescript
interface DailyState {
  date: string;                    // YYYY-MM-DD
  morningBriefingSent: boolean;
  eveningSummarySent: boolean;
  deadlineAlertsSent: Set<string>; // goal IDs already alerted
}
```

The state resets automatically when the date changes. This is tracked in memory (not in the database) since it only needs to survive within a single process lifecycle.

### Morning Briefing

The morning briefing assembles a summary of active goals, approaching deadlines, and a random user fact:

```
Good morning! Here's your Wednesday briefing:

Active Goals (3):
!! Update agent instructions [work]
! Finish the essay [personal]
  Read chapter 5 [learning]

Upcoming Deadlines:
- Update agent instructions: 2 hours remaining

Quick reminder: You prefer the 60/40 collaboration model

What's the plan for today?
```

### Evening Summary

The evening summary uses Claude Code to generate a natural-language recap of the day's conversations:

```typescript
const prompt = `Summarize today's conversation for the user in a brief, friendly evening message.
Topics discussed today (${userMessages.length} messages):
${messagePreview}

Write a 2-3 sentence evening wrap-up. Be warm and casual.`;

const response = await invokeClaudeCode({
  prompt,
  allowedTools: ["read"], // Read-only -- no bash in proactive service
  timeout: 30000,
});
```

**Why `allowedTools: ["read"]`?** The proactive service should never execute shell commands. It only needs to generate text. Restricting tools to `read` prevents any possibility of the proactive service running unintended commands.

### Permission Tightening

As part of this enhancement, tool permissions were tightened across all handlers:

| Handler | Before | After | Rationale |
|---------|--------|-------|-----------|
| Text messages | bash, read, write | bash, read, write | Primary power interface |
| Photos | bash, read | read | Analysis only, no execution |
| Documents | bash, read | read | Read content, no execution |
| Videos | bash, read | read | Metadata only |
| Proactive service | unrestricted | read | Text generation only |

> **Checkpoint 13:** Wait for the morning or evening window (or temporarily change the hour constants to test). Does the bot send you a briefing? Check the logs for "Morning briefing sent" or "Evening summary sent".

---

## Part 14: Running as a macOS Daemon

### Installation

The project includes scripts for full launchd service management:

```bash
# Install and start the service (survives terminal close and reboot)
bash scripts/install-service.sh install

# Check service status
bash scripts/install-service.sh status

# View logs
bash scripts/install-service.sh logs

# Restart after code changes
launchctl kickstart -k gui/501/com.claudecode.bot

# Stop the service
launchctl stop com.claudecode.bot

# Completely remove the service
bash scripts/install-service.sh uninstall
```

### PATH Configuration

**Important:** launchd runs with a minimal PATH that does not include Homebrew. The `start-bot.sh` script explicitly adds `/opt/homebrew/bin` to PATH:

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
```

Without this line, `bun` will not be found and the service will fail silently. This is the most common issue when setting up launchd services on macOS with Homebrew-installed tools.

### Log Locations

| Log | Path | Content |
|-----|------|---------|
| Startup | `logs/startup.log` | Pre-flight checks, dependency install |
| Bot output | `logs/bot-stdout.log` | All structured JSON logs |
| Bot errors | `logs/bot-stderr.log` | Uncaught errors, stack traces |
| Heartbeat | `logs/heartbeat.timestamp` | Unix timestamp (updated every 5 min) |

> **Checkpoint 14:** Install the launchd service, then close your terminal completely. Send a message to your bot on Telegram. Does it respond? Check `bash scripts/install-service.sh status` to verify the service is running.

---

## Appendix: Challenge Exercises

These exercises extend the project in meaningful ways. Each one teaches a different aspect of AI system design.

### Challenge 1: Add a /remind Command

**Difficulty:** Intermediate

Build a `/remind` command that accepts natural language scheduling:

```
/remind Take out the trash in 30 minutes
/remind Call the dentist tomorrow at 9am
```

**Hints:**
- Parse the reminder text and time using Claude Code (similar to goal detection)
- Store reminders in a new `reminders` table with a `notify_at` timestamp
- Add a check in the proactive service to send reminders at the right time
- Consider timezone handling -- where does the user's timezone come from?

**What you will learn:**
- Time-based scheduling in a daemon process
- Natural language date/time parsing
- Database schema extension

### Challenge 2: Implement Voice Transcription with Whisper API

**Difficulty:** Intermediate

Replace the voice note placeholder with actual transcription:

1. Download the `.ogg` file (already done)
2. Send it to OpenAI's Whisper API for transcription
3. Pass the transcribed text to Claude Code
4. Return the response

**Hints:**
- Whisper API accepts `multipart/form-data` with the audio file
- The API returns `{ "text": "transcribed content" }`
- Consider caching transcriptions to avoid re-processing on retries
- Use `Bun.file()` to read the downloaded file into a `Blob` for the form data

**What you will learn:**
- Multipart file upload in TypeScript
- Audio processing pipeline
- API integration patterns

### Challenge 3: Conversation History Export

**Difficulty:** Intermediate

Add a `/export` command that generates a formatted conversation history:

1. Fetch all messages for the user from Supabase
2. Format them as a readable document (Markdown or HTML)
3. Generate a file and send it back via Telegram's `sendDocument` API

**Hints:**
- Grammy's `ctx.replyWithDocument` accepts an `InputFile`
- Use `Bun.write` to create the file, then use `new InputFile(path)` to send it
- Consider date range filtering: `/export last 7 days`
- Add pagination for users with thousands of messages

**What you will learn:**
- File generation and delivery via Telegram
- Database query optimization
- Date range handling

### Challenge 4: Web Dashboard for Goal Tracking

**Difficulty:** Advanced

Build a web dashboard using Bun.serve that displays:
- Active goals with progress indicators
- Message statistics (messages per day, response times)
- Cost tracking over time
- Real-time status (is the bot online?)

**Hints:**
- Bun.serve supports HTML imports for frontend bundling
- Use Supabase's real-time subscriptions for live updates
- Authentication: use the same user ID whitelist with a simple token system
- Consider charting libraries like Chart.js for visualizations

**What you will learn:**
- Full-stack development with Bun
- Real-time data updates
- Dashboard design patterns

### Challenge 5: MCP Server Integration

**Difficulty:** Advanced

Build a custom MCP (Model Context Protocol) server that exposes project-specific tools to Claude Code:

1. Create an MCP server that provides tools like `get_goals`, `search_memory`, `create_reminder`
2. Configure Claude Code to connect to your MCP server
3. Now when users ask about their goals, Claude Code calls your MCP tools instead of going through the relay

**Hints:**
- MCP servers communicate over stdio or HTTP
- Each tool needs a JSON schema describing its parameters
- This removes the need for the relay to pass context manually -- Claude Code can fetch what it needs
- Start with `@modelcontextprotocol/sdk` for the server framework

**What you will learn:**
- Model Context Protocol architecture
- Tool design for AI agents
- Direct database access from Claude Code

---

## Summary

You have built a system that connects a mobile messaging app to an AI that can read files, run commands, and manage a semantic memory database. The key insight is that Claude Code CLI in headless mode is not just a chat API -- it is an agent with tool access. By wrapping that agent in a Telegram bot with authentication, rate limiting, and structured logging, you created something genuinely useful: a personal AI assistant that runs 24/7 on your machine.

The architecture scales from a personal tool to a multi-user system:
- Authentication already supports multiple user IDs
- Row Level Security isolates each user's data
- The rate limiter prevents any single user from monopolizing resources
- The permission system controls what level of tool access each request gets

From here, you can extend in any direction: voice calls, web dashboards, custom MCP tools, or integration with other services. The foundation is solid.

Good luck building.
