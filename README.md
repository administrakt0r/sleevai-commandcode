# sleevai-commandcode

**Wire [Sleev.ai](https://sleev.ai) compression and session tracking into [Command Code](https://commandcode.ai) — automatic, zero-touch, with native API fallback.**

Sleev is a local AI gateway proxy that sits between your coding agent and LLM providers. It compresses requests, tracks sessions, and routes to upstream providers. This integration plugs it directly into Command Code via a lightweight proxy + mod combo.

## What you get

- **Parallel request compression** — sleev intercepts and compresses context before it hits the model, reducing token usage
- **Session tracking** — fingerprint-based session routing with full request/response logging
- **Automatic provider routing** — the proxy detects the upstream provider from the model name and sets the correct `sleev-provider` header
- **Native API fallback** — Command Code-specific models (e.g. `poolside/laguna-s-2.1-free`) automatically fall back to `api.commandcode.ai` when sleev doesn't support them
- **`/sleev` command** — check gateway status from inside a Command Code session
- **Zero config after install** — the proxy runs as a systemd service and `COMMANDCODE_API_URL` is set in your shell profile

## Prerequisites

| Requirement | Install |
|---|---|
| **Node.js 22+** | `nvm install --lts` or [nodejs.org](https://nodejs.org) |
| **Command Code** | `npm i -g command-code` then `cmd login` |
| **Sleev.ai CLI + Gateway** | Install from [sleev.ai](https://sleev.ai), then `sleev setup` and `sleev auth` |

Verify your setup:

```bash
node --version                    # v22.x.x or higher
cmd --version                     # Command Code version
sleev --version                   # Sleev CLI version
systemctl --user is-active sleeve-gateway  # should print "active"
```

## Quick install

```bash
git clone https://github.com/administrakt0r/sleevai-commandcode.git
cd sleevai-commandcode
chmod +x setup.sh
./setup.sh
```

The setup script:
1. Checks all prerequisites
2. Copies the mod to `~/.commandcode/mods/sleev-gateway.ts`
3. Installs the proxy script to `~/.commandcode/mods/sleev-proxy.js`
4. Creates a systemd user service (`sleev-proxy`) that auto-starts on boot
5. Sets `COMMANDCODE_API_URL=http://127.0.0.1:18080` in your shell profile
6. Registers `commandcode` as a harness in sleev's config

## Manual install

### 1. Copy the files

```bash
mkdir -p ~/.commandcode/mods
cp mods/sleev-gateway.ts   ~/.commandcode/mods/sleev-gateway.ts
cp mods/sleev-proxy.js     ~/.commandcode/mods/sleev-proxy.js
```

### 2. Start the proxy

```bash
# Option A: systemd service (recommended, survives reboots)
mkdir -p ~/.config/systemd/user
sed 's|%h|'"$HOME"'|g' mods/sleev-proxy.service | \
  sed "s|ExecStart=/usr/bin/node|ExecStart=$(which node)|g" \
  > ~/.config/systemd/user/sleev-proxy.service
systemctl --user daemon-reload
systemctl --user enable --now sleev-proxy

# Option B: run directly (temporary)
node ~/.commandcode/mods/sleev-proxy.js &
```

### 3. Set the environment variable

```bash
echo 'export COMMANDCODE_API_URL=http://127.0.0.1:18080' >> ~/.bashrc
# or ~/.zshrc
source ~/.bashrc
```

### 4. Verify

```bash
cmd mods list
# Should show: sleev-gateway · user · ~/.commandcode/mods/sleev-gateway.ts

curl -s http://127.0.0.1:18080/  # proxy should respond
systemctl --user is-active sleev-proxy  # should print "active"
```

## Usage

After setup, **all** your Command Code models automatically route through sleev when the proxy is running:

### Interactive mode

```bash
cmd
# Everything you type now uses sleev compression
> explain this codebase
```

Inside a session:

```
/sleev    # Check gateway status and supported models
```

### Command line

```bash
# Uses sleev (compression + session tracking enabled)
cmd -p "What is 2+2?"

# Explicit model
cmd --model mimo-v2.5-free -p "refactor this function"
cmd --model claude-sonnet-5 -p "write tests"
cmd --model gpt-5.6-luna -p "explain this codebase"
```

### Model fallback behavior

| Model | Routing |
|---|---|
| `mimo-v2.5-free` | → sleev → mimo upstream |
| `claude-sonnet-5` | → sleev → anthropic upstream |
| `gpt-5.6-luna` | → sleev → openai upstream |
| `poolside/laguna-s-2.1-free` | → native Command Code API (fallback) |
| `command-code` provider | → native Command Code API (fallback) |

## How it works

```
┌─────────────────┐    COMMANDCODE_API_URL     ┌──────────────────┐
│  Command Code   │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶ │  sleev-proxy      │
│  (built-in      │     http://127.0.0.1:18080 │  port 18080       │
│   gateway)      │                            │  (injects headers)│
└─────────────────┘    ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │                   │
                                                └────────│────────┘
                                                          │
         ┌────────────────────────────────────────────────┘
         │         if model maps to a sleev provider
         ▼                                                 if not (fallback)
┌──────────────────┐       ┌─────────────┐     ┌──────────────┐  │
│  sleev-gateway    │ ─ ─▶│  Sleev.ai   │ ─ ─▶│  LLM Provider │  │
│  localhost:17321  │     │  Cloud      │     │  (upstream)   │  │
│  (compression,    │ ◀ ─ │  (routing,  │ ◀ ─ │  OpenAI etc.) │  │
│   sessions)       │     │   logging)  │     │               │  │
└──────────────────┘     └─────────────┘     └──────────────┘  │
                                                                 │
┌──────────────────┐                                           │
│  api.commandcode  │ ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
│  .ai (fallback)   │
└──────────────────┘
```

### Request flow

1. Command Code sends API requests to `COMMANDCODE_API_URL` (the proxy on port 18080)
2. The proxy inspects the request body for the model name
3. If the model maps to a sleev-supported provider, the proxy adds `sleev-harness: commandcode` and `sleev-provider: <provider>` headers and forwards to the sleev gateway (port 17321)
4. Sleev applies parallel compression, session tracking, and routes to the upstream provider
5. If the model is Command Code-specific (not recognized by sleev), the proxy forwards to `api.commandcode.ai` without sleev headers — native behavior preserved

### Why a proxy?

Command Code's built-in provider uses a "gateway" transport that routes through `api.commandcode.ai`. The gateway transport does not support custom HTTP headers, which sleev requires (`sleev-harness` and `sleev-provider`). The lightweight proxy sits in front of the sleev gateway and injects these headers, while transparently falling back to Command Code's native API for models sleev doesn't support.

## Supported models

The proxy auto-detects the upstream provider from the model name. Any model from the following providers works with sleev compression:

| Model prefix / org | Upstream provider |
|---|---|
| `gpt-*` | OpenAI |
| `claude-*` | Anthropic |
| `grok-*` | xAI |
| `gemini-*` | Google |
| `deepseek/*` | DeepSeek |
| `moonshotai/*`, `Kimi-*` | Moonshot |
| `xiaomi/*`, `mimo-*` | Xiaomi/MiMo |
| `Qwen-*` | Alibaba/Qwen |
| `zai-org/*`, `GLM-*` | Zhipu/GLM |
| `MiniMax-*` | MiniMax |
| `meta-llama/*`, `muse-*` | Meta |
| `nvidia/*` | NVIDIA |
| `thinkingmachines/Inkling` | Thinking Machines |

## Troubleshooting

**Mod not loading:**
```bash
cmd mods list
# If missing, check: ls -la ~/.commandcode/mods/sleev-gateway.ts
```

**Proxy not responding:**
```bash
systemctl --user status sleev-proxy
systemctl --user restart sleev-proxy
journalctl --user -u sleev-proxy -n 20
```

**Gateway not running:**
```bash
systemctl --user status sleeve-gateway
systemctl --user restart sleeve-gateway
```

**Model not routing through sleev:**
- Check `/sleev` inside a Command Code session — it shows which models are sleev-compatible
- Add the model prefix to `PROVIDER_PATTERNS` in `mods/sleev-proxy.js`

**Check if compression is active:**
```bash
# Look for compression entries in the latest debug log
dir=$(ls -dt ~/.local/state/sleev/debug-logs/http/*/ | head -1)
grep -ri "compress" "$dir" | tail -5
```

**Sleev auth expired:**
```bash
sleev auth
```

## Files

```
.
├── README.md                   # This file
├── setup.sh                    # Automated setup script
├── LICENSE                     # MIT license
└── mods/
    ├── sleev-gateway.ts        # Command Code mod (provides /sleev command)
    ├── sleev-proxy.js          # Node.js proxy (injects sleev headers, fallback routing)
    └── sleev-proxy.service     # systemd user service file for the proxy
```

## Uninstall

```bash
rm ~/.commandcode/mods/sleev-gateway.ts
rm ~/.commandcode/mods/sleev-proxy.js
systemctl --user stop sleev-proxy
systemctl --user disable sleev-proxy
rm ~/.config/systemd/user/sleev-proxy.service
# Remove COMMANDCODE_API_URL from ~/.bashrc or ~/.zshrc
```

## License

MIT
