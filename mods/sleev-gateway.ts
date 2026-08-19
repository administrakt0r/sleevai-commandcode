// Sleev.ai Gateway integration mod for Command Code
//
// This mod provides:
// 1. A /sleev status command showing gateway health and routing info
// 2. A registry of sleev-compatible models for quick reference
//
// The actual request routing is handled by sleev-proxy.js, which is started
// by setup.sh as a systemd user service. Set COMMANDCODE_API_URL=
// http://127.0.0.1:18080 so Command Code routes all API requests through the
// proxy, which injects sleev headers and forwards to the gateway.
//
// Architecture:
//   Command Code → (COMMANDCODE_API_URL) → sleev-proxy (port 18080)
//          → sleev-gateway (port 17321) → upstream providers (OpenAI, Anthropic, etc.)
//          → OR falls back to api.commandcode.ai for unsupported models
//
// Usage:
//   /sleev              Check gateway status and supported models
//   cmd --model mimo-v2.5-free         Routes through sleev (auto-detected)
//   cmd --model claude-sonnet-5        Routes through sleev
//   cmd --model poolside/laguna-s-2.1-free  Falls back to native API
import type { ModApi } from '@commandcode/harness'

const SLEEV_GATEWAY_URL = 'http://127.0.0.1:17321'
const SLEEV_PROXY_PORT = 18080
const HARNESS_ID = 'commandcode'

// Models known to be routed through sleev. These are model IDs that map
// to providers sleev recognizes (from its models.dev.json catalog).
// Command Code-specific models (poolside/*, command-code/*) are NOT routed
// through sleev — they fall back to the native API.
const SLEEV_COMPATIBLE_MODELS = [
	{ id: 'mimo-v2.5-pro', provider: 'mimo', description: 'MiMo Pro (reasoning)' },
	{ id: 'mimo-v2.5-free', provider: 'mimo', description: 'MiMo Free' },
	{ id: 'gpt-5.6-luna', provider: 'openai', description: 'GPT-5.6 Luna' },
	{ id: 'gpt-4.1', provider: 'openai', description: 'GPT-4.1' },
	{ id: 'gpt-4.1-mini', provider: 'openai', description: 'GPT-4.1 Mini' },
	{ id: 'gpt-oss-120b', provider: 'openai', description: 'GPT OSS 120B' },
	{ id: 'claude-sonnet-5', provider: 'anthropic', description: 'Claude Sonnet 5' },
	{ id: 'claude-opus-5', provider: 'anthropic', description: 'Claude Opus 5' },
	{ id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', description: 'Claude 3.5 Sonnet' },
	{ id: 'grok-4.6', provider: 'xai', description: 'Grok 4.6' },
	{ id: 'grok-4.3', provider: 'xai', description: 'Grok 4.3' },
	{ id: 'gemini-2.5-pro', provider: 'google', description: 'Gemini 2.5 Pro' },
	{ id: 'gemini-3.7-flash', provider: 'google', description: 'Gemini 3.7 Flash' },
	{ id: 'deepseek/DeepSeek-V3.2', provider: 'deepseek', description: 'DeepSeek V3.2' },
	{ id: 'deepseek-ai/DeepSeek-R1', provider: 'deepseek', description: 'DeepSeek R1' },
	{ id: 'moonshotai/Kimi-K2.6', provider: 'moonshotai', description: 'Kimi K2.6' },
	{ id: 'moonshotai/Kimi-K3', provider: 'moonshotai', description: 'Kimi K3' },
	{ id: 'MiniMaxAI/MiniMax-M2.7', provider: 'minimax', description: 'MiniMax M2.7' },
	{ id: 'mini-max/MiniMax-M2.7', provider: 'minimax', description: 'MiniMax M2.7' },
	{ id: 'zai-org/GLM-5', provider: 'zai-org', description: 'GLM-5' },
	{ id: 'thinkingmachines/Inkling', provider: 'thinkingmachines', description: 'Inkling' },
	{ id: 'Qwen/Qwen3.6-27B', provider: 'qwen', description: 'Qwen3.6 27B' },
	{ id: 'Qwen/Qwen3-32B', provider: 'qwen', description: 'Qwen3 32B' },
	{ id: 'Qwen/QwQ-32B', provider: 'qwen', description: 'QwQ 32B' },
	{ id: 'nvidia/Nemotron-Cascade-2-30B-A3B', provider: 'nvidia', description: 'Nemotron Cascade 2' },
	{ id: 'nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16', provider: 'nvidia', description: 'Nemotron 3 Nano Omni' },
	{ id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', provider: 'meta-llama', description: 'Llama 4 Maverick' },
	{ id: 'meta-llama/Meta-Llama-3.3-70B-Instruct', provider: 'meta-llama', description: 'Llama 3.3 70B' },
]

function isSleevCompatible(model: string): boolean {
	if (!model) return false
	const lower = model.toLowerCase()
	return SLEEV_COMPATIBLE_MODELS.some(m => lower.includes(m.id.toLowerCase()))
}

export default function (cmd: ModApi): void {
	cmd.addCommand({
		name: 'sleev',
		description: 'Show sleev.ai gateway status, routing info, and supported models',
		handler: async () => {
			const lines: string[] = []
			lines.push('=== Sleev.ai Integration ===')
			lines.push('')

			// Check if proxy is running
			let proxyActive = false
			try {
				const result = await cmd.exec({
					command: 'systemctl',
					args: ['--user', 'is-active', 'sleev-proxy'],
				})
				proxyActive = result.stdout.trim() === 'active'
				lines.push(`Proxy: ${proxyActive ? 'active' : 'stopped'} (port ${SLEEV_PROXY_PORT})`)
			} catch {
				lines.push(`Proxy: not installed (run setup.sh first)`)
			}

			// Check gateway
			try {
				const result = await cmd.exec({
					command: 'systemctl',
					args: ['--user', 'is-active', 'sleeve-gateway'],
				})
				const active = result.stdout.trim() === 'active'
				lines.push(`Gateway: ${active ? 'active' : 'stopped'} (${SLEEV_GATEWAY_URL})`)
			} catch {
				lines.push(`Gateway: unknown`)
			}

			lines.push(`Harness: ${HARNESS_ID}`)
			lines.push('')

			// Show current model
			const currentModel = cmd.config?.model || 'unknown'
			const compatible = isSleevCompatible(currentModel)
			lines.push(`Current model: ${currentModel}`)
			lines.push(`Routes through sleev: ${compatible ? 'yes' : 'no (native API fallback)'}`)
			lines.push('')

			// Show supported models
			lines.push('Sleev-compatible models:')
			const current = cmd.config?.model || ''
			for (const m of SLEEV_COMPATIBLE_MODELS) {
				const marker = current.includes(m.id) ? ' *' : ''
				lines.push(`  ${m.id}${marker} → ${m.provider}`)
			}
			lines.push('')
			lines.push('Models not listed above fall back to the native Command Code API.')
			lines.push('')

			if (!proxyActive) {
				lines.push('To enable sleev integration:')
				lines.push(`  export COMMANDCODE_API_URL=http://127.0.0.1:${SLEEV_PROXY_PORT}`)
				lines.push('  cmd --model mimo-v2.5-free')
			} else {
				lines.push('Active. All requests route through the sleev proxy automatically.')
			}

			return { message: lines.join('\n') }
		},
	})
}
