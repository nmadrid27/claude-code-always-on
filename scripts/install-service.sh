#!/bin/bash

##############################################################################
# Install Script - Claude Code Telegram Bot Launchd Service
# This script installs/uninstalls the bot as a macOS launchd service
##############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_SOURCE="$PROJECT_DIR/com.claudecode.bot.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/com.claudecode.bot.plist"
SERVICE_NAME="com.claudecode.bot"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Check if .env exists
check_env() {
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        log_warning ".env file not found!"
        echo ""
        if [ -f "$PROJECT_DIR/.env.example" ]; then
            log_info "Creating .env from .env.example..."
            cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
            log_success "Created .env file"
            log_warning "Please edit .env and add your Telegram bot token before starting the service!"
            echo ""
            log_info "Run: nano $PROJECT_DIR/.env"
            return 1
        else
            log_error ".env.example not found. Cannot create .env file."
            return 1
        fi
    fi

    # Verify bot token is set
    if grep -q "your_bot_token_here" "$PROJECT_DIR/.env"; then
        log_warning "TELEGRAM_BOT_TOKEN is not configured in .env"
        log_info "Please edit .env and add your bot token:"
        echo "  nano $PROJECT_DIR/.env"
        return 1
    fi

    return 0
}

# Install the service
install_service() {
    log_info "Installing Claude Code Bot as launchd service..."
    echo ""

    # Check environment
    if ! check_env; then
        log_error "Please configure .env before installing the service."
        exit 1
    fi

    # Create LaunchAgents directory if it doesn't exist
    LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
    if [ ! -d "$LAUNCH_AGENTS_DIR" ]; then
        log_info "Creating LaunchAgents directory..."
        mkdir -p "$LAUNCH_AGENTS_DIR"
    fi

    # Check if service already exists
    if [ -f "$PLIST_TARGET" ]; then
        log_warning "Service already installed. Uninstalling first..."
        uninstall_service
    fi

    # Generate plist with actual project path substituted
    log_info "Installing plist to $PLIST_TARGET"
    sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PLIST_SOURCE" > "$PLIST_TARGET"

    # Generate mcp-config.json from template (gitignored; contains absolute path)
    MCP_CONFIG="$PROJECT_DIR/src/mcp/mcp-config.json"
    MCP_EXAMPLE="$PROJECT_DIR/src/mcp/mcp-config.json.example"
    if [ -f "$MCP_EXAMPLE" ]; then
        log_info "Generating src/mcp/mcp-config.json from template..."
        sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$MCP_EXAMPLE" > "$MCP_CONFIG"
    fi

    # Load the service
    log_info "Loading service..."
    launchctl load "$PLIST_TARGET"

    # Start the service
    log_info "Starting service..."
    launchctl start "$SERVICE_NAME"

    echo ""
    log_success "Service installed and started!"
    echo ""
    log_info "Service commands:"
    echo "  Start:   launchctl start $SERVICE_NAME"
    echo "  Stop:    launchctl stop $SERVICE_NAME"
    echo "  Restart: launchctl kickstart -k gui/$UID/$SERVICE_NAME"
    echo "  Uninstall: $0 uninstall"
    echo ""
    log_info "Logs:"
    echo "  Output:  $PROJECT_DIR/logs/bot-stdout.log"
    echo "  Errors:  $PROJECT_DIR/logs/bot-stderr.log"
    echo "  Startup: $PROJECT_DIR/logs/startup.log"
}

# Uninstall the service
uninstall_service() {
    log_info "Uninstalling Claude Code Bot service..."
    echo ""

    # Check if service is loaded
    if launchctl list "$SERVICE_NAME" &>/dev/null; then
        log_info "Stopping service..."
        launchctl stop "$SERVICE_NAME" 2>/dev/null || true
        sleep 1

        log_info "Unloading service..."
        launchctl unload "$PLIST_TARGET" 2>/dev/null || true
    else
        log_info "Service not currently loaded."
    fi

    # Remove plist file
    if [ -f "$PLIST_TARGET" ]; then
        log_info "Removing plist file..."
        rm -f "$PLIST_TARGET"
    fi

    echo ""
    log_success "Service uninstalled!"
}

# Show service status
show_status() {
    log_info "Claude Code Bot Service Status"
    echo ""

    # Check if plist is installed
    if [ -f "$PLIST_TARGET" ]; then
        echo -e "  ${GREEN}✓${NC} Plist installed: $PLIST_TARGET"
    else
        echo -e "  ${RED}✗${NC} Plist not installed"
    fi

    # Check if service is loaded
    if launchctl list "$SERVICE_NAME" &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Service loaded"

        # Get PID if running
        local pid
        pid=$(launchctl list "$SERVICE_NAME" 2>/dev/null | awk '{print $1}' || echo "")
        if [ -n "$pid" ] && [ "$pid" != "pid" ]; then
            echo -e "  ${GREEN}✓${NC} Running (PID: $pid)"
        else
            echo -e "  ${YELLOW}⚠${NC} Service loaded but not running"
        fi
    else
        echo -e "  ${RED}✗${NC} Service not loaded"
    fi

    # Check .env
    if [ -f "$PROJECT_DIR/.env" ]; then
        if grep -q "your_bot_token_here" "$PROJECT_DIR/.env"; then
            echo -e "  ${YELLOW}⚠${NC} .env exists but token not configured"
        else
            echo -e "  ${GREEN}✓${NC} .env configured"
        fi
    else
        echo -e "  ${RED}✗${NC} .env not found"
    fi

    # Show recent logs if available
    if [ -f "$PROJECT_DIR/logs/startup.log" ]; then
        echo ""
        log_info "Recent startup logs:"
        tail -n 5 "$PROJECT_DIR/logs/startup.log" | sed 's/^/    /'
    fi
}

# Main menu
case "${1:-}" in
    install)
        install_service
        ;;
    uninstall|remove)
        uninstall_service
        ;;
    status)
        show_status
        ;;
    restart)
        log_info "Restarting service..."
        launchctl kickstart -k "gui/$UID/$SERVICE_NAME"
        log_success "Service restarted!"
        ;;
    start)
        log_info "Starting service..."
        launchctl start "$SERVICE_NAME"
        log_success "Service started!"
        ;;
    stop)
        log_info "Stopping service..."
        launchctl stop "$SERVICE_NAME"
        log_success "Service stopped!"
        ;;
    logs)
        if [ -f "$PROJECT_DIR/logs/startup.log" ]; then
            tail -f "$PROJECT_DIR/logs/startup.log"
        else
            log_error "No startup log found. Service may not have been started yet."
        fi
        ;;
    *)
        echo "Claude Code Bot - Service Manager"
        echo ""
        echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  install    Install and start the launchd service"
        echo "  uninstall  Stop and remove the launchd service"
        echo "  start      Start the service"
        echo "  stop       Stop the service"
        echo "  restart    Restart the service"
        echo "  status     Show service status"
        echo "  logs       Follow startup logs (Ctrl+C to exit)"
        echo ""
        exit 1
        ;;
esac
