# Launchd Service Setup

This bot can run as a macOS launchd daemon for 24/7 operation with automatic restart on failure.

## Features

- **Auto-start on login**: Service starts automatically when you log in
- **Auto-restart on crash**: If the bot crashes, launchd will restart it within 5 seconds
- **Heartbeat monitoring**: Service updates heartbeat every 5 minutes; launchd expects activity every 30 minutes
- **Log rotation**: Standard output and error are logged to `logs/` directory
- **Adaptive process type**: Runs with lower CPU priority when not actively processing

## Quick Start

### 1. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit and add your Telegram bot token
nano .env
```

### 2. Install Service

```bash
# Using npm script
bun run service:install

# Or directly
bash scripts/install-service.sh install
```

### 3. Check Status

```bash
bun run service:status
```

## Service Management

| Command | Description |
|---------|-------------|
| `bun run service:install` | Install and start the service |
| `bun run service:uninstall` | Stop and remove the service |
| `bun run service:start` | Start the service |
| `bun run service:stop` | Stop the service |
| `bun run service:restart` | Restart the service |
| `bun run service:status` | Show service status |
| `bun run service:logs` | Follow startup logs |

## Log Files

All logs are stored in the `logs/` directory:

| File | Description |
|------|-------------|
| `bot-stdout.log` | Standard output from the bot |
| `bot-stderr.log` | Error output from the bot |
| `startup.log` | Startup script logs |
| `heartbeat.timestamp` | Last heartbeat timestamp |

## How It Works

### launchd Configuration (`com.claudecode.bot.plist`)

```xml
<!-- Key settings explained -->

<!-- Run at load/login -->
<key>RunAtLoad</key>
<true/>

<!-- Restart on crash -->
<key>KeepAlive</key>
<dict>
    <key>SuccessfulExit</key>
    <false/>  <!-- Don't restart if exited cleanly (exit code 0) -->
    <key>Crashed</key>
    <true/>   <!-- Restart if crashed -->
</dict>

<!-- Wait 5 seconds before restarting -->
<key>ThrottleInterval</key>
<integer>5</integer>

<!-- Expect activity every 30 minutes (heartbeat) -->
<key>ExitTimeOut</key>
<integer>1800</integer>
```

### Heartbeat System

1. **Start Script** (`scripts/start-bot.sh`):
   - Updates heartbeat file immediately on startup
   - Spawns a background process to update heartbeat every 5 minutes

2. **Heartbeat Service** (`src/services/heartbeat.service.ts`):
   - Updates `logs/heartbeat.timestamp` every 5 minutes
   - Provides functions to check heartbeat health

3. **launchd Monitoring**:
   - Checks if process is still running
   - Uses `ExitTimeOut` (30 min) as maximum idle time
   - Restarts service if heartbeat becomes stale

## Troubleshooting

### Service Not Starting

```bash
# Check status
bun run service:status

# View logs
bun run service:logs

# Check for errors
cat logs/bot-stderr.log
```

### Permission Issues

The start script (`scripts/start-bot.sh`) must be executable:

```bash
chmod +x scripts/start-bot.sh
```

### Manual Testing

Before installing as a service, test manually:

```bash
# Run directly (foreground)
bun start

# Run via start script
bash scripts/start-bot.sh
```

### Force Restart

```bash
# Kick the service (force restart)
launchctl kickstart -k gui/$UID/com.claudecode.bot
```

### View All launchd Services

```bash
# List all loaded services
launchctl list | grep claudecode
```

## Advanced: System-Wide Service (Root)

To run the service even when no user is logged in, install as a system daemon:

```bash
# Copy plist to system LaunchDaemons
sudo cp com.claudecode.bot.plist /Library/LaunchDaemons/

# Update UserName in plist to your user
sudo nano /Library/LaunchDaemons/com.claudecode.bot.plist

# Load system service
sudo launchctl load -w /Library/LaunchDaemons/com.claudecode.bot.plist
```

**Warning**: System services run with elevated privileges. Ensure the `UserName` key is set correctly.

## Uninstalling

```bash
# Uninstall and remove all files
bun run service:uninstall

# Optionally, clean up logs
rm -rf logs/
```

## File Locations

| File | Location |
|------|----------|
| Plist (user) | `~/Library/LaunchAgents/com.claudecode.bot.plist` |
| Plist (system) | `/Library/LaunchDaemons/com.claudecode.bot.plist` |
| Project | `/Users/nathanmadrid/claude-code-always-on/` |
| Logs | `/Users/nathanmadrid/claude-code-always-on/logs/` |
