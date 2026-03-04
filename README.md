# Claude Code Always-On

A secure, self-hosted 24/7 AI assistant built on Claude Code + MCP, accessible via Telegram. Runs as a macOS launchd daemon with voice integration, semantic memory, and proactive intelligence.

---

## Features

- **24/7 Availability** — macOS launchd daemon with auto-restart on crash
- **Telegram Interface** — text, voice notes, images, documents, video
- **Conversation Memory** — persistent history with pgvector semantic retrieval
- **Natural Language Commands** — instant local handling of remind/remember/search/forget/summary
- **Proactive Intelligence** — morning briefings (8–9am), evening summaries (9–10pm), deadline alerts
- **Goal Tracking** — automatic goal detection from natural language
- **Voice Integration** — phone calls via ElevenLabs + Twilio with full context
- **Remote Mode** — toggle Telegram notifications on/off; approve Claude Code permissions from your phone
- **Obsidian Vault Bridge** — read, write, search your vault from Telegram (`/vault` commands)
- **Permission-Gated Execution** — read-only by default; bash requires explicit `/bash` + `/confirm` two-step gate
- **Webhook Security** — HMAC-SHA1 (Twilio) and HMAC-SHA256 (ElevenLabs) signature verification
- **Cost Tracking** — per-user token and cost estimation via `/costs`

---

## Prerequisites

- **macOS** (launchd required for daemon mode)
- **Bun** runtime — `brew install bun`
- **Claude Code CLI** — installed and authenticated (`claude --version`)
- A **Telegram account** to create a bot via @BotFather
- **Supabase** account (free tier works) with pgvector extension enabled
- API keys for: Anthropic, OpenAI (embeddings), ElevenLabs (voice), Twilio (calls)

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/nmadrid27/claude-code-always-on.git
cd claude-code-always-on
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your credentials — see Environment Variables below
chmod 600 .env
```

### 4. Run database migrations

```bash
# Apply all migrations from supabase/migrations/ in order via Supabase dashboard
# or using the Supabase CLI: supabase db push
```

### 5. Start in development mode

```bash
bun run dev
```

### 6. Install as 24/7 daemon

```bash
bash scripts/install-service.sh install
```

---

## Getting Your Telegram Bot Token

1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the token (format: `1234567890:ABCdef...`) to your `.env`

**Get your Telegram user ID:**
1. Message **@userinfobot** on Telegram
2. It replies with your numeric user ID
3. Add it to `ALLOWED_USER_IDS` in `.env`

---

## Environment Variables

### Required

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
ALLOWED_USER_IDS=your_telegram_user_id

# Claude Code
ANTHROPIC_API_KEY=your_anthropic_api_key

# Supabase (use the service role key, not the anon key)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
```

### Optional — Voice Features

```bash
# ElevenLabs (text-to-speech + voice agent)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
ELEVENLABS_SIGNING_SECRET=your_elevenlabs_webhook_signing_secret

# Twilio (inbound phone calls)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Webhook server (required for voice)
BOT_MODE=webhook
WEBHOOK_URL=https://your-public-url.example.com
WEBHOOK_SECRET=a_random_secret_string
WEBHOOK_PORT=3000
```

### Optional — Memory & Transcription

```bash
# OpenAI (semantic memory embeddings)
OPENAI_API_KEY=your_openai_api_key

# Gemini (voice transcription)
GEMINI_API_KEY=your_gemini_api_key
```

---

## Service Management

