# Remote Mode: Control Claude Code from Telegram

Use Claude Code from anywhere. Start a task at your desk, walk away, and manage everything from Telegram on your phone: approve permissions, check on sessions, read vault files, and add tasks.

---

## Overview

Remote mode adds three capabilities to the always-on bot:

| Feature | What it does |
|---------|-------------|
| **Terminal Notifications** | Sends Telegram alerts when Claude Code needs input, finishes, or idles |
| **Vault Bridge** | Read/write your Obsidian vault from Telegram (`/vault` commands) |
| **Permission Approval** | Approve or deny Claude Code tool permissions from Telegram buttons |

All three features are gated behind a single toggle. When you're at your desk, everything stays silent.

---

## Quick Start

### 1. Toggle remote mode on

From your regular terminal shell (not inside Claude Code):

```bash
away
```

Or from Telegram once you've left:

```
/away
```

> **Important:** `away` and `home` are regular shell commands, not Claude Code slash commands. Run them from a normal terminal prompt. Typing `/away` or `/home` inside a Claude Code session will trigger Claude Code's own command system instead of the remote mode toggle.

### 2. Start a Claude Code session with Telegram approval

```bash
claude-telegram
```

This is identical to running `claude` except that permission prompts go to Telegram instead of the terminal.

### 3. Work from Telegram

When Claude Code needs a permission, you'll see a message like:

```
Permission Request

Tool: Bash
Session: my-project

git status

Request ID: a1b2c3d4
```

Tap one of three buttons:

- **Allow** : approve this one request
- **Deny** : reject this request
- **Allow All Similar** : auto-approve this tool type for 30 minutes

### 4. Toggle off when you're back

```bash
home
```

---

## Setup

### Prerequisites

These components should already be running if you followed the main README:

- The always-on bot is running (`launchctl list | grep claudecode`)
- `~/.claude/scripts/` is on your PATH (added to `~/.zshrc`)
- Obsidian with Local REST API plugin (for vault features, optional)

### Verify the scripts are in place

```bash
# Check all scripts exist and are executable
ls -la ~/.claude/scripts/telegram-notify.sh
ls -la ~/.claude/scripts/notify
ls -la ~/.claude/scripts/away
ls -la ~/.claude/scripts/home
ls -la ~/.claude/scripts/claude-telegram
```

### Verify the hooks are configured

```bash
# Should show PreToolUse, Notification, Stop hooks
cat ~/.claude/settings.json | grep -A2 telegram-notify
```

### Verify the MCP server can start

```bash
bun run ~/claude-code-always-on/src/mcp/telegram-approver.ts
# Should print: [telegram-approver] Starting Telegram approval MCP server
# Then: [telegram-approver] Stdin closed, shutting down
```

### Verify the approvals directory

```bash
ls -la ~/.claude/approvals/
# Should exist with mode drwx------ (700)
```

---

## Features in Detail

### Terminal Notifications

Configured via Claude Code hooks in `~/.claude/settings.json`. Three events trigger notifications:

| Event | When it fires | What you see in Telegram |
|-------|--------------|--------------------------|
| `PreToolUse` (AskUserQuestion) | Claude Code asks you a question | The question text with answer options |
| `Notification` | Claude Code sends a status update | The notification message |
| `Stop` | A Claude Code session finishes | Session name, path, and stop reason |

These only fire when remote mode is ON. When OFF, the notification script exits silently.

**Responding to questions:** If Claude Code asks a question and you want to answer, use:

```
/vault respond Your answer here
```

The response is saved to your Obsidian vault at `context/telegram-responses/` and will be available when you return.

### The `notify` Wrapper

Wrap any long-running terminal command to get Telegram alerts on completion or idle:

```bash
notify bun test
notify npm run build
notify make all
```

- Sends a "command finished" alert with exit code and duration
- Sends an "idle" alert if no output for 60 seconds (configurable via `NOTIFY_IDLE_SECONDS`)

### Vault Bridge

Interact with your Obsidian vault directly from Telegram using the `/vault` command:

```
/vault status              Check vault connectivity and active tasks
/vault read <path>         Read a vault file (max 500 char path)
/vault respond <text>      Save a response to context/telegram-responses/
/vault task <description>  Append a task to context/TASKS.md
/vault idea <content>      Create an idea file in ideas/
/vault search <query>      Full-text search across the vault
```

**Write restrictions:** For security, the vault bridge can only write to these directories:
- `context/`
- `ideas/`
- `Inbox/`
- `meetings/`
- `planning/`

**Requires:** Obsidian running with the Local REST API plugin (port 27124). API key in `~/.env.local` as `OBSIDIAN_REST_API_KEY`.

### Permission Approval

The `claude-telegram` command launches Claude Code with a custom MCP server that delegates permission prompts to Telegram.

**How it works:**

```
Terminal                    MCP Server                 Telegram Bot
   |                           |                           |
   |  Claude needs permission  |                           |
   |  ---permission-prompt---> |                           |
   |                           |  Send inline keyboard     |
   |                           |  -----------------------> |
   |                           |                           |  User taps
   |                           |                           |  "Allow"
   |                           |  Write .response.json     |
   |                           |  <----------------------- |
   |  Return allow/deny        |                           |
   |  <----------------------- |                           |
   |  Continue execution       |                           |
```

