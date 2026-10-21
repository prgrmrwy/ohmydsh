import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

// Test runners choose exactly ONE isolated runtime graph for the whole process.
const deps = createRequire(process.env.DSH_COLLAB_DEPENDENCY_ROOT
  ? join(process.env.DSH_COLLAB_DEPENDENCY_ROOT, 'package.json')
  : new URL('../../../../spike/collab-components/package.json', import.meta.url))
export function moduleUrl(name) { return pathToFileURL(deps.resolve(`@deepseek-ai/${name}`)).href }
export async function moduleOf(name) { return import(moduleUrl(name)) }
const { Context } = await moduleOf('cordis')
const { default: Loader } = await moduleOf('cordis-plugin-loader')
const { default: LlmRuntime, LlmAdapter, ToolCallId } = await moduleOf('dsh-llm')

class Scripted extends LlmAdapter {
  requests = []
  nextTool
  barrier
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    this.requests.push(options)
    if (this.barrier) { const barrier = this.barrier; this.barrier = undefined; barrier.entered(); await barrier.wait }
    if (this.nextTool) {
      const tool = this.nextTool
      const name = typeof tool === 'string' ? tool : tool.name
      const args = typeof tool === 'string' ? '{}' : JSON.stringify(tool.arguments)
      this.nextTool = undefined
      const id = ToolCallId('approval-probe')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'component-only' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'component-only' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
async function install(ctx, name, config = {}) {
  const mod = await moduleOf(name)
  const fiber = ctx.plugin(mod.default ?? mod, config)
  await fiber.inertia
}
export async function controller(root, onCreated) {
  const ctx = new Context()
  try {
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(`${root}/`).href })
    await ctx.plugin(LlmRuntime)
    for (const name of ['dsh-session', 'dsh-session-projection']) await install(ctx, name)
    await install(ctx, 'dsh-system-prompt', { persona: '' })
    for (const name of ['dsh-tools', 'dsh-agent']) await install(ctx, name)
    await install(ctx, 'dsh-session-persistence-jsonl', { root: join(root, 'sessions'), compression: 'none' })
    await install(ctx, 'dsh-agent-loop', { agents: [] })
    const adapter = new Scripted()
    ctx.llm.registerAdapter(['scripted'], adapter)
    await install(ctx, 'dsh-agent-default-model', { provider: 'scripted', model: 'scripted' })
    await install(ctx, 'dsh-typert-registry')
    await install(ctx, 'dsh-commands')
    await install(ctx, 'dsh-credentials-local', { dshHome: root, watch: false })
    await install(ctx, 'dsh-client-connection')
    await install(ctx, 'dsh-attachment-local', { dshHome: root })
    await install(ctx, 'dsh-client-file-upload')
    await install(ctx, 'dsh-sandbox-policy', { mode: 'danger-full-access', workspaceRoot: root })
    await install(ctx, 'dsh-fs-sandbox', { cwd: root })
    await install(ctx, 'dsh-user-approval', { policy: 'ask' })
    await install(ctx, 'dsh-tool-fs')
    await install(ctx, 'dsh-subprocess-local')
    await install(ctx, 'dsh-sandbox-local')
    await install(ctx, 'dsh-bash-sandbox')
    await install(ctx, 'dsh-jobs-local')
    await install(ctx, 'dsh-shell-env')
    await install(ctx, 'dsh-tool-bash')
    await install(ctx, 'dsh-session-query')
    await install(ctx, 'dsh-storage')
    await install(ctx, 'dsh-storage-sqlite', { path: join(root, 'state.sqlite') })
    await install(ctx, 'dsh-storage-domain', { backend: 'sqlite' })
    await install(ctx, 'dsh-workspace')
    await install(ctx, 'dsh-agent-preset-registry', { default: 'P1' })
    await install(ctx, 'dsh-api-session-controller', { nativeOpen: false })
    assert.ok(ctx.sessionController, 'real SessionController was activated')
    ctx.componentAdapter = adapter
    if (onCreated) ctx.on('agent/created', onCreated)
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
export async function presets(ctx) {
  for (const id of ['P1', 'P2']) await ctx.agentPresets.register({
    id, plugins: [{ name: new URL('./preset-sentinel.mjs', import.meta.url).href, config: { toolName: `sentinel_${id}` } }],
  })
}
