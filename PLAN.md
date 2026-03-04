# Claude Code Always-On - Implementation Plan

**Building a Secure 24/7 AI Assistant**

A secure 24/7 AI assistant using Claude Code + MCP. Permission-gated, self-hosted, zero public exposure.

---

## Overview

| Aspect | Description |
|--------|-------------|
| **Goal** | 24/7 AI assistant with voice, memory, and proactive capabilities |
| **Security** | Local-only, permission-gated, no public exposure |
| **Cost** | ~$200/month fixed vs $500-5,000/month alternatives |
| **Timeline** | 11 tasks across 4 phases |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Bot Framework | grammy (Telegram) |
| AI Engine | Claude Code (headless mode) |
| Voice Transcription | Gemini API |
| Voice Synthesis | ElevenLabs |
| Phone Calls | Twilio |
| Database | Supabase (PostgreSQL + pgvector) |
| Embeddings | OpenAI (text-embedding-3-large) |
| Daemon | launchd (macOS) |

---

## Phase 1: Core Infrastructure

### Task 1: Research Claude Code Headless Mode & MCP

**Objectives:**
- Understand `claude -p` CLI flags and headless invocation
- Document MCP (Model Context Protocol) capabilities
- Identify available MCP servers for tools
- Understand permission-gated execution model

**Research Questions:**
- How does `--output-format json` work?
- What does `--allowedTools` accept?
- How to handle long-running operations?
- Error handling and timeout behavior

**Deliverable:** Documentation of Claude Code CLI API and MCP integration patterns

---

### Task 2: Set Up Telegram Bot Infrastructure

**Objectives:**
- Create Telegram bot via BotFather
- Implement Bun + grammy webhook receiver
- Build message parsing and relay architecture
- Configure user authentication (user ID whitelist)

**Key Files:**
```
src/
├── bot.ts           # Grammy bot setup
├── relay.ts         # Claude Code relay wrapper
└── middleware/
    ├── auth.ts      # User ID validation
    └── parser.ts    # Message type detection
```

**Environment Variables:**
```bash
TELEGRAM_BOT_TOKEN=...
ALLOWED_USER_IDS=123456789,987654321
```

**Deliverable:** Working Telegram bot that receives and acknowledges messages

---

### Task 3: Implement Supabase Database with Semantic Memory

**Objectives:**
- Set up Supabase project with pgvector extension
- Create database schema for messages, goals, facts
- Implement OpenAI embeddings generation
- Build hybrid search (keyword + semantic)
- Create Edge Functions for secure API key handling

**Database Schema:**
```sql
-- Messages with embeddings
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  user_id BIGINT,
  content TEXT,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ,
  metadata JSONB
);

-- Goals with deadlines
CREATE TABLE goals (
  id UUID PRIMARY KEY,
  user_id BIGINT,
  description TEXT,
  deadline TIMESTAMPTZ,
  status TEXT,
  created_at TIMESTAMPTZ
);

-- User facts for context
CREATE TABLE facts (
  id UUID PRIMARY KEY,
  user_id BIGINT,
  key TEXT,
  value TEXT,
  confidence FLOAT,
  updated_at TIMESTAMPTZ
);

-- Semantic search index
CREATE INDEX messages_embedding_idx
ON messages USING ivfflat (embedding vector_cosine_ops);
```

**Edge Functions:**
- `generate-embedding` - Secure OpenAI embedding generation
- `search-memory` - Hybrid semantic search
- `store-message` - Store with auto-embedding

**Deliverable:** Working semantic memory with 4,000+ message capacity

---

## Phase 2: Voice & Memory

### Task 4: Build Voice Integration

**Objectives:**
- Integrate ElevenLabs for TTS and conversational AI
- Set up Twilio for inbound/outbound calls
- Implement context injection (memory + recent chat)
- Create post-call transcript processing

**Architecture:**
```
Call (In/Out)
  ↓
Context API (Supabase)
  ├─→ Recent 15 messages
  ├─→ User goals
  └─→ Relevant facts
  ↓
ElevenLabs Voice Agent
  ↓
Conversation (with context)
  ↓
Transcript → Claude → Execute Tasks
  ↓
Summary to Telegram
```

**Environment Variables:**
```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
```

**Deliverable:** Bidirectional voice calling with full context awareness

---

### Task 5: Create Launchd Daemon for 24/7 Operation

**Objectives:**
- Build launchd plist for macOS service
- Implement auto-restart on failure
- Create 30-minute proactive check-in scheduler
- Configure logging and rotation

**Launchd Plist:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudecode.always-on</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/bun</string>
    <string>/path/to/src/index.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/claude-code.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/claude-code-error.log</string>
</dict>
</plist>
```

**Deliverable:** Service that runs continuously, starts on boot, auto-restarts

---

## Phase 3: Features

### Task 6: Implement Goal Tracking & Proactive Check-ins

**Objectives:**
- Natural language goal detection from messages
- Deadline parsing and tracking
- Goal status updates
- Proactive AI check-ins every 30 minutes

**Goal Detection Examples:**
```
"Finish the video by 5pm"
→ Goal: { description: "Finish the video", deadline: today 5pm }

