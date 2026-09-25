import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const server = new URL('./fixtures/mock-typed-mcp-server.mjs', import.meta.url)

async function loadMcpClient(t) {
  try {
    return await import('@deepseek-ai/dsh-mcp-client')
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip('exact @deepseek-ai/dsh-mcp-client is installed only in the managed DSH profile/integration probe')
      return undefined
    }
    throw error
  }
}

async function harness(McpClient) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpClient, {
    transport: 'stdio',
    serverName: 'mock',
    command: process.execPath,
    args: [server.pathname],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 2_000,
    failOnStartupError: true,
    reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
  })
  return ctx
}

test('real DSH MCP bridge exposes a typed tool and dispatches it', async t => {
  const McpClient = await loadMcpClient(t)
  if (McpClient === undefined) return
  const ctx = await harness(McpClient)
  try {
    const schemas = ctx.tools.schemas()
    const schema = schemas.find(tool => tool.name === 'mcp__mock__typed_decide')
    assert.ok(schema, `tool surface: ${schemas.map(tool => tool.name).join(', ')}`)
    assert.deepEqual(schema.parameters.required, ['candidate'])

    const result = await ctx.tools.execute({
      callId: 'call-mock-1',
      name: 'mcp__mock__typed_decide',
      arguments: { candidate: 'anvil' },
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, false)
    assert.deepEqual(result.value.structuredContent, { selected: 'anvil', confidence: 0.99 })
  } finally {
    await ctx.fiber.dispose()
  }
})

test('disposing the real bridge unregisters the MCP tool', async t => {
  const McpClient = await loadMcpClient(t)
  if (McpClient === undefined) return
  const ctx = await harness(McpClient)
  const runtime = ctx.tools
  assert.ok(runtime.schemas().some(tool => tool.name === 'mcp__mock__typed_decide'))
  await ctx.fiber.dispose()
  assert.equal(runtime.schemas().some(tool => tool.name === 'mcp__mock__typed_decide'), false)
})
