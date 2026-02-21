# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**Claude Code Always-On** is a 24/7 Telegram bot interface for Claude Code, combining AI assistance with voice integration, semantic memory, and proactive intelligence. The bot runs as a macOS launchd daemon and provides secure, permission-gated access to Claude Code via Telegram.

**Key Architecture Pattern:** Grammy (Telegram) → Relay Module → Claude Code CLI (headless) → Response

---

## Development Environment

### Runtime: Bun (Required)

All commands use Bun instead of Node.js:

```bash
bun run dev              # Start bot in polling mode (development)
bun run start            # Start bot (respects BOT_MODE env)
bun run type-check       # TypeScript validation without execution
bun test                 # Run tests (when implemented)
```

### Service Management (launchd)

The bot runs as a macOS launchd daemon for 24/7 operation:

```bash
# Install/uninstall service
bun run service:install
bun run service:uninstall

# Control running service
bun run service:start
bun run service:stop
bun run service:restart
bun run service:status

# View logs
bun run service:logs
# OR manually:
tail -f logs/bot-stdout.log
tail -f logs/bot-stderr.log
```

**Important:** After code changes, restart the service with:
```bash
launchctl kickstart -k gui/501/com.claudecode.bot
```

### Environment Variables

Create `.env` in project root. Key variables:

```bash
# Required
TELEGRAM_BOT_TOKEN=        # From @BotFather
ALLOWED_USER_IDS=          # Comma-separated user IDs
ANTHROPIC_API_KEY=         # For Claude Code

# Supabase (for memory features)
SUPABASE_URL=
SUPABASE_ANON_KEY=

# Optional (voice features)
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
OPENAI_API_KEY=            # For embeddings
GEMINI_API_KEY=            # For transcription

# Bot mode
BOT_MODE=polling           # 'polling' (dev) or 'webhook' (prod)
WEBHOOK_URL=               # If using webhook mode
WEBHOOK_SECRET=            # For webhook validation
WEBHOOK_PORT=3000          # Webhook server port
```

---

## Architecture

### Core Components

**Entry Point:** `src/index.ts`
- Validates environment
- Starts bot (polling or webhook)
- Initializes heartbeat service
- Starts proactive check-in service
- Handles graceful shutdown

**Bot Logic:** `src/bot.ts`
- Grammy bot instance and handlers
- Message type routing (text, photo, voice, document, video)
- Command handlers (/start, /help, /status, /goals, /costs)
- File download and cleanup
- Markdown formatting for Telegram

**Claude Code Relay:** `src/relay.ts`
- Spawns Claude Code CLI in headless mode
- Handles JSON output parsing
- Implements timeout handling
- Formats output for Telegram (4096 char limit)
- Provides convenience wrappers: `askClaude()`, `askClaudeWithTools()`

### Data Flow

1. **Telegram message arrives** → `bot.ts` handler
2. **Rate limit + validation** → `middleware/security.ts`
3. **Check NLP commands** → `services/nlp-commands.ts` (instant local responses)
4. **Build rich context** → `services/context-builder.ts`:
   - Conversation history (last 15 messages)
   - User facts (preferences/notes)
   - Active goals
   - Semantic memory (pgvector similarity search)
5. **Invoke Claude Code** → `relay.ts` spawns CLI with `--output-format json`
6. **Parse response** → Handle success/error
7. **Store in DB** → `database/messages.ts` with embeddings
8. **Background tasks** → Goal detection, cost tracking

### Permission Model

**Text messages:** Full access (`["bash", "read", "write"]`)
**Photos/docs/videos:** Read-only (`["read"]`)
**Voice notes:** Acknowledgment only (transcription not yet configured)

---

## Key Development Patterns

### Adding New Message Handlers

Follow the pattern in `bot.ts`:

