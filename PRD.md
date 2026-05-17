# Product Requirements Document (PRD)

## Claude Code Always-On: 24/7 AI Assistant via Telegram

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Author** | Nathan Madrid |
| **Date** | 2026-02-11 |
| **Status** | In Development |
| **Repository** | `https://github.com/nmadrid27/claude-code-always-on` |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users](#3-target-users)
4. [Product Goals & Success Metrics](#4-product-goals--success-metrics)
5. [Functional Requirements](#5-functional-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [System Architecture](#7-system-architecture)
8. [Technology Stack](#8-technology-stack)
9. [API & Integration Points](#9-api--integration-points)
10. [Environment Variables](#10-environment-variables)
11. [Database Schema](#11-database-schema)
12. [Risk Assessment](#12-risk-assessment)
13. [Future Roadmap](#13-future-roadmap)
14. [Cost Analysis](#14-cost-analysis)
15. [Glossary](#15-glossary)

---

## 1. Executive Summary

### 1.1 What Is Claude Code Always-On?

Claude Code Always-On is a **24/7 personal AI assistant** accessible through Telegram, powered by Claude Code running in **headless CLI mode**. Unlike typical AI chatbot integrations that relay messages to an API and return text, this system gives the AI agent access to a full set of **developer tools** -- bash shell execution, file reading, file writing, and web search -- enabling it to perform real actions on the user's behalf, not just generate text.

The assistant stores long-term semantic memory in Supabase with pgvector embeddings, automatically detects and tracks goals from natural conversation, sends proactive check-in notifications, processes multi-modal inputs (text, images, voice notes, documents, videos), and supports voice calls through ElevenLabs and Twilio integration.

### 1.2 Who Is It For?

- **Primary audience:** Developers and power users who want an AI assistant that can execute tasks, not just chat
- **Secondary audience:** Students learning to build AI-powered systems with real-world integrations

### 1.3 The Problem It Solves

Existing AI assistant apps (ChatGPT, Claude mobile) are conversational interfaces only. They cannot execute commands, read local files, persist memory across sessions, track goals with deadlines, or proactively reach out to the user. Claude Code Always-On bridges this gap by combining the power of a CLI-based AI agent with the convenience of a mobile messaging interface.

### 1.4 Key Differentiator

**Claude Code CLI in headless mode (`claude -p`)** -- this is not an API wrapper. The AI process has access to the same tools a developer has in their terminal:

| Capability | API-Only Bots | Claude Code Always-On |
|-----------|---------------|----------------------|
| Text generation | Yes | Yes |
| Read files on disk | No | Yes (`read` tool) |
| Write/edit files | No | Yes (`write` tool) |
| Execute shell commands | No | Yes (`bash` tool) |
| Search the web | No | Yes (`web-search` tool) |
| Persistent memory | Limited | Yes (Supabase + pgvector) |
| Goal tracking | No | Yes (auto-detection) |
| Proactive notifications | No | Yes (30-min intervals) |
| Voice calls | No | Yes (ElevenLabs + Twilio) |

---

## 2. Problem Statement

### 2.1 The Gap in Current AI Assistants

Users who rely on AI assistants throughout their day face several limitations with existing products:

1. **No persistent memory.** Each conversation starts from scratch. The AI does not remember that you are working on a deadline, that you prefer TypeScript over JavaScript, or that you asked about a topic three days ago.

2. **No tool execution.** Mobile AI apps can generate code snippets but cannot run them, read project files, or interact with the user's development environment.

3. **No proactive engagement.** Current assistants are purely reactive -- they respond only when asked. They do not check in on your goals, remind you of approaching deadlines, or alert you when something needs attention.

4. **No goal tracking.** Users mention commitments and deadlines in conversation, but those mentions vanish into chat history with no structured tracking.

5. **No voice call support.** Users cannot call their AI assistant for a hands-free conversation while driving, exercising, or cooking.

6. **Platform lock-in.** Most AI assistants require their proprietary app. Telegram is a cross-platform messaging app already on most users' phones.

### 2.2 Educational Value

This project also serves as a **practical case study** for students learning to build AI-powered systems. It demonstrates:

- How to integrate a CLI-based AI agent into a messaging platform
- Semantic memory architecture with vector embeddings
- Real-time webhook patterns for voice integration
- Process management with macOS launchd daemons
- Security hardening for AI systems that execute commands
- Cost tracking and monitoring for production AI services

---

## 3. Target Users

### 3.1 Primary Persona: The Power User Developer

**Name:** [Your Name]
**Role:** Developer, AI systems builder
**Technical Level:** Advanced

**Needs:**
- An AI assistant available 24/7 on mobile via Telegram
- Ability to ask the AI to read project files, run commands, and analyze code from a phone
- Long-term memory that persists context across days and weeks
- Automatic tracking of goals and commitments mentioned in conversation
- Voice call capability for hands-free interaction
- Cost visibility and control over AI invocations

**Pain Points:**
- Switching between phone and laptop to interact with AI tools
- Repeating context to AI assistants that forget previous conversations
- Manually tracking tasks mentioned in AI conversations
- No way to get proactive reminders from an AI about commitments

### 3.2 Secondary Persona: The Student Builder

**Name:** CS Student
**Role:** Learning AI system architecture
**Technical Level:** Intermediate

**Needs:**
- A well-documented, real-world AI project to study
- Clear architecture patterns for integrating multiple services
- Understanding of security considerations for AI-powered tools
- Practical examples of vector embeddings, webhooks, and process management

---

## 4. Product Goals & Success Metrics

### 4.1 Product Goals

| ID | Goal | Description |
|----|------|-------------|
| G-1 | 24/7 Availability | Bot runs continuously as a macOS daemon, auto-restarting on failure |
| G-2 | Fast Response | Sub-30-second response time for standard text messages |
| G-3 | Persistent Memory | Semantic memory across sessions using Supabase + pgvector |
| G-4 | Goal Tracking | Automatic detection and tracking of goals from natural language |
| G-5 | Multi-Modal Input | Support for text, photos, voice notes, documents, and videos |
| G-6 | Proactive Check-Ins | Periodic review of goals with intelligent notifications |
| G-7 | Voice Calls | Full phone call capability with context-aware conversation |
| G-8 | Security | Permission-gated execution with no auto-approval of dangerous commands |
| G-9 | Cost Transparency | Real-time tracking of API costs per invocation and per user |
| G-10 | Educational Value | Clean, well-documented codebase suitable for teaching |

### 4.2 Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Uptime | 99.5% (excluding planned maintenance) | Heartbeat file monitoring via launchd |
| Text response latency | < 30 seconds (p95) | Logged duration in cost tracker |
| Memory recall accuracy | Relevant context retrieved for 80%+ of queries | Manual evaluation of semantic search results |
| Goal detection precision | > 70% of stated goals detected | Spot-check against `/goals` command output |
| Auto-restart time | < 10 seconds after crash | launchd ThrottleInterval configuration |
| Monthly cost | < $275/month at moderate usage | `/costs` command and cost tracker logs |

---

## 5. Functional Requirements

### FR-1: Text Message Processing

**Description:** The bot receives text messages via Telegram, relays them to Claude Code CLI in headless mode, and returns the response.

**Data Flow:**
```
User sends text in Telegram
  --> Grammy bot receives message
    --> Auth middleware validates user ID
      --> Message parser extracts text content
        --> Relay invokes `claude -p "<prompt>" --output-format json --allowedTools bash,read,write`
          --> Claude Code executes with tool access
            --> Response truncated to 3500 chars for Telegram
              --> Bot sends response to user
```

**Acceptance Criteria:**
- [x] Messages from unauthorized users are rejected with a friendly error
- [x] A "thinking" indicator is shown while Claude Code processes the request
- [x] Response is formatted for Telegram (Markdown with plain-text fallback)
- [x] Responses exceeding 3500 characters are truncated at a sentence boundary
- [x] Execution timeout of 2 minutes prevents runaway processes
- [x] Cost and token usage are recorded for each invocation
- [x] Goal detection runs asynchronously after the response is sent

---

### FR-2: Photo Analysis

**Description:** The bot receives photos from Telegram, downloads them to a local temporary directory, and passes the file path to Claude Code for image analysis.

**Data Flow:**
```
User sends photo in Telegram
  --> Grammy bot extracts largest photo variant + file_id
    --> Bot downloads photo via Telegram File API to /tmp
      --> Relay invokes Claude Code with prompt referencing the local file path
        --> Claude Code reads the image using its read tool
          --> Analysis response sent back to user
```

**Acceptance Criteria:**
- [x] The largest available photo resolution is selected from Telegram's array
- [x] Photos are downloaded to the project's `tmp/` directory
- [x] Optional captions are included as context in the analysis prompt
- [x] Allowed tools for photo analysis are limited to `bash` and `read` (no write)
- [x] Download failures produce a user-friendly error message

---

### FR-3: Voice Note Handling

**Description:** The bot receives voice notes (`.ogg` files) from Telegram, downloads them locally, and acknowledges receipt. Full transcription is a future enhancement.

**Data Flow:**
```
User sends voice note in Telegram
  --> Grammy bot extracts voice file_id and duration
    --> Bot downloads .ogg file to local tmp/ directory
      --> Bot acknowledges receipt with file metadata
        --> (Future: Whisper/Gemini transcription --> Claude Code processing)
```

**Acceptance Criteria:**
- [x] Voice notes are downloaded and saved locally with a timestamped filename
- [x] Duration metadata is extracted and displayed
- [x] User is informed that transcription is not yet available
- [x] File path is stored for future processing

---

### FR-4: Document Analysis

**Description:** The bot receives documents (PDFs, text files, code files, etc.), downloads them, extracts text content where possible, and passes the content to Claude Code for analysis.

**Data Flow:**
```
User sends document in Telegram
  --> Grammy bot extracts document file_id, filename, MIME type
    --> Bot downloads file to local tmp/ directory
      --> Text extraction attempted for known text file extensions
        --> If text: Content (up to 10,000 chars) passed directly to Claude Code
        --> If binary: Metadata-only analysis, file path provided for tool-based reading
          --> Response sent to user
```

**Supported Text Extensions:**
`.txt`, `.md`, `.json`, `.csv`, `.py`, `.ts`, `.js`, `.jsx`, `.tsx`, `.html`, `.css`, `.xml`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.sh`, `.bash`, `.zsh`, `.sql`, `.rb`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, `.hpp`, `.swift`, `.kt`, `.r`, `.lua`, `.log`

**Acceptance Criteria:**
- [x] Text-based files have their content extracted and passed to Claude Code
- [x] Binary files (PDFs, images) are acknowledged with metadata and saved for tool-based reading
- [x] Content is truncated at 10,000 characters with a truncation notice
- [x] Filenames are sanitized to prevent directory traversal attacks
- [x] Maximum file size is enforced at 50MB

---

### FR-5: Video Metadata Analysis

**Description:** The bot receives video files, downloads them, and provides metadata analysis. Full video frame extraction is a future enhancement.

**Acceptance Criteria:**
- [x] Video files are downloaded with a timestamped filename
- [x] Metadata (duration, resolution, file size, MIME type) is extracted and displayed
- [x] Optional captions are included as context
- [x] Allowed tools are limited to `bash` and `read`

---

### FR-6: Goal Detection and Tracking

**Description:** After each text message response, the system asynchronously analyzes the user's message for goals, tasks, and commitments using Claude Code's natural language understanding.

**Detection Process:**
```
User message: "I need to finish the video by 5pm"
  --> Goal detection prompt sent to Claude Code (30s timeout)
    --> Claude returns JSON: [{ description: "Finish the video", deadline: "2026-02-11T17:00:00Z", priority: 7, category: "work" }]
      --> Goal stored in Supabase goals table
        --> User sees goal in /goals command
```

**Commands:**
- `/goals` -- Lists all active goals with priority indicators, categories, and deadlines

**Acceptance Criteria:**
- [x] Goals are detected from natural language without explicit commands
- [x] Detection runs asynchronously (does not block message responses)
- [x] Commands (messages starting with `/`) are excluded from detection
- [x] Very short messages (< 5 characters) are excluded
- [x] Each detected goal includes: description, optional deadline, priority (1-10), optional category
- [x] Goals are persisted in Supabase with vector embeddings
- [x] `/goals` command displays formatted list with priority emojis

---

### FR-7: Proactive Check-Ins

**Description:** A background service runs every 30 minutes, checking each authorized user's goals and deadlines. It uses Claude Code to decide whether a notification is warranted and what message to send.

**Check-In Logic:**
```
Every 30 minutes:
  For each authorized user:
    1. Fetch active goals from Supabase
    2. Check for approaching deadlines (within 60 minutes or 15 minutes overdue)
    3. Send goals + deadlines to Claude Code with notification decision prompt
    4. Claude returns: { shouldNotify: true/false, message: "..." }
    5. If shouldNotify: Send message to user via Telegram
```

**Fallback Logic (when Claude Code is unavailable):**
- Notify only for deadlines within 15 minutes or overdue
- Use a simple template message listing urgent deadlines

**Acceptance Criteria:**
- [x] Service runs on a configurable interval (default: 30 minutes)
- [x] Initial check-in runs 10 seconds after bot startup
- [x] Claude Code determines both whether and what to notify
- [x] Fallback logic handles Claude Code failures gracefully
- [x] Service can be started and stopped independently
- [x] Feature can be disabled via `FEATURE_PROACTIVE_CHECKINS=false`

---

### FR-8: Semantic Memory

**Description:** All user messages are stored in Supabase with vector embeddings generated by OpenAI's `text-embedding-3-large` model (3072 dimensions). This enables semantic similarity search to retrieve relevant context from past conversations.

**Memory Architecture:**
```
User message received
  --> Stored in messages table (content, role, user_id, metadata)
    --> Embedding generated asynchronously via OpenAI API
      --> Embedding stored on the message row

Context retrieval for voice calls or searches:
  Query text --> Generate query embedding
    --> RPC: search_similar_messages(query_embedding, user_id, limit, threshold)
      --> Returns messages ranked by cosine similarity (threshold >= 0.7)
```

**Memory Components:**
1. **Messages** -- Full conversation history with embeddings
2. **Goals** -- Tracked goals with embeddings for semantic search
3. **User Facts** -- Learned facts about the user (preferences, context) with confidence scores
4. **Conversation Contexts** -- Session summaries for efficient context retrieval

**Acceptance Criteria:**
- [x] Messages are stored with UUID primary keys and timestamps
- [x] Embeddings are generated asynchronously (non-blocking)
- [x] Semantic search returns relevant messages above a similarity threshold
- [x] Fallback to text-based search when embeddings are unavailable
- [x] Feature can be disabled via `FEATURE_MEMORY_ENABLED=false`

---

### FR-9: Cost Tracking

**Description:** Every Claude Code invocation is tracked in memory with token usage, estimated cost, duration, and operation type. Users can view their usage statistics via the `/costs` command.

**Cost Model:**
- Estimated cost per invocation: blended rate of ~$6 per million tokens
- Tracked per user and globally
- Resets on service restart (in-memory storage)

**Commands:**
- `/costs` -- Displays per-user session statistics
- `/health` endpoint -- Returns global stats including cost and error counts

**Acceptance Criteria:**
- [x] Every successful Claude Code invocation records: userId, timestamp, cost, tokensUsed, durationMs, operation
- [x] `/costs` shows: total invocations, total tokens, average tokens per request, estimated cost
- [x] `/health` endpoint returns: uptime, total invocations, total tokens, estimated cost, recent errors
- [x] Error count is tracked separately for monitoring

---

### FR-10: Voice Calls

**Description:** The system supports inbound and outbound phone calls through Twilio, connected to an ElevenLabs conversational AI voice agent. Memory context is injected into the voice agent for continuity with Telegram conversations.

**Voice Call Flow:**
```
Inbound Call via Twilio
  --> Twilio webhook hits /voice/inbound
    --> User identified by phone number mapping
      --> Context fetched from Supabase (recent 15 messages, goals, facts)
        --> Call session created with context
          --> TwiML returned connecting to ElevenLabs agent
            --> ElevenLabs agent conducts conversation with injected context
              --> Transcript events stored in memory
                --> Call ends --> Post-call processing:
                  - Summary generated
                  - Tasks extracted
                  - Actions determined (goals, reminders, messages)
                  - Telegram notification sent
```

**Webhook Endpoints:**
- `POST /voice/inbound` -- Handles incoming Twilio calls, returns TwiML
- `POST /voice/status` -- Receives call status updates (ringing, answered, completed, failed)
- `POST /voice/elevenlabs` -- Receives ElevenLabs agent events (connected, disconnected, transcript)

**Acceptance Criteria:**
- [x] Inbound calls are handled with TwiML connecting to ElevenLabs
- [x] Context is injected into the voice agent session
- [x] Transcript entries are stored in real-time
- [x] Post-call processing extracts actionable items
- [x] Call summaries are sent to Telegram
- [x] Feature requires `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

---

### FR-11: Health Monitoring

**Description:** The system provides health monitoring through multiple mechanisms.

**Monitoring Components:**
1. **Heartbeat file** -- Updated every 5 minutes at `logs/heartbeat.timestamp`
2. **Health endpoint** -- `GET /health` (webhook mode only) returns JSON with uptime, invocations, costs, errors
3. **Structured logging** -- JSON-formatted logs with timestamp, level, component, and metadata
4. **launchd monitoring** -- ExitTimeOut of 1800 seconds (30 minutes) triggers restart if heartbeat stales

**Acceptance Criteria:**
- [x] Heartbeat file is updated every 5 minutes
- [x] `/health` endpoint returns 200 with structured JSON
- [x] All log entries are JSON-formatted with component tags
- [x] Log level is configurable via `LOG_LEVEL` (debug, info, warn, error)
- [x] launchd auto-restarts the service after crashes (5-second throttle)

---

### FR-12: Authentication

**Description:** A whitelist-based authentication system restricts bot access to explicitly authorized Telegram user IDs.

**Implementation:**
```
ALLOWED_USER_IDS=123456789,987654321

Incoming message
  --> Extract ctx.from.id
    --> Check against ALLOWED_IDS Set
      --> If authorized: Proceed to handler
      --> If not: Reply with "not authorized" + user ID for debugging
```

**Acceptance Criteria:**
- [x] Only users in `ALLOWED_USER_IDS` can interact with the bot
- [x] Unauthorized users receive a friendly message with their user ID
- [x] Empty whitelist logs a warning and rejects all users
- [x] User IDs are validated as positive integers between 7 and 10 digits
- [x] Whitelist is parsed once at startup for performance

---

## 6. Non-Functional Requirements

### 6.1 Security

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| **User whitelist** | Telegram user ID set parsed from `ALLOWED_USER_IDS` | Implemented |
| **Input validation** | Max text length 4000 chars, max file 50MB, empty input rejection | Implemented |
| **Rate limiting** | Configurable per-user limits (default: 10 requests per 60 seconds) | Implemented |
| **Dangerous command detection** | Regex patterns block `rm -rf /`, `dd`, `mkfs`, `shutdown`, `reboot`, piped `curl\|sh` | Implemented |
| **No auto-approval** | `CLAUDE_AUTO_APPROVE=false` enforced on all Claude Code invocations | Implemented |
| **Permission levels** | Four tiers: `read_only`, `safe`, `standard`, `full` (default: `standard`) | Implemented |
| **Credential isolation** | All secrets in `.env`, `.env` in `.gitignore`, `.env.example` for templates | Implemented |
| **Filename sanitization** | Path components stripped, null bytes removed, dangerous characters replaced | Implemented |
| **Network isolation** | Bot uses Telegram polling (no open ports); webhook mode optional for production | Implemented |
| **Process sandboxing** | Claude Code runs with `--allowedTools` flag restricting tool access | Implemented |

### 6.2 Performance

| Requirement | Target |
|-------------|--------|
| Claude Code invocation timeout | 2 minutes (text), 5 minutes (tool-using tasks) |
| Telegram message length | 3500 characters (with truncation at sentence boundaries) |
| Goal detection timeout | 30 seconds |
| Proactive check-in decision timeout | 30 seconds |
| Heartbeat interval | 5 minutes |
| Proactive check-in interval | 30 minutes (configurable) |
| Maximum concurrent requests | 10 |

### 6.3 Reliability

| Requirement | Implementation |
|-------------|----------------|
| **Auto-restart** | launchd `KeepAlive` with `SuccessfulExit: false` and `Crashed: true` |
| **Restart throttle** | 5-second `ThrottleInterval` prevents restart loops |
| **Graceful shutdown** | SIGINT/SIGTERM handlers stop proactive service, heartbeat, and bot in order |
| **Shutdown timeout** | 10-second forced exit if graceful shutdown stalls |
| **Uncaught error handling** | `uncaughtException` and `unhandledRejection` trigger graceful shutdown |
| **Process priority** | `Nice: 10` and `ProcessType: Adaptive` for background resource management |

### 6.4 Logging

| Requirement | Implementation |
|-------------|----------------|
| **Format** | Structured JSON with `timestamp`, `level`, `component`, `message`, and metadata |
| **Levels** | `debug`, `info`, `warn`, `error` (configurable via `LOG_LEVEL`) |
| **Components** | Each module creates a scoped logger (e.g., `bot`, `relay`, `index`, `cost-tracker`) |
| **Output** | stdout/stderr, captured to `logs/bot-stdout.log` and `logs/bot-stderr.log` by launchd |
| **Sensitive data** | No credentials, tokens, or full message content logged |

### 6.5 Scalability

| Requirement | Implementation |
|-------------|----------------|
| **Multi-user support** | All database tables keyed by `telegram_user_id`; RLS policies enabled |
| **Per-user memory services** | Factory function creates `MemoryService` instances per user ID |
| **Per-user rate limiting** | `RateLimiter` class tracks requests per user with sliding window |
| **Webhook mode** | Optional `BOT_MODE=webhook` for production deployment behind a reverse proxy |

---

## 7. System Architecture

### 7.1 High-Level Architecture

```
+--------------------+       +---------------------+       +-------------------+
|                    |       |                     |       |                   |
|   User's Phone     |       |   macOS Machine     |       |   Cloud Services  |
|   (Telegram App)   |       |   (Always Running)  |       |                   |
|                    |       |                     |       |                   |
|  +-------------+   |       |  +---------------+  |       |  +-----------+    |
|  | Text/Photo/ |   | <---> |  | Grammy Bot    |  | <---> |  | Telegram  |    |
|  | Voice/Doc   |   |       |  | (Bun runtime) |  |       |  | Bot API   |    |
|  +-------------+   |       |  +-------+-------+  |       |  +-----------+    |
|                    |       |          |           |       |                   |
+--------------------+       |  +-------v-------+  |       |  +-----------+    |
                             |  | Claude Code   |  |       |  | Supabase  |    |
+--------------------+       |  | CLI (headless)|  | <---> |  | PostgreSQL|    |
|                    |       |  | bash/read/    |  |       |  | + pgvector|    |
|   User's Phone     |       |  | write tools   |  |       |  +-----------+    |
|   (Phone Call)     |       |  +---------------+  |       |                   |
|                    |       |          |           |       |  +-----------+    |
|  +-------------+   |       |  +-------v-------+  |       |  | OpenAI    |    |
|  | Twilio Call  |   | <---> |  | Bun.serve()   |  | <---> |  | Embeddings|    |
|  +-------------+   |       |  | Webhook Server|  |       |  | API       |    |
|                    |       |  +-------+-------+  |       |  +-----------+    |
+--------------------+       |          |           |       |                   |
                             |  +-------v-------+  |       |  +-----------+    |
                             |  | ElevenLabs    |  | <---> |  | ElevenLabs|    |
                             |  | Voice Agent   |  |       |  | Conv. AI  |    |
                             |  +---------------+  |       |  +-----------+    |
                             |                     |       |                   |
                             |  +---------------+  |       |  +-----------+    |
                             |  | launchd Daemon|  |       |  | Twilio    |    |
                             |  | (auto-restart)|  |       |  | Voice API |    |
                             |  +---------------+  |       |  +-----------+    |
                             |                     |       |                   |
                             +---------------------+       +-------------------+
```

### 7.2 Component Diagram

```
src/
+----------------------------------------------------------+
|  index.ts (Entry Point)                                  |
|  - Environment validation                                 |
|  - Bot startup (polling or webhook mode)                  |
|  - Bun.serve() for webhook/health endpoints               |
|  - Graceful shutdown handlers                             |
|  - Proactive service initialization                       |
+----------+-------------------+------------------+---------+
           |                   |                  |
           v                   v                  v
+----------+------+  +---------+--------+  +------+---------+
|  bot.ts         |  |  relay.ts        |  |  services/     |
|  Grammy Bot     |  |  Claude Code     |  |  proactive.ts  |
|  - /start       |  |  Relay Wrapper   |  |  goals.ts      |
|  - /help        |  |  - Spawn process |  |  memory.ts     |
|  - /status      |  |  - Parse JSON    |  |  voice.ts      |
|  - /goals       |  |  - Truncate      |  |  embeddings.ts |
|  - /costs       |  |  - Timeout       |  |  cost-tracker  |
|  - Text handler |  |  - Stream        |  |  logger.ts     |
|  - Photo handler|  +------------------+  |  heartbeat.ts  |
|  - Voice handler|                        |  claude-wrap.ts |
|  - Doc handler  |                        +----------------+
|  - Video handler|
+---------+-------+
          |
          v
+---------+-----------+    +--------------------------+
|  middleware/         |    |  database/               |
|  auth.ts (whitelist) |    |  supabase.ts (client)    |
|  parser.ts (multi-   |    |  goals.ts (CRUD)         |
|    modal detection)  |    |  messages.ts (CRUD)      |
|  security.ts (input  |    |  user-facts.ts (CRUD)    |
|    validation, rate  |    |  client.ts               |
|    limiting, perms)  |    |  index.ts                |
+----------------------+    +--------------------------+
```

### 7.3 Message Processing Flow

```
                    +-------------------+
                    |  Telegram Update  |
                    +--------+----------+
                             |
                    +--------v----------+
                    |  Auth Middleware   |
                    |  (user ID check)  |
                    +--------+----------+
                             |
                    +--------v----------+
                    |  Message Parser   |
                    |  (type detection) |
                    +--------+----------+
                             |
              +--------------+---------------+
              |              |               |
     +--------v--+   +------v----+   +------v------+
     |   TEXT     |   |  PHOTO    |   |  DOCUMENT   |
     +--------+--+   +------+----+   +------+------+
              |              |               |
              |       +------v------+  +-----v-------+
              |       | Download    |  | Download    |
              |       | from Tg API |  | + Extract   |
              |       +------+------+  | text content|
              |              |         +-----+-------+
              |              |               |
              +--------------+------+--------+
                                    |
                           +--------v---------+
                           |  Claude Code CLI  |
                           |  claude -p "..."  |
                           |  --output-format  |
                           |  json             |
                           |  --allowedTools   |
                           |  bash,read,write  |
                           +--------+---------+
                                    |
                           +--------v---------+
                           |  Parse Response   |
                           |  Truncate (3500)  |
                           |  Format Markdown  |
                           +--------+---------+
                                    |
                    +---------------+----------------+
                    |               |                |
           +--------v--+   +-------v------+  +------v-------+
           | Send Reply|   | Record Cost  |  | Detect Goals |
           | to User   |   | (in-memory)  |  | (async/bg)   |
           +-----------+   +--------------+  +--------------+
```

---

## 8. Technology Stack

### 8.1 Core Technologies

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | Bun | 1.x | Fast JavaScript/TypeScript runtime; native .env loading, Bun.spawn(), Bun.serve(), Bun.file() |
| **Language** | TypeScript | 5.x | Type safety across the entire codebase; strict mode enabled |
| **Bot Framework** | Grammy | 1.40.0 | Telegram Bot API client; middleware support, message parsing, command handlers |
| **Database** | Supabase | -- | Hosted PostgreSQL with pgvector extension, RLS, REST API, Edge Functions |
| **Database Client** | @supabase/supabase-js | 2.95.3 | TypeScript client for Supabase REST and RPC calls |
| **AI Engine** | Claude Code CLI | -- | Headless AI agent with bash, read, write, web-search tools |
| **Embeddings** | OpenAI API | -- | text-embedding-3-large (3072 dimensions) for semantic search |
| **Voice AI** | ElevenLabs | -- | Conversational AI voice agent for phone calls |
| **Telephony** | Twilio | -- | Inbound/outbound phone calls via TwiML and webhooks |
| **Daemon** | macOS launchd | -- | Process management, auto-restart, logging, boot-time startup |

### 8.2 Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @types/bun | 1.3.9 | TypeScript definitions for Bun APIs |
| @types/node | 25.2.3 | TypeScript definitions for Node.js APIs used by dependencies |
| typescript | 5.x (peer) | TypeScript compiler for type checking |

### 8.3 TypeScript Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| `target` | ESNext | Use latest JavaScript features |
| `module` | Preserve | Let Bun handle module resolution |
| `strict` | true | Catch type errors early |
| `noEmit` | true | Bun runs TypeScript directly, no compilation step |
| `noUncheckedIndexedAccess` | true | Prevent undefined access on arrays/objects |
| `moduleResolution` | bundler | Match Bun's module resolution behavior |

---

## 9. API & Integration Points

### 9.1 Telegram Bot API

| Operation | Method | Details |
|-----------|--------|---------|
| Receive messages | Long polling / Webhook | Grammy handles both modes |
| Send messages | `bot.api.sendMessage()` | Markdown or plain text |
| Delete messages | `bot.api.deleteMessage()` | Used to remove "thinking" indicators |
| Download files | `bot.api.getFile()` + HTTP GET | Two-step: get file path, then download |
| Set webhook | `bot.api.setWebhook()` | For production webhook mode |

**Authentication:** Bot token in `TELEGRAM_BOT_TOKEN`

---

### 9.2 Claude Code CLI

| Flag | Value | Purpose |
|------|-------|---------|
| `-p` | `"<prompt>"` | Headless mode -- send prompt, get response, exit |
| `--output-format` | `json` | Structured JSON output for programmatic parsing |
| `--allowedTools` | `bash,read,write` | Restrict which tools Claude can use |

**Invocation Pattern:**
```bash
claude -p "List all TypeScript files in src/" \
  --output-format json \
  --allowedTools bash,read,write
```

**Environment:**
- `ANTHROPIC_API_KEY` passed to the spawned process
- `CLAUDE_AUTO_APPROVE=false` enforced in environment

**Response Format:**
```json
{
  "type": "result",
  "result": "Found 12 TypeScript files...",
  "usage": {
    "total_tokens": 1250
  }
}
```

---

### 9.3 Supabase REST API & RPC

| Operation | Method | Table/Function |
|-----------|--------|---------------|
| Store message | INSERT | `messages` |
| Fetch recent messages | SELECT (ordered by created_at DESC) | `messages` |
| Semantic search | RPC | `search_similar_messages()` |
| Create goal | INSERT | `goals` |
| Fetch active goals | SELECT (status = 'active') | `goals` |
| Update goal status | UPDATE | `goals` |
| Search relevant goals | RPC | `search_relevant_goals()` |
| Upsert user fact | INSERT/UPDATE | `user_facts` |
| Search relevant facts | RPC | `search_relevant_facts()` |

**Authentication:** `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS for server-side operations)

---

### 9.4 OpenAI Embeddings API

| Parameter | Value |
|-----------|-------|
| Endpoint | `POST https://api.openai.com/v1/embeddings` |
| Model | `text-embedding-3-large` |
| Dimensions | 3072 |
| Encoding format | `float` |

**Authentication:** Bearer token via `OPENAI_API_KEY`

---

### 9.5 ElevenLabs Conversational AI

| Operation | Endpoint |
|-----------|----------|
| Agent connection | `wss://{region}.elevenlabs.io/v1/conv-agent/{agent_id}/twilio` |
| Context injection | `POST https://api.elevenlabs.io/v1/conv-agent/{agent_id}/session/{session_id}/context` |

**Authentication:** `xi-api-key` header with `ELEVENLABS_API_KEY`

---

### 9.6 Twilio Voice API

| Webhook | Method | Purpose |
|---------|--------|---------|
| `/voice/inbound` | POST | Receive inbound calls, return TwiML |
| `/voice/status` | POST | Receive call status updates |
| `/voice/elevenlabs` | POST | Receive ElevenLabs agent events |

**TwiML Response Pattern:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://us.elevenlabs.io/v1/conv-agent/{agent_id}/twilio" />
  </Connect>
</Response>
```

---

## 10. Environment Variables

### 10.1 Required Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | String | Bot token from @BotFather | `1234567890:ABCdefGHI...` |
| `ALLOWED_USER_IDS` | Comma-separated integers | Authorized Telegram user IDs | `123456789,987654321` |
| `CLAUDE_TIMEOUT` | Integer (ms) | Max execution time for Claude Code (1000-600000) | `300000` |

### 10.2 Security Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DEFAULT_PERMISSION_LEVEL` | Enum | `standard` | Permission tier: `read_only`, `safe`, `standard`, `full` |
| `CLAUDE_AUTO_APPROVE` | Boolean | `false` | Never set to true in production |

### 10.3 Optional: Database & Memory

| Variable | Type | Required For | Description |
|----------|------|-------------|-------------|
| `SUPABASE_URL` | URL | Semantic memory | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | String | Semantic memory | Service role key (bypasses RLS) |
| `SUPABASE_ANON_KEY` | String | Client-side operations | Anonymous key |
| `OPENAI_API_KEY` | String | Embeddings | OpenAI API key for text-embedding-3-large |

### 10.4 Optional: Voice Services

| Variable | Type | Required For | Description |
|----------|------|-------------|-------------|
| `ELEVENLABS_API_KEY` | String | Voice calls | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | String | Voice calls | Conversational AI agent ID |
| `ELEVENLABS_VOICE_ID` | String | Custom voice | Override agent default voice |
| `ELEVENLABS_REGION` | String | Voice calls | API region (default: `us`) |
| `TWILIO_ACCOUNT_SID` | String | Phone calls | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | String | Phone calls | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | String | Phone calls | Twilio phone number |
| `GEMINI_API_KEY` | String | Voice transcription | Gemini API key for audio transcription |

### 10.5 Optional: Application Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BOT_MODE` | Enum | `polling` | `polling` for development, `webhook` for production |
| `WEBHOOK_URL` | URL | -- | Public URL for Telegram webhook |
| `WEBHOOK_SECRET` | String | -- | Secret token for webhook verification |
| `WEBHOOK_PORT` | Integer | `3000` | Port for webhook HTTP server |
| `LOG_LEVEL` | Enum | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX_REQUESTS` | Integer | `10` | Max requests per window per user |
| `RATE_LIMIT_WINDOW_MS` | Integer | `60000` | Rate limit window in milliseconds |
| `NODE_ENV` | String | -- | Set to `production` by launchd plist |

### 10.6 Feature Flags

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FEATURE_VOICE_ENABLED` | Boolean | `false` | Enable voice call features |
| `FEATURE_MEMORY_ENABLED` | Boolean | `false` | Enable Supabase semantic memory |
| `FEATURE_PROACTIVE_CHECKINS` | Boolean | `false` | Enable proactive check-in service |
| `PROACTIVE_CHECKIN_INTERVAL_MINUTES` | Integer | `30` | Check-in interval in minutes |
| `PHONE_USER_MAP` | String | -- | Phone-to-user mapping: `+15551234:123456789,+15555678:987654321` |

---

## 11. Database Schema

### 11.1 Extension

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The `vector` extension (pgvector) enables storage and similarity search on high-dimensional embedding vectors.

### 11.2 Tables

#### `messages`

Stores all conversation messages with optional vector embeddings for semantic search.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique message identifier |
| `telegram_user_id` | BIGINT | NOT NULL | Telegram user ID of the message sender/recipient |
| `telegram_message_id` | BIGINT | -- | Original Telegram message ID (for reference) |
| `role` | TEXT | NOT NULL, CHECK (role IN ('user', 'assistant', 'system')) | Who sent the message |
| `content` | TEXT | NOT NULL | Full message text content |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | When the message was stored |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp (auto-updated by trigger) |
| `embedding` | VECTOR(3072) | -- | OpenAI text-embedding-3-large vector |
| `metadata` | JSONB | DEFAULT '{}' | Arbitrary metadata (source, type, etc.) |

**Indexes:**
- `idx_messages_user_created` on `(telegram_user_id, created_at DESC)` -- Fast retrieval of recent messages per user
- `idx_messages_role` on `(role)` -- Filter by message role

---

#### `goals`

Stores user goals with priority, category, and semantic search capability.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique goal identifier |
| `telegram_user_id` | BIGINT | NOT NULL | Owner's Telegram user ID |
| `title` | TEXT | NOT NULL | Short goal title (max 100 chars) |
| `description` | TEXT | -- | Detailed goal description |
| `status` | TEXT | DEFAULT 'active', CHECK (status IN ('active', 'completed', 'archived')) | Goal lifecycle status |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | When the goal was created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |
| `completed_at` | TIMESTAMPTZ | -- | When the goal was completed |
| `priority` | INTEGER | DEFAULT 5, CHECK (priority BETWEEN 1 AND 10) | Priority level (1=low, 10=critical) |
| `category` | TEXT | -- | Optional category label (e.g., "work", "personal") |
| `embedding` | VECTOR(3072) | -- | Semantic embedding for relevance search |
| `metadata` | JSONB | DEFAULT '{}' | Arbitrary metadata (deadline, notes, etc.) |

**Indexes:**
- `idx_goals_user_status` on `(telegram_user_id, status)` -- Fast active goals lookup
- `idx_goals_priority` on `(priority DESC)` -- Sort by priority

---

#### `user_facts`

Stores learned facts about users (preferences, context, etc.) with confidence scoring and access tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique fact identifier |
| `telegram_user_id` | BIGINT | NOT NULL | User this fact belongs to |
| `fact_type` | TEXT | NOT NULL | Category of fact (e.g., "preference", "context", "identity") |
| `fact_text` | TEXT | NOT NULL | The fact content |
| `confidence` | INTEGER | DEFAULT 5, CHECK (confidence BETWEEN 1 AND 10) | How confident we are in this fact |
| `source` | TEXT | -- | Where the fact was learned (e.g., "conversation", "explicit") |
| `source_message_id` | UUID | FK -> messages(id) ON DELETE SET NULL | Original message that revealed this fact |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | When the fact was first learned |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |
| `last_accessed_at` | TIMESTAMPTZ | DEFAULT NOW() | When the fact was last used |
| `access_count` | INTEGER | DEFAULT 0 | How often the fact has been retrieved |
| `embedding` | VECTOR(3072) | -- | Semantic embedding for relevance search |

**Constraints:**
- UNIQUE on `(telegram_user_id, fact_type, fact_text)` -- Prevent duplicate facts

**Indexes:**
- `idx_facts_user_type` on `(telegram_user_id, fact_type)` -- Fast lookup by user and type
- `idx_facts_confidence` on `(confidence DESC)` -- Sort by confidence

---

#### `conversation_contexts`

Stores conversation session summaries for efficient context retrieval without loading full message history.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique context identifier |
| `telegram_user_id` | BIGINT | NOT NULL | User this context belongs to |
| `session_id` | TEXT | NOT NULL | Unique session identifier |
| `started_at` | TIMESTAMPTZ | DEFAULT NOW() | When the session started |
| `ended_at` | TIMESTAMPTZ | -- | When the session ended |
| `summary` | TEXT | -- | AI-generated summary of the session |
| `summary_embedding` | VECTOR(3072) | -- | Embedding of the summary for search |
| `message_count` | INTEGER | DEFAULT 0 | Number of messages in the session |
| `metadata` | JSONB | DEFAULT '{}' | Arbitrary metadata |

**Constraints:**
- UNIQUE on `(telegram_user_id, session_id)` -- One context per session per user

**Indexes:**
- `idx_contexts_user_time` on `(telegram_user_id, started_at DESC)` -- Recent sessions first

### 11.3 RPC Functions

#### `search_similar_messages`

Performs cosine similarity search on message embeddings.

```sql
search_similar_messages(
  query_embedding VECTOR(3072),        -- The query vector
  target_user_id  BIGINT DEFAULT NULL, -- Filter by user (NULL = all users)
  limit_count     INTEGER DEFAULT 10,  -- Max results
  similarity_threshold REAL DEFAULT 0.7 -- Minimum similarity score
)
RETURNS TABLE (
  id               UUID,
  telegram_user_id BIGINT,
  role             TEXT,
  content          TEXT,
  similarity       REAL
)
```

**Security:** `SECURITY DEFINER` -- runs with the function owner's permissions.

---

#### `search_relevant_goals`

Finds goals semantically similar to a query.

```sql
search_relevant_goals(
  query_embedding VECTOR(3072),
  target_user_id  BIGINT,
  limit_count     INTEGER DEFAULT 5,
  similarity_threshold REAL DEFAULT 0.6
)
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  description TEXT,
  status      TEXT,
  similarity  REAL
)
```

**Filters:** Only returns `active` goals with non-null embeddings.

---

#### `search_relevant_facts`

Finds user facts semantically similar to a query.

```sql
search_relevant_facts(
  query_embedding VECTOR(3072),
  target_user_id  BIGINT,
  limit_count     INTEGER DEFAULT 10,
  similarity_threshold REAL DEFAULT 0.65
)
RETURNS TABLE (
  id         UUID,
  fact_type  TEXT,
  fact_text  TEXT,
  confidence INTEGER,
  similarity REAL
)
```

### 11.4 Triggers

#### `update_updated_at()`

Automatically sets `updated_at = NOW()` on any UPDATE for:
- `messages`
- `goals`
- `user_facts`

### 11.5 Row Level Security (RLS)

RLS is enabled on all four tables. Service role policies grant full access for the bot's server-side operations:

```sql
-- Applied to: messages, goals, user_facts, conversation_contexts
CREATE POLICY "Service role full access {table}" ON {table}
  FOR ALL USING (true) WITH CHECK (true);
```

**Note:** The bot connects with `SUPABASE_SERVICE_ROLE_KEY` (service role), which bypasses RLS. Future multi-tenant deployments should implement per-user RLS policies using Supabase auth.

### 11.6 Views

| View | Purpose |
|------|---------|
| `recent_messages` | Pre-sorted messages by `created_at DESC` for quick retrieval |
| `active_goals` | Pre-filtered goals with `status = 'active'`, sorted by priority |

### 11.7 Grants

```sql
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION search_similar_messages TO authenticated;
GRANT EXECUTE ON FUNCTION search_relevant_goals TO authenticated;
GRANT EXECUTE ON FUNCTION search_relevant_facts TO authenticated;
```

---

## 12. Risk Assessment

### 12.1 Cost Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude Code invocations exceed budget | Medium | High | In-memory cost tracker with per-user stats; `/costs` command for visibility; configurable rate limiting (10 req/min default) |
| OpenAI embedding costs spike | Low | Medium | Embeddings are ~$0.00013/1K tokens; generated asynchronously; can be disabled via `FEATURE_MEMORY_ENABLED=false` |
| Twilio call costs | Low | Medium | Voice features disabled by default; require explicit env vars to activate |
| Supabase exceeds free tier | Low | Low | Free tier allows 500MB and 50K rows; monitor row count via `/health` endpoint |

### 12.2 Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Unauthorized bot access | Low | Critical | User ID whitelist (`ALLOWED_USER_IDS`); rejected users see their ID for debugging |
| Credential exposure | Low | Critical | `.env` in `.gitignore`; `.env.example` has no real values; credentials validated at startup |
| Malicious command injection | Medium | High | Dangerous pattern detection (regex-based); `--allowedTools` restricts tool access; `CLAUDE_AUTO_APPROVE=false` |
| Directory traversal via filenames | Low | Medium | `sanitizeFilename()` strips path components, null bytes, and dangerous characters |
| Rate limiting bypass | Low | Medium | Per-user sliding window rate limiter; configurable via env vars |

### 12.3 Reliability Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Process crash | Medium | Medium | launchd `KeepAlive` with auto-restart; 5-second throttle prevents restart loops |
| Claude Code timeout | Medium | Low | Configurable timeout (default 2 min for text, 5 min for tools); process kill on timeout |
| Supabase unavailability | Low | Medium | Memory features degrade gracefully; bot continues without semantic search |
| Network connectivity loss | Low | High | Polling mode reconnects automatically; launchd restarts on unexpected exit |
| Disk space exhaustion from logs | Low | Medium | Log rotation via `SoftResourceLimits` in launchd plist; `logs/` directory |

### 12.4 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude Code CLI update breaks interface | Medium | High | Pin to known working version; `--output-format json` output structure documented |
| Telegram API rate limits | Low | Medium | Grammy handles rate limiting internally; per-user rate limiter adds application-level control |
| OpenAI embedding model deprecation | Low | Medium | Model name is configurable in `EmbeddingConfig`; migration requires re-embedding |
| launchd misconfiguration | Low | Medium | `com.claudecode.bot.plist` is version-controlled; install/uninstall scripts provided |

---

## 13. Future Roadmap

### Phase 1: Immediate Enhancements (Next 30 Days)

| Feature | Priority | Description |
|---------|----------|-------------|
| Voice transcription | High | Integrate Whisper API or Gemini for voice note transcription (FR-3 completion) |
| Persistent cost tracking | Medium | Store cost data in Supabase instead of in-memory to survive restarts |
| Conversation context management | Medium | Implement session detection and automatic conversation summarization |
| Goal completion from chat | Medium | Allow users to mark goals complete via natural language ("I finished the video") |

### Phase 2: Feature Expansion (60-90 Days)

| Feature | Priority | Description |
|---------|----------|-------------|
| Multi-user profiles | Medium | Individual user preferences, permission levels, and context per user |
| Conversation history export | Low | Export chat history as Markdown, JSON, or PDF |
| Scheduled messages | Medium | "Remind me at 5pm to call mom" with cron-like scheduling |
| Image generation | Low | Integration with DALL-E or Stable Diffusion for image creation |
| Web browsing | Medium | Allow Claude Code to browse URLs and summarize web content |

### Phase 3: Production Hardening (90-120 Days)

| Feature | Priority | Description |
|---------|----------|-------------|
| Webhook mode deployment | High | Full webhook mode with reverse proxy (nginx/Cloudflare Tunnel) |
| Analytics dashboard | Medium | Web UI showing usage trends, cost graphs, and goal completion rates |
| MCP server integration | High | Connect to additional MCP servers for expanded tool access |
| Automated testing | High | Unit tests for relay, parser, auth; integration tests for message flow |
| Docker containerization | Medium | Dockerfile for platform-independent deployment |

### Phase 4: Advanced Capabilities (120+ Days)

| Feature | Priority | Description |
|---------|----------|-------------|
| Multi-platform support | Low | Extend to Discord, Slack, or WhatsApp in addition to Telegram |
| RAG over user documents | Medium | Index uploaded documents for retrieval-augmented generation |
| Collaborative goals | Low | Shared goals between multiple authorized users |
| Plugin system | Low | User-installable plugins for custom integrations |
| Autonomous task execution | Medium | Long-running background tasks with progress updates to Telegram |

---

## 14. Cost Analysis

### 14.1 Fixed Costs

| Service | Plan | Monthly Cost | Notes |
|---------|------|-------------|-------|
| Claude Max 20x | Anthropic subscription | ~$200 | Covers Claude Code CLI usage; rate depends on plan tier |
| Supabase | Free tier | $0 | 500MB database, 50K monthly active users, 2GB bandwidth |
| macOS machine | Existing hardware | $0 (electricity only) | Runs on user's existing Mac |

### 14.2 Variable Costs

| Service | Unit Cost | Estimated Monthly Usage | Estimated Monthly Cost |
|---------|-----------|------------------------|----------------------|
| Claude Code invocations | ~$0.20/invocation (varies by complexity) | 250-1000 invocations | $50-200 |
| OpenAI embeddings (text-embedding-3-large) | $0.00013/1K tokens | ~500K tokens | $0.065 |
| ElevenLabs conversational AI | Varies by plan | 10-50 calls | $5-20 |
| Twilio voice | $0.013/min + $1/mo phone number | 50-200 minutes | $10-50 |
| Gemini API (transcription) | ~$0.001/15 seconds | 30-60 minutes | $2-5 |

### 14.3 Total Cost Estimates

| Usage Level | Description | Estimated Monthly Cost |
|-------------|-------------|----------------------|
| **Light** | 10 messages/day, no voice | $50-75 |
| **Moderate** | 30 messages/day, occasional voice | $150-200 |
| **Heavy** | 50+ messages/day, frequent voice | $220-275 |

### 14.4 Cost Optimization Strategies

1. **Rate limiting** -- Default 10 requests per minute prevents accidental cost spikes
2. **Timeout management** -- 2-minute timeout for text, 30 seconds for goal detection prevents runaway invocations
3. **Feature flags** -- Disable memory, voice, and proactive check-ins when not needed
4. **Cost visibility** -- `/costs` command and `/health` endpoint provide real-time cost awareness
5. **Output truncation** -- 3500-character limit prevents unnecessarily long (expensive) responses
6. **Async embeddings** -- Embedding generation is non-blocking and can be batched

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **Claude Code** | Anthropic's CLI tool for Claude, supporting headless mode (`claude -p`) with tool access (bash, read, write) |
| **Grammy** | A TypeScript framework for building Telegram bots, supporting middleware, commands, and message handlers |
| **Headless mode** | Running Claude Code without an interactive terminal -- sends a prompt, receives a response, and exits |
| **launchd** | macOS system for managing background processes (daemons and agents) |
| **MCP** | Model Context Protocol -- a standard for connecting AI models to external tools and services |
| **pgvector** | PostgreSQL extension for vector similarity search, enabling semantic memory |
| **RLS** | Row Level Security -- PostgreSQL feature that restricts which rows users can access |
| **Semantic search** | Finding similar content by comparing vector embeddings rather than exact text matching |
| **TwiML** | Twilio Markup Language -- XML-based instructions for controlling phone calls |
| **Vector embedding** | A high-dimensional numerical representation of text that captures semantic meaning |
| **Webhook** | An HTTP endpoint that receives real-time event notifications from external services |

---

## Appendices

### Appendix A: File Structure

```
claude-code-always-on/
|-- src/
|   |-- index.ts                     # Application entry point
|   |-- bot.ts                       # Grammy bot setup and message handlers
|   |-- relay.ts                     # Claude Code CLI relay wrapper
|   |-- middleware/
|   |   |-- auth.ts                  # User ID whitelist authentication
|   |   |-- parser.ts               # Multi-modal message type detection
|   |   |-- security.ts             # Input validation, rate limiting, permissions
|   |-- services/
|   |   |-- memory.ts               # Supabase semantic memory service
|   |   |-- goals.ts                # Goal detection and tracking service
|   |   |-- proactive.ts            # 30-minute proactive check-in service
|   |   |-- voice.ts                # ElevenLabs + Twilio voice integration
|   |   |-- embeddings.ts           # OpenAI embeddings generation
|   |   |-- cost-tracker.ts         # In-memory cost and usage tracking
|   |   |-- logger.ts               # Structured JSON logging
|   |   |-- heartbeat.service.ts    # launchd heartbeat file management
|   |   |-- claude-wrapper.ts       # Permission-gated Claude Code wrapper
|   |   |-- twilio-webhook.ts       # Twilio/ElevenLabs webhook handlers
|   |-- database/
|       |-- supabase.ts             # Supabase client configuration and types
|       |-- goals.ts                # Goals table CRUD operations
|       |-- messages.ts             # Messages table CRUD operations
|       |-- user-facts.ts           # User facts table CRUD operations
|       |-- client.ts               # Database client utilities
|       |-- index.ts                # Database module exports
|-- supabase/
|   |-- migrations/
|   |   |-- 001_initial_schema_fixed.sql  # Full database schema
|   |-- functions/
|   |   |-- embeddings/index.ts           # Edge Function: embedding generation
|   |   |-- semantic-search/index.ts      # Edge Function: semantic search
|   |-- config.toml                       # Supabase CLI configuration
|-- scripts/
|   |-- install-service.sh          # launchd service install/uninstall
|   |-- start-bot.sh                # Bot startup script (used by launchd)
|   |-- run-migration.ts            # Database migration runner
|-- logs/                           # Application logs (gitignored)
|-- tmp/                            # Temporary file downloads (gitignored)
|-- docs/
|   |-- LAUNCHD.md                  # launchd configuration documentation
|-- .env                            # Environment variables (gitignored)
|-- .env.example                    # Environment variable template
|-- .gitignore                      # Git ignore rules
|-- package.json                    # Project dependencies and scripts
|-- tsconfig.json                   # TypeScript configuration
|-- bun.lock                        # Bun dependency lock file
|-- com.claudecode.bot.plist        # launchd daemon configuration
|-- PLAN.md                         # Implementation plan (11 tasks, 4 phases)
|-- WALKTHROUGH.md                  # Detailed implementation walkthrough
|-- SECURITY.md                     # Security hardening documentation
|-- CLAUDE.md                       # Claude Code project instructions
|-- README.md                       # Project overview and setup guide
|-- PRD.md                          # This document
```

### Appendix B: npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `bun run src/index.ts` | Start bot in development mode |
| `start` | `bun run src/index.ts` | Start bot in production mode |
| `type-check` | `tsc --noEmit` | Run TypeScript type checking |
| `service:install` | `bash scripts/install-service.sh install` | Install launchd service |
| `service:uninstall` | `bash scripts/install-service.sh uninstall` | Remove launchd service |
| `service:start` | `bash scripts/install-service.sh start` | Start the daemon |
| `service:stop` | `bash scripts/install-service.sh stop` | Stop the daemon |
| `service:restart` | `bash scripts/install-service.sh restart` | Restart the daemon |
| `service:status` | `bash scripts/install-service.sh status` | Check daemon status |
| `service:logs` | `bash scripts/install-service.sh logs` | View daemon logs |

### Appendix C: Telegram Bot Commands

| Command | Description | Implementation |
|---------|-------------|----------------|
| `/start` | Welcome message with feature overview | `bot.ts` |
| `/help` | List all commands and supported input types | `bot.ts` |
| `/status` | Show bot uptime, user info, and health | `bot.ts` |
| `/goals` | List all active goals with priority and category | `bot.ts` -> `GoalService` |
| `/costs` | Show per-user usage stats for current session | `bot.ts` -> `CostTracker` |

### Appendix D: Permission Levels

| Level | Allowed Tools | Use Case |
|-------|--------------|----------|
| `read_only` | `read` | Viewing file content only; no execution |
| `safe` | `read`, `web-search`, `grep` | Non-destructive research and analysis |
| `standard` | `read`, `write`, `bash`, `web-search`, `grep` | Most operations with safety checks |
| `full` | `*` (all tools) | Complete access; use with extreme caution |

### Appendix E: Dangerous Command Patterns

The following patterns are detected and blocked regardless of permission level:

| Pattern | Description |
|---------|-------------|
| `rm -rf /` or `rm -rf ~` | Recursive force delete from root or home |
| `dd if=` | Direct disk access (can destroy data) |
| `mkfs.` | Filesystem creation (formats drives) |
| `chmod 000` | Remove all file permissions |
| `shutdown` | System shutdown |
| `reboot` | System reboot |
| `> /dev/` or `> /proc/` or `> /sys/` | Redirect to system directories |
| `curl ... \| sh` or `wget ... \| sh` | Pipe remote content to shell |
| `eval $( curl ...` | Evaluate remote code |

---

**Document History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-11 | Nathan Madrid | Initial PRD creation |

---

**Last Updated:** 2026-02-11
**Status:** In Development
**Next Review:** After Phase 1 completion
