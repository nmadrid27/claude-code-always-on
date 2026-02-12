# Claude Code Always-On

**Building a Secure 24/7 AI Assistant**

A secure alternative to cloud-hosted AI bots using Claude Code + MCP. This project provides a local-only, permission-gated AI assistant accessible via Telegram with voice, memory, and proactive capabilities.

---

## Features

- **24/7 Availability**: Runs continuously via macOS launchd daemon with auto-restart
- **Telegram Interface**: Interact via text, voice notes, images, documents, and video
- **Conversation Memory**: Persistent conversation history with system prompt personality ("PopPop")
- **Semantic Memory**: pgvector-powered retrieval of relevant past conversations
- **Natural Language Commands**: Instant handling of "remind me...", "remember that...", "what did we talk about...", "forget about...", and "daily summary"
- **Proactive Intelligence**: Morning briefings (8-9am), evening summaries (9-10pm), deadline alerts
- **Goal Tracking**: Automatic goal detection from natural language with priority/category
- **Voice Integration**: Phone calls via ElevenLabs + Twilio with full context awareness
- **Permission-Gated Security**: Text gets bash+read+write; photos/docs/videos/proactive get read-only
- **Cost Tracking**: In-memory per-user token and cost estimation via `/costs`

---

## Prerequisites

Before setting up this project, ensure you have:

- **macOS** (launchd is used for daemon management)
- **Bun** runtime installed (`brew install bun`)
- **Node.js** and TypeScript (for development)
- A **Telegram account** for bot creation
- **Supabase account** (free tier works)
- **Claude Code CLI** installed and configured
- **API access** to:
  - Claude (Anthropic API)
  - OpenAI (for embeddings)
  - ElevenLabs (for voice)
  - Twilio (for phone calls)

---

## Setup Instructions

### 1. Clone or Initialize the Project

```bash
cd /Users/nathanmadrid/claude-code-always-on
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```bash
touch .env
```

Then fill in your credentials (see [Environment Variables](#environment-variables) below).

---

## Getting Your Telegram Bot Token

### Step 1: Create a Bot via BotFather

1. Open Telegram and search for **@BotFather**
2. Send the command `/newbot`
3. Follow the prompts to:
   - Choose a name for your bot (e.g., "My Claude Assistant")
   - Choose a username (must end in `bot`, e.g., `myclaude_bot`)
4. BotFather will respond with a **bot token** like:

   ```
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

5. Copy this token to your `.env` file:

   ```bash
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

### Step 2: Get Your Telegram User ID

1. Open Telegram and search for **@userinfobot**
2. Send any message to the bot
3. It will reply with your **User ID** (a number like `123456789`)
4. Add this ID to your `.env` file:

   ```bash
   ALLOWED_USER_IDS=123456789
   ```

**Note:** You can add multiple user IDs separated by commas if you want to allow multiple people to use the bot.

---

## Environment Variables

Create a `.env` file in the project root with the following variables:

### Required

```bash
# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
ALLOWED_USER_IDS=your_telegram_user_id_1,your_telegram_user_id_2

# Claude Code
ANTHROPIC_API_KEY=your_anthropic_api_key

# Supabase
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Optional (for Voice Features)

```bash
# ElevenLabs (Text-to-Speech)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id

# Twilio (Phone Calls)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# OpenAI (Embeddings for semantic memory)
OPENAI_API_KEY=your_openai_api_key

# Gemini (Voice transcription)
GEMINI_API_KEY=your_gemini_api_key
```

---

## Running the Bot

### Development Mode (Polling)

For development and testing, the bot runs in polling mode:

```bash
bun run dev
```

The bot will:
- Start polling Telegram for new messages
- Log all activity to console
- Respond only to messages from your allowed user IDs

### Production Mode (launchd Daemon)

Install the bot as a macOS launchd service that runs 24/7:

```bash
# Install and start (survives terminal close + reboot)
bash scripts/install-service.sh install

# Check status
bash scripts/install-service.sh status

# View logs
bash scripts/install-service.sh logs

# Restart after code changes
launchctl kickstart -k gui/501/com.claudecode.bot

# Stop the service
launchctl stop com.claudecode.bot

# Completely remove
bash scripts/install-service.sh uninstall
```

The launchd service will:
- Start automatically on login
- Restart automatically if it crashes (5 second delay)
- Log output to `logs/bot-stdout.log` and `logs/bot-stderr.log`

### Type Checking

To run TypeScript type checking without executing:

```bash
bun run type-check
```

---

## Testing Your Bot

Once the bot is running:

1. Open Telegram and find your bot (search for the username you created)
2. Send a test message like "Hello"
3. The bot should respond with a greeting

### Test Multi-Modal Inputs

| Input Type | How to Test |
|------------|-------------|
| **Text** | Send any text message |
| **Voice Note** | Record and send a voice message |
| **Image** | Send a photo or screenshot |
| **Document** | Upload a PDF or text file |
| **File** | Share any file type |

### Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/status` | Bot uptime and user info |
| `/goals` | View all active goals |
| `/costs` | Usage stats (tokens, cost estimate) |

### Natural Language Commands (Instant Response)

These are handled locally without invoking Claude Code:

| Say this... | What happens |
|-------------|-------------|
| `remind me to call mom tomorrow at 3pm` | Creates a goal with deadline |
| `remember that I prefer dark mode` | Stores a user fact |
| `what did we talk about yesterday` | Searches conversation history |
| `forget about my tab preference` | Deletes matching facts |
| `daily summary` | Recaps today's messages |

---

## Project Structure

```
claude-code-always-on/
├── src/
│   ├── index.ts                    # Entry point, startup, shutdown, webhook server
│   ├── bot.ts                      # Grammy bot handlers (text, photo, voice, doc, video)
│   ├── relay.ts                    # Claude Code CLI spawner + JSON parser
│   ├── middleware/
│   │   ├── auth.ts                 # User ID whitelist authentication
│   │   ├── parser.ts               # Multi-modal message type detection
│   │   └── security.ts             # Rate limiting, input validation, command safety
│   ├── database/
│   │   ├── supabase.ts             # Supabase client + row types
│   │   ├── client.ts               # High-level DB client with embeddings
│   │   ├── messages.ts             # Message CRUD + semantic search
│   │   ├── goals.ts                # Goal CRUD + semantic search
│   │   ├── user-facts.ts           # User facts CRUD + confidence scoring
│   │   └── index.ts                # Re-exports
│   └── services/
│       ├── context-builder.ts      # System prompt + conversation memory assembly
│       ├── nlp-commands.ts         # Local NLP commands (remind, note, search, forget)
│       ├── proactive.ts            # Morning briefings, evening summaries, deadline alerts
│       ├── goals.ts                # Goal detection via Claude Code
│       ├── embeddings.ts           # OpenAI embedding generation
│       ├── cost-tracker.ts         # In-memory cost estimation
│       ├── logger.ts               # Structured JSON logging
│       ├── heartbeat.service.ts    # Heartbeat file for launchd
│       ├── memory.ts               # Voice context memory
│       ├── voice.ts                # ElevenLabs + Twilio voice
│       └── twilio-webhook.ts       # Twilio webhook handlers
├── scripts/
│   ├── start-bot.sh                # Startup script for launchd
│   └── install-service.sh          # Service install/uninstall/status
├── supabase/migrations/            # Database schema + pgvector indexes
├── logs/                           # stdout, stderr, heartbeat, startup logs
├── tmp/                            # Downloaded files (auto-cleaned every 6h)
├── com.claudecode.bot.plist        # macOS launchd service definition
├── .env                            # Environment variables (not in git)
├── WALKTHROUGH.md                  # Comprehensive implementation guide (14 parts)
├── PRD.md                          # Product requirements document
├── SECURITY.md                     # Security audit results
└── README.md                       # This file
```

---

## Security Features

| Feature | Implementation |
|---------|----------------|
| **Network** | Local only, no public ports exposed |
| **Authentication** | Telegram user ID whitelist |
| **Credentials** | Environment variables, never in code |
| **Execution** | Permission-gated, no auto-execute |
| **File Access** | Sandboxed, scoped paths |
| **Logging** | No sensitive data in logs |

---

## Cost Breakdown

| Service | Monthly Cost |
|---------|--------------|
| Claude Max 20x | ~$200 |
| ElevenLabs | $5-20 |
| Twilio | $10-50 |
| Supabase | Free tier |
| Gemini API | ~$5 |
| **Total** | **~$220-275/month** |

---

## Troubleshooting

### Bot Not Responding

1. Check the bot is running: `bun run dev` and watch for errors
2. Verify your user ID is in `ALLOWED_USER_IDS`
3. Confirm the bot token is correct in `.env`
4. Check Telegram bot permissions (it should be able to read messages)

### Service Won't Start

1. Check launchd logs: `tail -f /var/log/claude-code-error.log`
2. Verify all environment variables are set in the launchd plist
3. Ensure Bun is installed at the expected path: `which bun`

### Type Errors

```bash
# Run type checking to see issues
bun run type-check

# Install missing dependencies
bun install
```

---

## Next Steps

After initial setup:

1. Test basic text messaging
2. Configure Supabase for semantic memory
3. Set up ElevenLabs and Twilio for voice features
4. Configure launchd for 24/7 operation
5. Test all admin commands

See [PLAN.md](PLAN.md) for the full implementation roadmap and [WALKTHROUGH.md](WALKTHROUGH.md) for detailed implementation guides.

---

## License

MIT

---

**Last Updated:** 2026-02-12
**Status:** Production (running as launchd daemon)
