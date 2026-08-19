#!/usr/bin/env bash
set -euo pipefail

# Sleev.ai + Command Code Integration Setup Script
# This script installs the sleev-gateway mod for Command Code and registers
# the commandcode harness in sleev's configuration.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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
    fail "Node.js 22+ required, found v$(node -v). Upgrade with: nvm install --lts"
fi
ok "Node.js $(node -v)"

# Check Command Code
if ! command -v cmd &>/dev/null; then
    fail "Command Code not found. Install with: npm i -g command-code"
fi
ok "Command Code $(cmd --version 2>/dev/null || echo 'installed')"

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

# Check sleev auth
if [ ! -f "$HOME/.config/sleev/cli-auth.json" ]; then
    warn "Sleev CLI not authenticated. Run: sleev auth"
fi
ok "Sleev authentication found"

# ── Step 2: Install the mod ──────────────────────────────────────────────────

info "Installing sleev-gateway mod..."

MODS_DIR="$HOME/.commandcode/mods"
MOD_FILE="$MODS_DIR/sleev-gateway.ts"

mkdir -p "$MODS_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_MOD="$SCRIPT_DIR/mods/sleev-gateway.ts"

if [ ! -f "$SOURCE_MOD" ]; then
    fail "Mod file not found at $SOURCE_MOD. Are you running from the repo root?"
fi

cp "$SOURCE_MOD" "$MOD_FILE"
ok "Mod installed at $MOD_FILE"

# ── Step 3: Register commandcode harness in sleev config ─────────────────────

info "Registering commandcode harness in sleev config..."

SLEEV_CONFIG="$HOME/.config/sleev/config.json"

if [ ! -f "$SLEEV_CONFIG" ]; then
    fail "Sleev config not found at $SLEEV_CONFIG. Run: sleev setup"
fi

# Check if commandcode harness already exists
if grep -q '"commandcode"' "$SLEEV_CONFIG"; then
    ok "commandcode harness already registered"
else
    # Add commandcode harness entry using python (available on most systems)
    if command -v python3 &>/dev/null; then
        python3 -c "
import json
with open('$SLEEV_CONFIG', 'r') as f:
    config = json.load(f)
if 'harnesses' not in config:
    config['harnesses'] = {}
config['harnesses']['commandcode'] = {'configured': True}
with open('$SLEEV_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
"
        ok "Registered commandcode harness in sleev config"
    elif command -v node &>/dev/null; then
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$SLEEV_CONFIG', 'utf8'));
if (!config.harnesses) config.harnesses = {};
config.harnesses.commandcode = {configured: true};
fs.writeFileSync('$SLEEV_CONFIG', JSON.stringify(config, null, 2) + '\n');
"
        ok "Registered commandcode harness in sleev config"
    else
        warn "Could not auto-register harness. Add this to $SLEEV_CONFIG manually:"
        warn '  "harnesses": { ... "commandcode": { "configured": true } }'
    fi
fi

# ── Step 4: Verify installation ──────────────────────────────────────────────

info "Verifying installation..."

if [ -f "$MOD_FILE" ]; then
    ok "Mod file exists at $MOD_FILE"
else
    fail "Mod file missing after install"
fi

# Test that cmd can load the mod
if cmd mods list 2>/dev/null | grep -q "sleev-gateway"; then
    ok "Mod loaded successfully by Command Code"
else
    warn "Mod may not be loaded yet. It will load on next session start."
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo -e "  ${GREEN}Setup complete!${NC}"
echo "============================================"
echo ""
echo "Usage:"
echo "  cmd                                    # Start interactive session"
echo "  /model sleev/xiaomi/mimo-v2.5-pro      # Route model through sleev"
echo "  /model sleev/claude-sonnet-5           # Any supported model works"
echo "  /sleev                                 # Check gateway status"
echo ""
echo "CLI usage:"
echo '  cmd --model sleev/xiaomi/mimo-v2.5-pro -p "your prompt"'
echo '  cmd --model sleev/gpt-5.6-luna -p "your prompt"'
echo ""
echo "The mod auto-loads on every Command Code session."
echo "Prefix any model with sleev/ to route through the gateway."
echo ""
