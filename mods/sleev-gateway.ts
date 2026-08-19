// Sleev.ai Gateway integration mod for Command Code
// Routes LLM requests through the local sleev proxy for compression and session tracking
//
// How it works:
// 1. Registers a "sleev" provider that sends requests to the local sleev gateway (127.0.0.1:17321)
// 2. Sleev intercepts requests, applies compression, tracks sessions, and forwards to upstream providers
// 3. Use "sleev/<model>" syntax to route through sleev (e.g., sleev/xiaomi/mimo-v2.5-pro)
//
// Usage:
//   cmd --model sleev/xiaomi/mimo-v2.5-pro
//   /model sleev/claude-sonnet-5
//   /sleev  (check gateway status)
import type {ModApi} from '@commandcode/harness';

const SLEEV_GATEWAY_URL = 'http://127.0.0.1:17321';
const HARNESS_ID = 'commandcode';

// Map model ID prefixes to sleev-provider header values.
// Sleev uses this header to route requests to the correct upstream API.
const PROVIDER_PREFIXES: Record<string, string> = {
	'gpt': 'openai',
	'o1': 'openai',
	'o3': 'openai',
	'claude': 'anthropic',
	'grok': 'xai',
	'gemini': 'google',
	'deepseek': 'deepseek',
	'Kimi': 'moonshotai',
	'mimo': 'mimo',
	'GLM': 'zai-org',
	'MiniMax': 'minimax',
	'muse': 'meta',
	'Step': 'stepfun',
	'hy3': 'tencent',
	'nemotron': 'nvidia',
	'inkling': 'thinkingmachines',
	'laguna': 'poolside',
	'fugu': 'sakana',
	'Qwen': 'qwen',
};

// Full model ID -> provider mappings for models with org prefixes
const FULL_MODEL_MAP: Record<string, string> = {
	'moonshotai': 'moonshotai',
	'xiaomi': 'mimo',
	'xai': 'xai',
	'google': 'google',
	'deepseek': 'deepseek',
	'qwen': 'qwen',
	'zai-org': 'zai-org',
	'minimaxai': 'minimax',
	'meta': 'meta',
	'stepfun': 'stepfun',
	'tencent': 'tencent',
	'nvidia': 'nvidia',
	'thinkingmachines': 'thinkingmachines',
	'poolside': 'poolside',
	'sakana': 'sakana',
};

function resolveProvider(modelId: string): string {
	// Handle "org/model" format (e.g., "xiaomi/mimo-v2.5-pro")
	const slashIdx = modelId.indexOf('/');
	if (slashIdx > 0) {
		const org = modelId.slice(0, slashIdx);
		if (FULL_MODEL_MAP[org]) return FULL_MODEL_MAP[org];
	}

	// Handle bare model names (e.g., "gpt-5.6-luna", "claude-sonnet-5")
	for (const [prefix, provider] of Object.entries(PROVIDER_PREFIXES)) {
		if (modelId.startsWith(prefix)) return provider;
	}

	return 'openai'; // safe default
}

export default function (cmd: ModApi): void {
	cmd.addCommand({
		name: 'sleev',
		description: 'Show sleev gateway status, routing info, and usage',
		handler: async () => {
			try {
				const result = await cmd.exec({command: 'systemctl', args: ['--user', 'is-active', 'sleeve-gateway']});
				const status = result.stdout.trim();
				const isActive = status === 'active';
				const lines = [
					`Sleev Gateway: ${isActive ? 'active' : 'stopped'} on ${SLEEV_GATEWAY_URL}`,
					`Harness: ${HARNESS_ID}`,
					`Compression: parallel`,
					'',
					'Usage: prefix model with "sleev/" to route through gateway',
					'  /model sleev/xiaomi/mimo-v2.5-pro',
					'  /model sleev/claude-sonnet-5',
					'  cmd --model sleev/gpt-5.6-luna',
				];
				return {message: lines.join('\n')};
			} catch {
				return {message: `Sleev gateway: unable to check status\nGateway URL: ${SLEEV_GATEWAY_URL}\nMake sure the sleeve-gateway systemd service is running.`};
			}
		},
	});

	// Register the sleev proxy provider.
	// This creates a "sleev" provider namespace. Any model prefixed with "sleev/"
	// (e.g., sleev/xiaomi/mimo-v2.5-pro) routes through the local gateway.
	cmd.addProvider({
		id: 'sleev',
		displayName: 'Sleev.ai Gateway (compressed)',
		transport: {
			kind: 'direct',
			baseUrl: SLEEV_GATEWAY_URL,
			headers: {
				'sleev-harness': HARNESS_ID,
			},
			resolveProvider,
		},
	});
}
