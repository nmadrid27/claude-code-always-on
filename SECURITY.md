# Security Hardening Documentation

This document describes the security measures implemented in Claude Code Always-On to ensure safe, permission-gated operation.

---

## Security Architecture

### Principles

1. **Local Only** - No public ports or WebSocket exposure
2. **Permission Gated** - No auto-execution of commands
3. **Whitelist Auth** - Only authorized Telegram users can interact
4. **Credential Safety** - All secrets in environment variables
5. **Input Validation** - All user input is sanitized

---

## Authentication

### User ID Whitelist

The bot uses a whitelist-based authentication system. Only users whose Telegram IDs are in `ALLOWED_USER_IDS` can interact with the bot.

**Implementation:** `src/middleware/auth.ts`

```typescript
// Users must be explicitly allowed
ALLOWED_USER_IDS=123456789,987654321
```

### Getting Your User ID

1. Message your bot on Telegram
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find your `from.user_id` in the response

---

## Permission Model

### Permission Levels

| Level | Tools Available | Use Case |
|-------|----------------|----------|
| `read_only` | read | Viewing content only |
| `safe` | read, web-search, grep | Non-destructive operations |
| `standard` | read, write, bash, web-search, grep | Most operations with confirmation |
| `full` | All tools | Complete access (use cautiously) |

### Default Configuration

```bash
# Permission level for new sessions
DEFAULT_PERMISSION_LEVEL=standard

# Never auto-approve dangerous operations
CLAUDE_AUTO_APPROVE=false
```

### Tool Restrictions

Dangerous patterns are blocked regardless of permission level:

- `rm -rf` with absolute paths
- Disk destruction commands (`dd`, `mkfs`)
- System shutdown/reboot
- Piping curl/wget to shell
- Dangerous variable expansion

**Implementation:** `src/middleware/security.ts`

---

## Input Validation

### Text Input Limits

```typescript
MAX_TEXT_LENGTH: 4000      // Telegram max
MAX_CAPTION_LENGTH: 1024
MAX_COMMAND_LENGTH: 100
MAX_FILE_SIZE: 50MB
```

### Filename Sanitization

- Removes path components (prevents directory traversal)
- Removes null bytes
- Limits to 255 characters
- Replaces dangerous characters with underscore

### Command Safety Checks

All commands are checked against dangerous patterns before execution.

---

## Rate Limiting

### Default Limits

```bash
RATE_LIMIT_MAX_REQUESTS=10      # requests per window
RATE_LIMIT_WINDOW_MS=60000      # 1 minute window
```

### Implementation

Per-user rate limiting prevents abuse while allowing legitimate use.

---

## Credential Management

### Environment Variables

All credentials are stored in environment variables, never in code.

**Required:**
- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_USER_IDS`
- `CLAUDE_TIMEOUT`

**Optional:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

### Credential Security

1. `.env` is in `.gitignore`
2. `.env.example` provides template without values
3. Environment variables are validated on startup
4. Format validation for tokens and IDs

---

## Network Security

### No Public Exposure

- Bot uses Telegram polling (no webhook server needed)
- No open ports or WebSocket connections
- All communication goes through Telegram's encrypted servers

### API Security

- All API calls use HTTPS
- Timeouts prevent hanging connections
- Error messages don't leak sensitive data

---

## Claude Code Integration

### Permission-Gated Execution

The `ClaudeCodeWrapper` class ensures:

1. **No Auto-Execute** - `CLAUDE_AUTO_APPROVE=false`
2. **Tool Restrictions** - `--allowedTools` flag
3. **Timeouts** - Configurable per execution
4. **Process Management** - Active processes tracked and killable

**Implementation:** `src/services/claude-wrapper.ts`

### Safe Execution Flow

```
User Input
  ↓
Validation (length, patterns)
  ↓
Permission Check (user ID, rate limit)
  ↓
Claude Code (with --allowedTools)
  ↓
Tool Review (dangerous operations flagged)
  ↓
User Confirmation (if required)
  ↓
Execution
```

---

## Security Checklist

### Development

- [ ] `.env` file exists and is configured
- [ ] `ALLOWED_USER_IDS` contains only valid IDs
- [ ] `CLAUDE_AUTO_APPROVE` is set to `false`
- [ ] `.env` is in `.gitignore`
- [ ] No credentials in source code

### Production

- [ ] Rate limiting enabled
- [ ] Logging enabled (no sensitive data)
- [ ] Timeout values configured appropriately
- [ ] Permission level set appropriately
- [ ] API keys have minimum required scopes
- [ ] Regular credential rotation

### Monitoring

- [ ] Track unusual activity (failed auth, rate limits)
- [ ] Monitor Claude Code execution times
- [ ] Alert on error patterns
- [ ] Review tool usage patterns

---

## Security vs Naive Implementations

| Vulnerability | Naive Approach | This Project |
|---------------|----------------|--------------|
| Public WebSocket | ✗ Vulnerable | ✓ Local only |
| Plaintext keys | ✗ Vulnerable | ✓ Environment variables |
| No authentication | ✗ Vulnerable | ✓ User ID whitelist |
| Auto-execute | ✗ Vulnerable | ✓ Permission-gated |
| No sandbox | ✗ Vulnerable | ✓ Input validation |
| No rate limiting | ✗ Vulnerable | ✓ Per-user limits |

---

## Common Security Pitfalls

### Don't

- Commit `.env` files to git
- Use `*` for allowed tools in production
- Set `CLAUDE_AUTO_APPROVE=true`
- Share your bot token publicly
- Use weak permission levels for untrusted users

### Do

- Rotate API keys regularly
- Review `ALLOWED_USER_IDS` periodically
- Monitor logs for suspicious activity
- Use the principle of least privilege
- Test authentication before deploying

---

## Reporting Security Issues

If you discover a security vulnerability, please:

1. Do NOT create a public issue
2. Describe the vulnerability in detail
3. Include steps to reproduce
4. Suggest a fix if possible

---

**Last Updated:** 2026-02-10
**Version:** 0.1.0