```typescript
bot.on("message:NEW_TYPE", async (ctx) => {
  try {
    const parsed = parseMessage(ctx);
    if (!parsed || parsed.type !== MessageType.NEW_TYPE) return;

    // Rate limiting + validation
    const thinkingMsg = await ctx.reply("Processing...");

    // Download file if needed
    const localPath = await downloadTelegramFile(parsed.fileId);

    // Build prompt for Claude Code
    const prompt = `...`;

    const response = await invokeClaudeCode({
      prompt,
      allowedTools: ["read"],
      timeout: 120000,
    });

    await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);

    if (response.success) {
      await ctx.reply(response.output!, { parse_mode: "Markdown" });
    }
  } catch (error) {
    log.error("Error", { error: String(error) });
    await ctx.reply("Sorry, error occurred");
  }
});
```

### Adding NLP Commands (Instant Local Responses)

NLP commands bypass Claude Code for instant responses. Add to `services/nlp-commands.ts`:

```typescript
// Pattern matching
if (message.startsWith("remind me")) {
  // Extract details, store in DB
  return { handled: true, response: "✓ Reminder set!" };
}

// Regex matching
if (/^(what did|show me).*(yesterday|last week)/i.test(message)) {
  const results = await searchMessages(userId, query, timeRange);
  return { handled: true, response: formatResults(results) };
}
```

### Working with Supabase

All database operations use typed clients in `src/database/`:

```typescript
import { dbClient } from "./database/client.js";
import { messagesDb } from "./database/messages.js";
import { goalsDb } from "./database/goals.js";

// Store message with embedding
await messagesDb.storeMessage(userId, content, messageId);

// Semantic search
const similar = await messagesDb.searchMessages(userId, "query about...", 5);

// Goal tracking
const active = await goalsDb.getActiveGoals(userId);
```

### Claude Code Invocation Patterns

**Simple question:**
```typescript
const answer = await askClaude("What is the capital of France?");
```

**With specific tools:**
```typescript
const response = await askClaudeWithTools(
  "List all TypeScript files in src/",
  ["bash", "read"],
  process.cwd()
);
```

**With streaming (for long operations):**
```typescript
await invokeClaudeCode(
  {
    prompt: "...",
    stream: true,
  },
  async (chunk, isFinal) => {
    if (!isFinal) {
      // Update progress indicator
    }
  }
);
```

---

## Testing & Debugging

### Local Development

```bash
# Start in dev mode (polls Telegram, logs to console)
bun run dev

# Check TypeScript errors
bun run type-check

# Test Telegram file downloads
# Send a photo to the bot and watch logs/bot-stdout.log
```

### Service Debugging

```bash
# Check if service is running
launchctl list | grep claudecode

# View recent logs
tail -n 100 logs/bot-stdout.log
tail -n 100 logs/bot-stderr.log

# Check heartbeat
ls -lh logs/bot-heartbeat.txt

# Force restart after code changes
launchctl kickstart -k gui/501/com.claudecode.bot
```

### Common Issues

**Bot not responding:**
- Check `ALLOWED_USER_IDS` includes your Telegram user ID
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check logs for errors: `bun run service:logs`

**Claude Code timeouts:**
- Default timeout is 120s for most operations
- Increase timeout for large operations: `timeout: 300000` (5 min)
- Check if `ANTHROPIC_API_KEY` is set correctly

**Database connection errors:**
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Check Supabase project is not paused (free tier auto-pauses)
- Ensure pgvector extension is enabled

---

## Cost Tracking

The bot tracks usage in memory (`services/cost-tracker.ts`):

```typescript
import { recordCost, getGlobalStats, formatCostsMessage } from "./services/cost-tracker.js";

// Record invocation
recordCost({
  userId,
  timestamp: Date.now(),
  cost: estimateCost(tokensUsed),
  tokensUsed,
  durationMs: 1234,
  operation: "text_message",
});

// Get stats
const stats = getGlobalStats();
console.log(`Total cost: $${stats.totalCost.toFixed(4)}`);
```

User-facing command: `/costs` shows per-user breakdown

---

## File Structure