```bash
# Install and start (survives reboot)
bash scripts/install-service.sh install

# Status, start, stop, restart
bash scripts/install-service.sh status
bash scripts/install-service.sh start
bash scripts/install-service.sh stop
bash scripts/install-service.sh restart

# View live logs
bash scripts/install-service.sh logs
# or directly:
tail -f logs/bot-stdout.log
tail -f logs/bot-stderr.log

# Restart after code changes
launchctl kickstart -k gui/$(id -u)/com.claudecode.bot

# Remove daemon completely
bash scripts/install-service.sh uninstall
```

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/status` | Uptime and user info |
| `/goals` | View active goals |
| `/costs` | Token usage and cost estimate |
| `/bash` | Request bash+write tool access (step 1 of 2) |
| `/confirm` | Confirm and enable bash access (step 2 of 2) |
| `/vault` | Obsidian vault operations (read, write, search, tasks) |
| `/away` | Enable remote mode (Telegram notifications on) |
| `/home` | Disable remote mode (notifications off) |

### Terminal Commands (shell, not Claude Code)

These are regular shell commands run from your terminal. They are **not** Claude Code slash commands.

| Command | Description |
|---------|-------------|
| `away` | Enable remote mode (same as `/away` in Telegram) |
| `home` | Disable remote mode (same as `/home` in Telegram) |
| `claude-telegram` | Launch Claude Code with Telegram permission approval |
| `notify <cmd>` | Wrap a command with completion/idle Telegram alerts |

> **Note:** Do not prefix these with `/` in your terminal. Typing `/away` inside a Claude Code session will trigger Claude Code's own slash command system, not the remote mode toggle.

### Natural Language Commands (instant, no Claude invocation)

| Say this... | What happens |
|-------------|-------------|
| `remind me to call mom tomorrow at 3pm` | Creates a goal with deadline |
| `remember that I prefer dark mode` | Stores a user fact |
| `what did we talk about yesterday` | Searches conversation history |
| `forget about my tab preference` | Deletes matching facts |
| `daily summary` | Recaps today's messages |

---

## Security Model

| Layer | Implementation |
|-------|----------------|
| **Authentication** | Telegram user ID whitelist (`ALLOWED_USER_IDS`) |
| **Prompt injection** | All user input wrapped in XML envelope before reaching Claude |
| **Execution gate** | `/bash` + `/confirm` two-step handshake to elevate from read-only |
| **Webhook auth** | Twilio: HMAC-SHA1 on `X-Twilio-Signature`; ElevenLabs: HMAC-SHA256 on `ElevenLabs-Signature` |
| **File paths** | Absolute paths stripped — only `basename` exposed in prompts |
| **Credentials** | Environment variables only, never in source code |
| **File access** | `allowedTools: ["read"]` by default; bash requires explicit gate |

---

## Project Structure

```
src/
├── index.ts                    # Entry point, webhook server, graceful shutdown
├── bot.ts                      # Grammy handlers (text, photo, voice, doc, video, approvals)
├── relay.ts                    # Claude Code CLI spawner + JSON parser
├── mcp/
│   ├── telegram-approver.ts    # MCP server for Telegram permission approval
│   └── mcp-config.json         # MCP server config for --mcp-config flag
├── middleware/
│   ├── auth.ts                 # User ID whitelist
│   ├── parser.ts               # Multi-modal message type detection
│   ├── security.ts             # Rate limiting, input validation, command safety
│   └── webhook-auth.ts         # Twilio HMAC-SHA1 + ElevenLabs HMAC-SHA256
├── database/
│   ├── supabase.ts             # Supabase client + row types
│   ├── client.ts               # High-level DB wrapper
│   ├── messages.ts             # Message CRUD + semantic search + embedding update
│   ├── goals.ts                # Goal CRUD
│   └── user-facts.ts           # User preferences/notes
└── services/
    ├── context-builder.ts      # System prompt + conversation memory assembly
    ├── vault-bridge.ts         # Obsidian REST API bridge (/vault commands)
    ├── nlp-commands.ts         # Local instant-response commands
    ├── proactive.ts            # Scheduled briefings and deadline alerts
    ├── goals.ts                # Goal detection + formatting
    ├── embeddings.ts           # OpenAI embedding generation
    ├── cost-tracker.ts         # In-memory usage tracking
    ├── logger.ts               # Structured JSON logging
    ├── heartbeat.service.ts    # Heartbeat file for launchd watchdog
    ├── memory.ts               # Voice context memory
    ├── voice.ts                # ElevenLabs + Twilio integration
    └── twilio-webhook.ts       # Twilio webhook handlers

scripts/
├── start-bot.sh                # Startup script used by launchd
└── install-service.sh          # Service management wrapper

supabase/migrations/            # Database schema + pgvector indexes
logs/                           # Runtime logs (git-ignored)
tmp/                            # Downloaded files, auto-cleaned every 6h (git-ignored)
```

---

## Supabase Setup

1. Create a new Supabase project
2. Enable the **pgvector** extension: Database → Extensions → pgvector
3. Apply migrations from `supabase/migrations/` in order (use Supabase dashboard SQL editor or `supabase db push`)
4. Copy your **service role key** (not the anon key) to `SUPABASE_SERVICE_KEY` in `.env`

---

## Troubleshooting

### Bot not responding
- Confirm your Telegram user ID is in `ALLOWED_USER_IDS`
- Check `TELEGRAM_BOT_TOKEN` is correct
- View logs: `tail -f logs/bot-stdout.log`

### Service won't start
- Check stderr: `tail -f logs/bot-stderr.log`
- Verify Bun is on PATH: `which bun`
- Confirm all required env vars are set in `.env`

### Claude Code errors
- Verify `ANTHROPIC_API_KEY` is set and valid
- Check Claude Code CLI works: `claude --version`
- Default timeout is 120s; increase for heavy operations

### Database connection errors
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct
- Check Supabase project isn't paused (free tier auto-pauses after inactivity)
- Ensure pgvector extension is enabled

### Type errors
```bash
bun run type-check
bun install
```

---

## Cost Estimate

| Service | Approx. Monthly |
|---------|-----------------|
| Anthropic (Claude) | $10–200 depending on usage |
| ElevenLabs | $5–20 |
| Twilio | $10–50 |
| Supabase | Free tier |
| OpenAI (embeddings) | ~$1–5 |
| **Total** | **~$25–275/month** |

---

## License

MIT

---

## Documentation

- **[Remote Mode Guide](docs/REMOTE-GUIDE.md)** : Control Claude Code from Telegram (notifications, vault bridge, permission approval)
- **[Launchd Setup](docs/LAUNCHD.md)** : Daemon configuration details

---

**Last Updated:** 2026-03-03
**Status:** Production
