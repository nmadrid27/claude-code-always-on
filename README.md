# Claude Code Always-On

A secure, self-hosted 24/7 AI assistant built on Claude Code, accessible via Telegram. Runs as a macOS launchd daemon with optional voice integration, semantic memory, and proactive intelligence.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black.svg)](https://bun.sh)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)](#prerequisites)

---

## Features

- **24/7 availability** : macOS launchd daemon with auto-restart
- **Telegram interface** : text, voice notes, images, documents, video
- **Conversation memory** : persistent history with pgvector semantic retrieval (optional)
- **Natural language commands** : instant local handling of remind / remember / search / forget / summary
- **Proactive intelligence** : morning briefings, evening summaries, deadline alerts
- **Goal tracking** : automatic goal detection from natural language
- **Voice integration** : phone calls via ElevenLabs + Twilio with full conversation context (optional)
- **Remote mode** : approve Claude Code permissions from your phone (optional)
- **Obsidian vault bridge** : read, write, and search your vault from Telegram (optional)
- **Permission-gated execution** : read-only by default; bash requires explicit `/bash` + `/confirm` two-step gate
- **Cost tracking** : per-user token usage and cost estimation via `/costs`

---

## Prerequisites

- **macOS** (launchd is required for daemon mode; the bot itself runs anywhere Bun runs)
- **[Bun](https://bun.sh)** runtime : `brew install oven-sh/bun/bun`
- **[Claude Code CLI](https://docs.anthropic.com/claude-code)** installed and authenticated : verify with `claude --version`
- A **Telegram account** to create a bot via [@BotFather](https://t.me/BotFather)
- An **Anthropic API key** : [console.anthropic.com](https://console.anthropic.com)

### Optional (only needed for specific features)

| Feature | What you need |
|---------|---------------|
| Semantic memory | Free [Supabase](https://supabase.com) project with pgvector extension + [Voyage AI](https://dash.voyageai.com) API key |
| Voice calls | [ElevenLabs](https://elevenlabs.io) API key + [Twilio](https://twilio.com) phone number |
| Voice transcription | [Gemini](https://aistudio.google.com) API key |
| Obsidian vault bridge | [Obsidian](https://obsidian.md) + [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/nmadrid27/claude-code-always-on.git
cd claude-code-always-on
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
chmod 600 .env
# Edit .env and fill in at minimum:
#   TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, ANTHROPIC_API_KEY
```

See [Environment Variables](#environment-variables) for the full reference.

### 3. (Optional) Apply database migrations

Skip this step if you do not want semantic memory.

Recommended: apply migrations through the Supabase dashboard SQL Editor.

1. Open your Supabase project at [app.supabase.com](https://app.supabase.com)
2. Database → Extensions → enable `vector`
3. SQL Editor → paste and run each file from `supabase/migrations/` in order:
   - `001_initial_schema.sql`
   - `002_security_hardening.sql`
   - `003_voyage_embeddings_1024.sql`

### 4. Run in development

```bash
bun run dev
```

Smoke test: open Telegram, send `/start` to your bot. You should receive a welcome message. Send any text message and confirm Claude Code responds. If nothing happens, see [Troubleshooting](#troubleshooting).

### 5. Install as a 24/7 daemon (macOS)

```bash
bash scripts/install-service.sh install
```

The bot will now restart automatically on crash and start on login.

---

## Getting your Telegram credentials

**Bot token**

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the token (format: `1234567890:ABCdef...`) into `TELEGRAM_BOT_TOKEN`

**Your user ID**

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It replies with your numeric user ID
3. Add it to `ALLOWED_USER_IDS` (comma-separated for multiple users)

---

## Environment Variables

The full reference, with descriptions and defaults, lives in [`.env.example`](.env.example). Summary:

### Required

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs that may use the bot |
| `ANTHROPIC_API_KEY` | Used by the Claude Code CLI the bot spawns |

### Required for semantic memory

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS; keep secret) |
| `VOYAGE_API_KEY` | Voyage AI embeddings (1024-d, used by `003_voyage_embeddings_1024.sql`) |

### Required for voice features

| Variable | Purpose |
|----------|---------|
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_REGION`, `ELEVENLABS_SIGNING_SECRET` | ElevenLabs voice agent + webhook verification |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Inbound phone calls |
| `GEMINI_API_KEY` | Voice transcription |
| `BOT_MODE=webhook`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_PORT`, `WEBHOOK_BASE_URL` | Public webhook server config |

---

## Service Management

```bash
# Install and start (survives reboot)
bash scripts/install-service.sh install

# Lifecycle
bash scripts/install-service.sh status
bash scripts/install-service.sh start
bash scripts/install-service.sh stop
bash scripts/install-service.sh restart

# Follow live logs
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
| `/bash` | Request bash + write tool access (step 1 of 2) |
| `/confirm` | Confirm and enable bash access (step 2 of 2) |
| `/vault` | Obsidian vault operations (read, write, search, tasks) [requires Obsidian Local REST API plugin and `OBSIDIAN_REST_API_KEY` + `OBSIDIAN_REST_URL` in `~/.env.local`] |
| `/away` | Enable remote mode (Telegram notifications on) |
| `/home` | Disable remote mode (notifications off) |

### Natural language commands (instant, no Claude invocation)

| Say this | What happens |
|----------|-------------|
| `remind me to call mom tomorrow at 3pm` | Creates a goal with deadline |
| `remember that I prefer dark mode` | Stores a user fact |
| `what did we talk about yesterday` | Searches conversation history |
| `forget about my tab preference` | Deletes matching facts |
| `daily summary` | Recaps today's messages |

### Optional terminal companion scripts (not bundled)

These are personal helper scripts the author runs from `~/.claude/scripts/`. They are **not included in this repository** — the bot works without them. [`docs/REMOTE-GUIDE.md`](docs/REMOTE-GUIDE.md) documents what they do so you can write your own.

| Command | Description |
|---------|-------------|
| `away` | Enable remote mode from a terminal (mirrors `/away`) |
| `home` | Disable remote mode (mirrors `/home`) |
| `claude-telegram` | Launch Claude Code with Telegram permission approval (uses the MCP server in `src/mcp/`) |
| `notify <cmd>` | Wrap a command and ping Telegram on completion or idle |

> Do not prefix these with `/` in your terminal. Typing `/away` inside a Claude Code session triggers Claude Code's own slash command system, not this bot.

---

## Security Model

| Layer | Implementation |
|-------|----------------|
| **Authentication** | Telegram user ID whitelist (`ALLOWED_USER_IDS`) |
| **Prompt injection** | All user input wrapped in an XML envelope before reaching Claude |
| **Execution gate** | `/bash` + `/confirm` two-step handshake to elevate from read-only |
| **Webhook auth** | Twilio HMAC-SHA1 on `X-Twilio-Signature`; ElevenLabs HMAC-SHA256 on `ElevenLabs-Signature` |
| **File paths** | Absolute paths stripped : only `basename` is exposed in prompts |
| **Credentials** | Environment variables only, never in source code |
| **Default tools** | `allowedTools: ["read"]` until bash is explicitly enabled |

See [`SECURITY.md`](SECURITY.md) for the full audit and threat model.

---

## Project Structure

```
src/
├── index.ts                    # Entry point, webhook server, graceful shutdown
├── bot.ts                      # Grammy handlers (text, photo, voice, doc, video, approvals)
├── relay.ts                    # Claude Code CLI spawner + JSON parser
├── mcp/
│   ├── telegram-approver.ts    # MCP server for Telegram permission approval
│   └── mcp-config.json.example # Template; install script generates the live config
├── middleware/
│   ├── auth.ts                 # User ID whitelist
│   ├── parser.ts               # Multi-modal message type detection
│   ├── security.ts             # Rate limiting, input validation, command safety
│   └── webhook-auth.ts         # Twilio HMAC-SHA1 + ElevenLabs HMAC-SHA256
├── database/                   # Supabase client + typed CRUD modules
└── services/                   # Context, vault, voice, goals, embeddings, etc.

scripts/
├── start-bot.sh                # launchd entrypoint
├── install-service.sh          # Service install / uninstall / status
└── run-migration.ts            # Optional migration helper (dashboard recommended)

supabase/migrations/            # Database schema + pgvector indexes
docs/                           # Remote mode and launchd guides
logs/                           # Runtime logs (gitignored)
tmp/                            # Downloaded files (gitignored, auto-cleaned)
```

---

## Troubleshooting

### Bot does not respond
- Confirm your Telegram user ID is in `ALLOWED_USER_IDS`
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Tail logs: `tail -f logs/bot-stdout.log`

### Service will not start
- Tail stderr: `tail -f logs/bot-stderr.log`
- Verify Bun is on PATH: `which bun`
- Confirm all required env vars are set in `.env`
- The startup script also writes to `logs/startup.log`

### Claude Code errors
- Verify `ANTHROPIC_API_KEY` is set and valid
- Confirm the Claude Code CLI works standalone: `claude --version`
- Default timeout is 300s (`CLAUDE_TIMEOUT=300000`); raise it for heavy operations

### Database connection errors
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- Check the Supabase project is not paused (free tier auto-pauses after inactivity)
- Confirm the `vector` extension is enabled

### Type errors
```bash
bun run type-check
bun install
```

---

## Cost Estimate

| Service | Approx. monthly |
|---------|-----------------|
| Anthropic (Claude) | $10–$200 depending on usage |
| ElevenLabs | $5–$20 (only if voice enabled) |
| Twilio | $10–$50 (only if voice enabled) |
| Supabase | Free tier |
| Voyage AI (embeddings) | ~$1–$5 |
| **Total** | **~$10 (text only) – $275 (all features)** |

---

## Contributing

Issues and pull requests are welcome. If you are planning a larger change, please open an issue first so we can discuss the approach.

1. Fork the repo
2. Create a feature branch from `main`
3. Run `bun run type-check` before opening a PR
4. Keep secrets out of commits ( `.env` is gitignored; do not change that )

---

## Disclaimer

This software runs with broad access on your local machine. It can spawn Claude Code with bash and write permissions when you grant them via `/bash` + `/confirm`. **You are responsible for what it executes.** Review the [Security Model](#security-model) and [`SECURITY.md`](SECURITY.md) before exposing it to anyone other than yourself.

The project is provided as-is, without warranty of any kind. See [LICENSE](LICENSE).

---

## License

[MIT](LICENSE) © 2026 Nathan Madrid

---

## Documentation

- [Remote Mode Guide](docs/REMOTE-GUIDE.md) : control Claude Code from Telegram (notifications, vault bridge, permission approval)
- [Launchd Setup](docs/LAUNCHD.md) : daemon configuration details
- [Security Audit](SECURITY.md) : threat model and hardening checklist
- [CLAUDE.md](CLAUDE.md) : guidance for Claude Code when working in this repo
