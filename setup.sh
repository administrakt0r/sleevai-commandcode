#!/usr/bin/env bash
set -euo pipefail

# Sleev.ai + Command Code Integration Setup Script
# This script:
# 1. Checks prerequisites
# 2. Installs the sleev-gateway mod for Command Code
# 3. Installs and starts the sleev-proxy systemd service
# 4. Sets COMMANDCODE_API_URL to route through the proxy

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

echo ""
echo "============================================"
echo "  Sleev.ai + Command Code Integration Setup"
echo "============================================"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────────────────

info "Checking prerequisites..."

# Check Node.js version
if ! command -v node &>/dev/null; then
    fail "Node.js not found. Install Node.js 22+ from https://nodejs.org"
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
    fail "Node.js 22+ required, found $(node -v). Upgrade with: nvm install --lts"
fi
ok "Node.js $(node -v)"

# Check Command Code
if ! command -v cmd &>/dev/null; then
    fail "Command Code not found. Install with: npm i -g command-code"
fi
ok "Command Code installed"

# Check sleev CLI
if ! command -v sleev &>/dev/null; then
    fail "Sleev CLI not found. Install from https://sleev.ai"
fi
ok "Sleev CLI found at $(which sleev)"

# Check sleev gateway service
if ! systemctl --user is-active sleeve-gateway &>/dev/null; then
    warn "Sleev gateway service not running. Attempting to start..."
    systemctl --user start sleeve-gateway 2>/dev/null || true
    sleep 2
    if ! systemctl --user is-active sleeve-gateway &>/dev/null; then
        fail "Sleev gateway not running. Run: sleev setup"
    fi
fi
ok "Sleev gateway is active"

# ── Step 2: Install the mod ──────────────────────────────────────────────────

info "Installing sleev-gateway mod..."

MODS_DIR="$HOME/.commandcode/mods"
MOD_FILE="$MODS_DIR/sleev-gateway.ts"
PROXY_FILE="$MODS_DIR/sleev-proxy.js"
SERVICE_FILE_SRC="$SCRIPT_DIR/mods/sleev-proxy.service"

mkdir -p "$MODS_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_MOD="$SCRIPT_DIR/mods/sleev-gateway.ts"
SOURCE_PROXY="$SCRIPT_DIR/mods/sleev-proxy.js"
SOURCE_SERVICE="$SCRIPT_DIR/mods/sleev-proxy.service"

if [ ! -f "$SOURCE_MOD" ]; then
    fail "Mod file not found at $SOURCE_MOD. Are you running from the repo root?"
fi

cp "$SOURCE_MOD" "$MOD_FILE"
ok "Mod installed at $MOD_FILE"

# ── Step 3: Install the proxy service ─────────────────────────────────────────

info "Installing sleev-proxy service..."

# Find the correct node path
NODE_BIN=$(which node)
SERVICE_FILE="$HOME/.config/systemd/user/sleev-proxy.service"

mkdir -p "$HOME/.config/systemd/user"

# Replace %h with $HOME in the service file
sed "s|%h|$HOME|g" "$SOURCE_SERVICE" > "$SERVICE_FILE"

# Fix the ExecStart to use the correct node binary
sed -i "s|ExecStart=/usr/bin/node|ExecStart=$NODE_BIN|g" "$SERVICE_FILE"

# Copy the proxy script
cp "$SOURCE_PROXY" "$PROXY_FILE"
ok "Proxy script installed at $PROXY_FILE"
ok "Service file installed at $SERVICE_FILE"

# Reload systemd and enable service
systemctl --user daemon-reload 2>/dev/null || warn "systemd daemon-reload failed (non-critical)"
systemctl --user enable sleev-proxy 2>/dev/null || warn "Failed to enable sleev-proxy service"
systemctl --user restart sleev-proxy 2>/dev/null || warn "Failed to start sleev-proxy service"

sleep 1
if systemctl --user is-active sleev-proxy &>/dev/null; then
    ok "sleev-proxy service is active on port 18080"