1. Claude Code calls the MCP server's `approve` tool
2. The MCP server writes a request file to `~/.claude/approvals/` and sends a Telegram message
3. You tap a button in Telegram
4. The bot writes a response file
5. The MCP server reads it and returns allow/deny to Claude Code

**Timeout:** If no response within 5 minutes, the request is auto-denied.

**Allow All Similar:** When you tap this button, that tool type is auto-approved for 30 minutes. After 30 minutes, it prompts again.

---

## Remote Mode Toggle

The toggle controls whether notifications are sent. It uses a simple flag file at `~/.claude/remote-mode`.

| State | Flag file | Notifications | Permission approval |
|-------|-----------|---------------|---------------------|
| OFF (default) | absent | silent | use normal `claude` |
| ON | present | active | use `claude-telegram` |

### Toggle from terminal (regular shell)

Run these from a normal terminal prompt, **not** inside a Claude Code session:

```bash
away       # Enable (leaving desk)
home       # Disable (back at desk)
```

### Toggle from Telegram

```
/away      Enable
/home      Disable
```

Both methods toggle the same flag file (`~/.claude/remote-mode`), so they stay in sync.

> **Why no slash?** These are standalone shell scripts in `~/.claude/scripts/` (which is on your PATH). The `/away` and `/home` variants only work inside Telegram. In a Claude Code terminal session, the `/` prefix is reserved for Claude Code's own slash commands.

---

## Typical Workflow

### Starting a task before leaving

```bash
# 1. Start remote mode
away

# 2. Launch Claude Code with Telegram approval
claude-telegram

# 3. Give Claude a task
> Refactor the authentication module to use JWT tokens

# 4. Walk away - Claude works, and you approve permissions from your phone
```

### Checking in from Telegram

```
/status                           # Bot uptime
/vault status                     # Active tasks, vault connectivity
/vault read context/TASKS.md      # See your task list
/vault task Review PR #42         # Add a task for later
```

### Returning to your desk

```bash
# Turn off notifications
home

# Continue using claude normally
claude -c    # Continue the session in your terminal
```

---

## Security Notes

The permission approval system includes several security measures:

- **UUID validation:** Request IDs are validated as UUIDv4 format to prevent path traversal
- **Atomic file writes:** Response files use exclusive creation (`O_EXCL`) to prevent race conditions on double-tap
- **Tool name verification:** "Allow All Similar" verifies the tool name matches the original request
- **Token redaction:** Bot tokens are stripped from all error log messages
- **TTL on auto-approve:** "Allow All Similar" expires after 30 minutes
- **Auto-deny on timeout:** Unanswered requests deny after 5 minutes
- **Restrictive file permissions:** Request/response files use `0o600`, directory uses `0o700`
- **Authentication middleware:** All Telegram interactions pass through the user ID whitelist

---

## Troubleshooting

### Notifications not arriving

1. Check the flag file exists: `ls ~/.claude/remote-mode` (if missing, run `away`)
3. Check the notify log: `tail ~/.claude/scripts/notify.log`
4. Verify bot token in `~/claude-code-always-on/.env`

### Permission buttons not working

1. Check the bot is running: `launchctl list | grep claudecode`
2. Check approvals directory: `ls ~/.claude/approvals/`
3. Check bot logs: `tail -f ~/claude-code-always-on/logs/bot-stdout.log`
4. If buttons say "Request expired," the 5-minute timeout passed

### Vault commands failing

1. Verify Obsidian is running with Local REST API plugin
2. Check API key: `grep OBSIDIAN_REST_API_KEY ~/.env.local`
3. Test connectivity: `curl -k https://localhost:27124/ -H "Authorization: Bearer YOUR_KEY"`

### `claude-telegram` not found

Verify `~/.claude/scripts` is on your PATH:

```bash
echo $PATH | tr ':' '\n' | grep .claude
# Should show: /Users/you/.claude/scripts
```

If missing, add to `~/.zshrc`:

```bash
export PATH="$HOME/.claude/scripts:$PATH"
```

---

## File Reference

| File | Purpose |
|------|---------|
| `~/.claude/scripts/away` | Enable remote mode |
| `~/.claude/scripts/home` | Disable remote mode |
| `~/.claude/scripts/claude-telegram` | Launch Claude Code with Telegram permission approval |
| `~/.claude/scripts/telegram-notify.sh` | Send hook events to Telegram (checks remote mode flag) |
| `~/.claude/scripts/notify` | Wrap commands with completion/idle alerts |
| `~/.claude/remote-mode` | Flag file (present = away) |
| `~/.claude/approvals/` | IPC directory for permission request/response files |
| `~/.claude/settings.json` | Claude Code hooks configuration |
| `src/mcp/telegram-approver.ts` | MCP server for permission approval |
| `src/mcp/mcp-config.json` | MCP server config for `--mcp-config` flag |
| `src/services/vault-bridge.ts` | Obsidian REST API bridge |
| `src/bot.ts` | Bot handlers (includes `/vault`, `/away`, `/home`, approval callbacks) |