```
src/
├── index.ts                    # Entry point + shutdown handling
├── bot.ts                      # Grammy bot + message handlers
├── relay.ts                    # Claude Code CLI wrapper
├── middleware/
│   ├── auth.ts                 # User ID whitelist
│   ├── parser.ts               # Message type detection
│   └── security.ts             # Rate limiting + validation
├── database/
│   ├── supabase.ts             # Supabase client setup
│   ├── client.ts               # High-level DB wrapper
│   ├── messages.ts             # Message storage + search
│   ├── goals.ts                # Goal tracking
│   └── user-facts.ts           # User preferences/notes
└── services/
    ├── context-builder.ts      # Assembles conversation context
    ├── nlp-commands.ts         # Local instant-response commands
    ├── proactive.ts            # Morning/evening briefings
    ├── goals.ts                # Goal detection + formatting
    ├── embeddings.ts           # OpenAI embedding generation
    ├── cost-tracker.ts         # In-memory usage tracking
    ├── logger.ts               # Structured JSON logging
    ├── heartbeat.service.ts    # Keeps launchd happy
    ├── memory.ts               # Voice context memory
    ├── voice.ts                # ElevenLabs + Twilio integration
    └── twilio-webhook.ts       # Twilio webhook handlers

scripts/
├── start-bot.sh                # Startup script for launchd
└── install-service.sh          # Service management wrapper

supabase/migrations/            # Database schema + indexes
logs/                           # Runtime logs (git-ignored)
tmp/                            # Downloaded files (auto-cleaned)
```

---

## Semantic Memory System

The bot uses pgvector for semantic search across conversation history:

**How it works:**
1. Every message stored with OpenAI embedding (1536 dimensions)
2. User messages trigger similarity search: `<-> embedding ORDER BY distance LIMIT 5`
3. Relevant context injected into Claude Code prompt
4. Result: Bot "remembers" related past conversations

**Adding to context:**
```typescript
// In context-builder.ts
const relevantMemories = await messagesDb.searchMessages(userId, currentMessage, 5);
const memoryContext = relevantMemories.map(m =>
  `[${formatDate(m.created_at)}] ${m.role}: ${m.content}`
).join("\n");
```

---

## Proactive Features

The bot can initiate conversations (morning briefings, reminders):

**Implemented in:** `services/proactive.ts`

**Schedule:**
- Morning briefings: 8-9am (if goals or events)
- Evening summaries: 9-10pm (daily recap)
- Deadline alerts: 24h/1h before due

**How to trigger manually:**
```typescript
const proactive = getProactiveService(bot);
await proactive.sendMorningBriefing(userId);
```

---

## Voice Integration (Optional)

If `ELEVENLABS_API_KEY` and `TWILIO_*` are configured:

**Inbound call flow:**
1. Phone call arrives → Twilio webhook → `/voice/inbound`
2. Bot creates ElevenLabs agent with full conversation context
3. User talks with voice-enabled Claude (streaming)
4. Conversation stored in Supabase with regular messages

**Webhook endpoints:**
- `POST /voice/inbound` - New call
- `POST /voice/status` - Call status updates
- `POST /voice/elevenlabs` - Agent events

---

## Deployment Checklist

Before deploying to production:

1. ✓ Set all required environment variables in `.env`
2. ✓ Configure launchd service: `bun run service:install`
3. ✓ Verify Supabase database is set up with migrations
4. ✓ Test Telegram bot responds to your user ID
5. ✓ Check logs are being written: `ls -lh logs/`
6. ✓ Confirm heartbeat is updating: `cat logs/bot-heartbeat.txt`
7. ✓ Test graceful shutdown: `bun run service:stop`
8. ✓ Verify auto-restart on crash (service should come back up)

---

## Related Documentation

- **README.md** - Setup instructions, environment variables, testing
- **PLAN.md** - Implementation roadmap and task breakdown
- **WALKTHROUGH.md** - Detailed implementation guides (14 parts)
- **SECURITY.md** - Security audit results
- **PRD.md** - Product requirements document

For more details on specific subsystems, refer to inline comments in source files.