else
    warn "sleev-proxy service may not have started. Check: journalctl --user -u sleev-proxy"
fi

# ── Step 4: Register commandcode harness in sleev config ─────────────────────

info "Registering commandcode harness in sleev config..."

SLEEV_CONFIG="$HOME/.config/sleev/gateway.json"

if [ ! -f "$SLEEV_CONFIG" ]; then
    warn "Sleev gateway config not found at $SLEEV_CONFIG. Skipping harness registration."
else
    # Check if commandcode harness already exists
    if grep -q '"commandcode"' "$SLEEV_CONFIG" 2>/dev/null; then
        ok "commandcode harness already registered"
    else
        # Add commandcode harness entry using node (always available since we checked)
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$SLEEV_CONFIG', 'utf8'));
if (!config.harnesses) config.harnesses = {};
config.harnesses.commandcode = { configured: true };
fs.writeFileSync('$SLEEV_CONFIG', JSON.stringify(config, null, 2) + '\n');
" 2>/dev/null && ok "Registered commandcode harness in sleev config" || warn "Could not auto-register harness. Add manually to $SLEEV_CONFIG"
    fi
fi

# ── Step 5: Install shell env integration ──────────────────────────────────────

info "Setting up environment integration..."

PROFILE_FILE=""
if [ -f "$HOME/.bashrc" ]; then
    PROFILE_FILE="$HOME/.bashrc"
elif [ -f "$HOME/.zshrc" ]; then
    PROFILE_FILE="$HOME/.zshrc"
fi

if [ -n "$PROFILE_FILE" ]; then
    if ! grep -q "COMMANDCODE_API_URL.*18080" "$PROFILE_FILE" 2>/dev/null; then
        echo "" >> "$PROFILE_FILE"
        echo "# Sleev.ai integration for Command Code" >> "$PROFILE_FILE"
        echo "export COMMANDCODE_API_URL=http://127.0.0.1:18080" >> "$PROFILE_FILE"
        ok "Added COMMANDCODE_API_URL to $PROFILE_FILE"
    else
        ok "COMMANDCODE_API_URL already in $PROFILE_FILE"
    fi
else
    warn "No shell profile found. Set manually: export COMMANDCODE_API_URL=http://127.0.0.1:18080"
fi

# ── Step 6: Verify installation ───────────────────────────────────────────────

info "Verifying installation..."

if [ -f "$MOD_FILE" ]; then
    ok "Mod file exists at $MOD_FILE"
else
    fail "Mod file missing after install"
fi

if [ -f "$PROXY_FILE" ]; then
    ok "Proxy script exists at $PROXY_FILE"
else
    fail "Proxy file missing after install"
fi

# Check proxy health
if curl -s http://127.0.0.1:18080/ -o /dev/null -w '' 2>/dev/null; then
    ok "Proxy is responding on port 18080"
elif systemctl --user is-active sleev-proxy &>/dev/null; then
    ok "sleev-proxy service is active"
else
    warn "Proxy not responding. Check: journalctl --user -u sleev-proxy -n 20"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo -e "  ${GREEN}Setup complete!${NC}"
echo "============================================"
echo ""
echo "The mod auto-loads on every Command Code session."
echo "All requests now route through the sleev proxy automatically."
echo ""
echo "Usage:"
echo "  cmd                                    # Interactive session (sleev auto-routes)"
echo "  /model mimo-v2.5-free                 # Route through sleev"
echo "  /model claude-sonnet-5                # Route through sleev"
echo "  /model poolside/laguna-s-2.1-free      # Falls back to native API"
echo "  /sleev                                 # Check gateway status"
echo ""
echo "CLI usage:"
echo '  cmd -p "your prompt"                   # Uses your configured default model'
echo '  cmd --model mimo-v2.5-free -p "prompt" # Explicit model via sleev'
echo ""
echo "To restart the proxy:"
echo "  systemctl --user restart sleev-proxy"
echo ""
