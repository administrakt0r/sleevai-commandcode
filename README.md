# sleev-cmdcode

**Wire [Sleev.ai](https://sleev.ai) compression and session tracking into [Command Code](https://commandcode.ai) in under 60 seconds.**

Sleev is a local AI gateway proxy that sits between your coding agent and LLM providers. It compresses requests, tracks sessions, and routes to upstream providers — saving tokens and adding observability. This mod plugs it directly into Command Code.

## What you get

- **Parallel request compression** — sleev intercepts and compresses context before it hits the model, reducing token usage
- **Session tracking** — fingerprint-based session routing with full request/response logging
- **Provider routing** — prefix any model with `sleev/` and sleev handles upstream routing automatically
- **Zero config after setup** — the mod auto-loads on every Command Code session
- **`/sleev` command** — check gateway status from inside a session

## Prerequisites

| Requirement | Install |
|---|---|
| **Node.js 22+** | `nvm install --lts` or [nodejs.org](https://nodejs.org) |
| **Command Code** | `npm i -g command-code` then `cmd login` |
| **Sleev.ai CLI + Gateway** | Install from [sleev.ai](https://sleev.ai), then `sleev setup` and `sleev auth` |

Verify your setup:

```bash
node --version          # v22.x.x or higher
cmd --version           # Command Code version
sleev --version         # Sleev CLI version
systemctl --user is-active sleeve-gateway  # should print "active"
```

## Quick install

```bash
git clone https://github.com/administrakt0r/sleev-cmdcode.git
cd sleev-cmdcode
chmod +x setup.sh
./setup.sh
```

The setup script:
1. Checks all prerequisites
2. Copies the mod to `~/.commandcode/mods/sleev-gateway.ts`
3. Registers `commandcode` as a harness in `~/.config/sleev/config.json`
4. Verifies the installation

## Manual install

If you prefer to install by hand:

### 1. Copy the mod

```bash
mkdir -p ~/.commandcode/mods
cp mods/sleev-gateway.ts ~/.commandcode/mods/sleev-gateway.ts
```

### 2. Register the harness

Add `"commandcode": { "configured": true }` to the `harnesses` section in `~/.config/sleev/config.json`:

```json
{
  "harnesses": {
    "opencode": { "configured": true },
    "commandcode": { "configured": true }
  }
}
```

### 3. Verify

```bash
cmd mods list
# Should show: sleev-gateway · user · ~/.commandcode/mods/sleev-gateway.ts
```

## Usage

Prefix any model ID with `sleev/` to route through the gateway:

### Interactive mode

```
cmd
/model sleev/xiaomi/mimo-v2.5-pro
> your prompt here
```

### From the command line

```bash
cmd --model sleev/xiaomi/mimo-v2.5-pro -p "explain this codebase"
cmd --model sleev/claude-sonnet-5 -p "refactor this function"
cmd --model sleev/gpt-5.6-luna -p "write tests for this module"
```

### Check gateway status

Inside a Command Code session:

```
/sleev
```

Output:
```
Sleev Gateway: active on http://127.0.0.1:17321
Harness: commandcode
Compression: parallel

Usage: prefix model with "sleev/" to route through gateway
  /model sleev/xiaomi/mimo-v2.5-pro
  /model sleev/claude-sonnet-5
  cmd --model sleev/gpt-5.6-luna
```

## Supported models

Any model that sleev supports works. The mod auto-resolves the upstream provider from the model name:

| Prefix / Org | Upstream Provider |
|---|---|
| `gpt-*`, `o1-*`, `o3-*` | OpenAI |
| `claude-*` | Anthropic |
| `grok-*` | xAI |
| `gemini-*` | Google |
| `deepseek/*` | DeepSeek |
| `moonshotai/*`, `Kimi-*` | Moonshot |
| `xiaomi/*`, `mimo-*` | Xiaomi/MiMo |
| `Qwen-*` | Alibaba/Qwen |
| `zai-org/*`, `GLM-*` | Zhipu/GLM |
| `MiniMax-*` | MiniMax |
| `meta/*`, `muse-*` | Meta |
| `xai/*` | xAI |
| `google/*` | Google |

See the full list in the [mod source](mods/sleev-gateway.ts).

## How it works

```
Command Code ──► sleev-gateway mod ──► localhost:17321 ──► sleev.ai cloud ──► LLM provider
                    (this mod)          (sleev gateway)     (compression)      (OpenAI, etc.)
```

1. The mod registers a `sleev` provider in Command Code's mod system using `cmd.addProvider()`
2. When you use `sleev/<model>`, Command Code sends the request to the local sleev gateway on port 17321
3. Sleev detects the request format (chat completions), applies parallel compression, tracks the session, and forwards to the upstream provider
4. Responses flow back through the same path with decompression

The mod uses the `commandcode` harness ID, which is registered in sleev's config during setup. This is the same pattern that sleev uses for opencode and other supported tools.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌──────────────┐
│  Command Code   │────▶│  Sleev Gateway   │────▶│  Sleev.ai   │────▶│  LLM Provider│
│  + sleev mod    │     │  localhost:17321  │     │  Cloud      │     │  (upstream)  │
│                 │◀────│                  │◀────│             │◀────│              │
└─────────────────┘     └──────────────────┘     └─────────────┘     └──────────────┘
   sleev/model-id         format detection         compression         OpenAI / Anthropic
   headers injected       session tracking         session mgmt        Moonshot / xAI / ...
```

## Uninstall

```bash
rm ~/.commandcode/mods/sleev-gateway.ts
```

Then remove the `"commandcode"` entry from `~/.config/sleev/config.json` if desired.

## Troubleshooting

**Mod not loading:**
```bash
cmd mods list
# If missing, check the file exists:
ls -la ~/.commandcode/mods/sleev-gateway.ts
```

**Gateway not running:**
```bash
systemctl --user status sleeve-gateway
systemctl --user restart sleeve-gateway
```

**Requests failing:**
```bash
# Check sleev auth
sleev auth

# Check gateway logs
tail -50 ~/.local/state/sleev/debug-logs/server/gateway.err.log
```

**Model not routing correctly:**
The mod auto-resolves providers from model names. If your model isn't mapped, open an issue or edit the `PROVIDER_PREFIXES` / `FULL_MODEL_MAP` objects in the mod file.

## Files

```
.
├── README.md               # This file
├── setup.sh                # Automated setup script
├── LICENSE                 # MIT license
└── mods/
    └── sleev-gateway.ts    # The Command Code mod
```

## License

MIT