"Call mom tomorrow at 3"
→ Goal: { description: "Call mom", deadline: tomorrow 3pm }
```

**Proactive Check-in Logic:**
```typescript
// Every 30 minutes
1. Fetch active goals
2. Check deadlines approaching
3. Review recent context
4. Ask Claude: "Should I reach out to user?"
5. If yes: Send proactive message
```

**Deliverable:** Autonomous goal tracking with intelligent check-ins

---

### Task 7: Add Multi-Modal Input Processing

**Objectives:**
- Process images from Telegram
- Handle document/file uploads
- Transcribe voice notes via Gemini API
- Support multi-modal Claude analysis

**Supported Input Types:**
| Type | Handler | Use Case |
|------|---------|----------|
| Text | Direct | Messages, commands |
| Image | Vision API | Screenshots, photos |
| Voice Note | Gemini API | Audio messages |
| Document | Extract text | PDFs, docs |
| File | Metadata | Code, data |

**Deliverable:** Full multi-modal input support with proper cleanup

---

## Phase 4: Production

### Task 8: Security Hardening

**Security Checklist:**

| Area | Implementation |
|------|----------------|
| Network | Local only, no public ports |
| Credentials | Environment variables + MCP OAuth |
| Authentication | Telegram user ID whitelist |
| Execution | Permission-gated, no auto-execute |
| Input Validation | Sanitize all external input |
| File Access | Sandboxed, scoped paths |
| Logging | No sensitive data in logs |

**Comparison:**
| Vulnerability | Naive Approach | This Project |
|---------------|----------------|--------------|
| Public WebSocket | ✗ | ✓ Local only |
| Plaintext keys | ✗ | ✓ Encrypted |
| No auth | ✗ | ✓ User ID restriction |
| Auto-execute | ✗ | ✓ Permission-gated |
| No sandbox | ✗ | ✓ Sandboxed |

**Deliverable:** Security audit passing all checks

---

### Task 9: Build Claude Code Relay Wrapper

**Objectives:**
- Create TypeScript wrapper for headless invocation
- Implement streaming support for long operations
- Handle errors and timeouts gracefully
- Parse JSON output and format responses

**Wrapper Interface:**
```typescript
interface ClaudeCodeRequest {
  prompt: string;
  allowedTools?: string[];
  timeout?: number;
  stream?: boolean;
}

interface ClaudeCodeResponse {
  success: boolean;
  output?: string;
  error?: string;
  toolCalls?: ToolCall[];
  metadata?: {
    tokensUsed: number;
    duration: number;
  };
}

async function invokeClaudeCode(
  request: ClaudeCodeRequest
): Promise<ClaudeCodeResponse>
```

**Command Pattern:**
```bash
claude -p "${prompt}" \
  --output-format json \
  --allowedTools "bash,read,write" \
  --timeout 300000
```

**Deliverable:** Production-ready relay wrapper

---

### Task 10: Monitoring & Cost Controls

**Objectives:**
- Track usage across all services
- Set up alerting for unusual activity
- Create admin commands for management
- Implement cost estimation

**Metrics to Track:**
| Service | Metric | Alert Threshold |
|---------|--------|-----------------|
| Claude | Tokens/day | >1M |
| ElevenLabs | API calls/day | >500 |
| Twilio | Call minutes/month | >200 |
| Supabase | Row reads/day | >100K |

**Admin Commands:**
```
/status - Service health and costs
/usage - Detailed usage statistics
/goals - View all tracked goals
/memory - Search semantic memory
/restart - Restart the service
```

**Deliverable:** Complete monitoring dashboard and alerting

---

### Task 11: Documentation & Deployment Guide

**Documentation Sections:**
1. Architecture overview with diagrams
2. Prerequisites and requirements
3. Step-by-step setup instructions
4. Configuration reference
5. Security best practices
6. Troubleshooting guide
7. Cost breakdown
8. API reference

**Deliverable:** Comprehensive README for students and contributors

---

## Dependencies

```
Task 1 → Task 2 (Claude Code API knowledge)
Task 1 → Task 9 (Relay wrapper)
Task 2 → Task 3 (User context for storage)
Task 3 → Task 4 (Memory for voice context)
Task 3 → Task 6 (Goal storage)
Task 4 → Task 7 (Voice as input type)
Task 5 → All (Daemon runs everything)
Task 8 → All (Security applied everywhere)
Task 9 → Task 2,4,7 (Core execution)
Task 10 → All (Monitoring all components)
Task 11 → All (Documents everything)
```

---

## Success Criteria

- [ ] Telegram bot responds to messages
- [ ] Claude Code executes commands with permissions
- [ ] Semantic memory stores and retrieves messages
- [ ] Voice calls work with context
- [ ] Service runs 24/7 via launchd
- [ ] Goals tracked and proactive check-ins work
- [ ] Multi-modal inputs processed
- [ ] Security audit passes
- [ ] Costs tracked and predictable
- [ ] Complete documentation

---

## Estimated Costs

| Service | Monthly Cost |
|---------|--------------|
| Claude Max 20x | $200 |
| ElevenLabs | $5-20 |
| Twilio | $10-50 |
| Supabase | Free tier |
| Gemini API | ~$5 |
| **Total** | **~$220-275/month** |

---

## Next Steps

1. Review and approve this plan
2. Set up development environment
3. Begin Task 1: Research Claude Code headless mode
4. Follow WALKTHROUGH.md for detailed implementation

---

**Last Updated:** 2026-02-10
**Status:** Ready for implementation
