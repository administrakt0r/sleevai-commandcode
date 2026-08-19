#!/usr/bin/env node
/*
 * sleev-proxy.js — Smart proxy that injects sleev.ai gateway headers
 * and falls back to Command Code's native API for unsupported models.
 *
 * Set COMMANDCODE_API_URL=http://127.0.0.1:18080 to route through this proxy.
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')

const SLEEV_GATEWAY = process.env.SLEEV_GATEWAY_URL || 'http://127.0.0.1:17321'
const COMMANDCODE_API = process.env.COMMANDCODE_FALLBACK_URL || 'https://api.commandcode.ai'
const HARNESS_ID = process.env.SLEEV_HARNESS || 'commandcode'
const LISTEN_PORT = parseInt(process.env.SLEEV_PROXY_PORT || '18080')

// Map model name patterns to sleev-provider header values.
// These must match providers in sleev's models.dev.json catalog.
const PROVIDER_PATTERNS = [
  { test: /^gpt/i, provider: 'openai' },
  { test: /^o1-|^o3-/i, provider: 'openai' },
  { test: /^claude/i, provider: 'anthropic' },
  { test: /^(mimo|xiaomi)/i, provider: 'mimo' },
  { test: /^grok/i, provider: 'xai' },
  { test: /^gemini/i, provider: 'google' },
  { test: /^deepseek/i, provider: 'deepseek' },
  { test: /^kimi|^moonshot/i, provider: 'moonshotai' },
  { test: /^minimax|^mini-max/i, provider: 'minimax' },
  { test: /^zai-org|^glm/i, provider: 'zai-org' },
  { test: /^qwen/i, provider: 'qwen' },
  { test: /^meta-llama|^llama/i, provider: 'meta-llama' },
  { test: /^thinkingmachines|^inkling/i, provider: 'thinkingmachines' },
  { test: /^nvidia|^nemotron/i, provider: 'nvidia' },
]

function resolveSleevProvider(model) {
  if (!model) return null
  const m = model.toLowerCase()
  for (const { test, provider } of PROVIDER_PATTERNS) {
    if (test.test(m)) return provider
  }
  return null
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function forward(req, body, targetBase, extraHeaders) {
  const targetUrl = new URL(targetBase + req.url)
  const isHttps = targetUrl.protocol === 'https:'

  const headers = { ...req.headers }
  delete headers.host
  delete headers['content-length']
  delete headers['transfer-encoding']
  Object.assign(headers, extraHeaders)

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers,
  }

  const transport = isHttps ? https : http
  return new Promise((resolve, reject) => {
    const clientReq = transport.request(options, (clientRes) => {
      resolve({
        status: clientRes.statusCode,
        headers: clientRes.headers,
        stream: clientRes,
      })
    })
    clientReq.on('error', reject)
    if (body) clientReq.write(body)
    clientReq.end()
  })
}

const server = http.createServer(async (req, res) => {
  const body = await getRequestBody(req)
  let model = ''
  let sleevProvider = null

  try {
    const parsed = JSON.parse(body)
    model = parsed.model || ''
    sleevProvider = resolveSleevProvider(model)
  } catch {
    // If body isn't JSON, just forward without sleev headers
  }

  if (sleevProvider && SLEEV_GATEWAY) {
    // Route through sleev gateway with harness headers
    const headers = {
      'sleev-harness': HARNESS_ID,
      'sleev-provider': sleevProvider,
    }
    try {
      const result = await forward(req, body, SLEEV_GATEWAY, headers)
      res.writeHead(result.status, result.headers)
      result.stream.pipe(res)
      return
    } catch (e) {
      console.error(`[sleev-proxy] Sleev gateway error: ${e.message}, falling back to Command Code API`)
    }
  }

  // Fallback: forward to Command Code's native API
  try {
    const result = await forward(req, body, COMMANDCODE_API, {})
    res.writeHead(result.status, result.headers)
    result.stream.pipe(res)
  } catch (e) {
    console.error(`[sleev-proxy] Fallback error: ${e.message}`)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `Proxy error: ${e.message}` }))
  }
})

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.error(`[sleev-proxy] Listening on 127.0.0.1:${LISTEN_PORT} → ${SLEEV_GATEWAY} (harness=${HARNESS_ID})`)
  console.error(`[sleev-proxy] Fallback: ${COMMANDCODE_API} for unsupported models`)
})

// Suppress ECONNRESET noise
server.on('connection', (socket) => {
  socket.on('error', () => {})
})
