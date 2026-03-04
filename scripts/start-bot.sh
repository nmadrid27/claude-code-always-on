#!/bin/bash

##############################################################################
# Claude Code Telegram Bot - Start Script
# This script is executed by launchd to run the bot continuously
##############################################################################

set -euo pipefail

# Ensure PATH includes Homebrew and local bin (launchd has a minimal PATH)
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$LOG_DIR/bot.pid"
HEARTBEAT_FILE="$LOG_DIR/heartbeat.timestamp"
LOCK_FILE="$LOG_DIR/bot.lock"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/startup.log"
}

# Error handler
error_exit() {
    log "ERROR: $*" >&2
    exit 1
}

# Check for already running instance
check_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "unknown")
        if ps -p "$lock_pid" > /dev/null 2>&1; then
            log "Bot is already running (PID: $lock_pid). Exiting."
            exit 0
        else
            log "Removing stale lock file (PID $lock_pid not running)."
            rm -f "$LOCK_FILE"
        fi
    fi
}

# Create lock file
create_lock() {
    echo $$ > "$LOCK_FILE"
    # Ensure lock file is removed on exit
    trap 'rm -f "$LOCK_FILE"' EXIT
}

# Check required environment
check_env() {
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        error_exit ".env file not found. Please create it from .env.example"
    fi

    # Check for critical env vars (without exposing values)
    if ! grep -q "TELEGRAM_BOT_TOKEN=" "$PROJECT_DIR/.env" || \
       grep -q "your_bot_token_here" "$PROJECT_DIR/.env"; then
        error_exit "TELEGRAM_BOT_TOKEN not configured in .env"
    fi
}

# Verify bun is installed
check_bun() {
    if ! command -v bun &> /dev/null; then
        error_exit "bun is not installed. Please install it first: curl -fsSL https://bun.sh/install | bash"
    fi
}

# Heartbeat function - updates timestamp for launchd monitoring
update_heartbeat() {
    date +%s > "$HEARTBEAT_FILE"
}

# Start heartbeat updater in background
start_heartbeat_monitor() {
    # Update heartbeat immediately
    update_heartbeat

    # Start a background process to update heartbeat every 5 minutes
    (
        while true; do
            sleep 300  # 5 minutes
            update_heartbeat
        done
    ) &
    echo $! > "$LOG_DIR/heartbeat-monitor.pid"
}

# Cleanup function
cleanup() {
    log "Shutting down bot..."
    if [ -f "$LOG_DIR/heartbeat-monitor.pid" ]; then
        local hb_pid
        hb_pid=$(cat "$LOG_DIR/heartbeat-monitor.pid" 2>/dev/null || echo "")
        if [ -n "$hb_pid" ] && ps -p "$hb_pid" > /dev/null 2>&1; then
            kill "$hb_pid" 2>/dev/null || true
        fi
        rm -f "$LOG_DIR/heartbeat-monitor.pid"
    fi
    rm -f "$LOCK_FILE"
}

# Main execution
main() {
    cd "$PROJECT_DIR" || error_exit "Failed to change to project directory: $PROJECT_DIR"

    log "=========================================="
    log "Claude Code Bot - Starting..."
    log "=========================================="
    log "Project: $PROJECT_DIR"
    log "Bun version: $(bun --version)"

    check_lock
    create_lock
    check_env
    check_bun

    # Set up signal handlers for graceful shutdown
    trap cleanup TERM INT EXIT

    # Start heartbeat monitoring
    start_heartbeat_monitor
    log "Heartbeat monitor started (PID: $(cat "$LOG_DIR/heartbeat-monitor.pid"))"

    # Install dependencies if needed
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        log "Installing dependencies..."
        bun install --production || error_exit "Failed to install dependencies"
    fi

    log "Starting bot process..."
    log "Logs: $LOG_DIR/bot-stdout.log"
    log "=========================================="

    # Run the bot - this will block until the bot exits
    # The output is already redirected by launchd, but we also tee to our logs
    exec bun run src/index.ts
}

# Run main function
main "$@"
