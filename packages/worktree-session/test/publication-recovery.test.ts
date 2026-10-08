import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'
import { bindSource, startOperation } from '../src/host/operation.js'
import { activeBindingContext } from '../src/host/context.js'
import { loadOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []
const contexts: Context[] = []

async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout }

async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ws-publication-'))); roots.push(root)
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.email', 'ws@example.invalid'); await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'initial')
  return root
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return Promise.resolve({ provider, id: model, name: model }) }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Minimal service stubs for the parts of apply() unrelated to publication recovery. */
async function harness(): Promise<{ ctx: Context; adapter: ScriptedAdapter }> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['scripted'], adapter)
  const stubs = ctx as unknown as Record<string, unknown>
  stubs.webServer = { register: () => () => undefined }
  stubs.workspaceRegistry = { list: () => [], archivedSessionIds: [], archiveSession: async () => undefined }
  stubs.subagents = {}
  stubs.storageDomain = {}
  return { ctx, adapter }
}

/** Every text block the model saw in one request, decoded (not JSON-escaped). */
function requestText(request: GenerateOptions): string {
  return request.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('binding recovery at the Agent publication boundary', () => {
  it('installs the durable binding context before the first model request of a resumed source Session', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-publication', repoPath: root, baseRef: 'main', taskText: 'publication recovery', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-publication' })
    const operation = await loadOperation(join(root, '.git'), prepared.operationId)
    if (operation === undefined) throw new Error('operation was not persisted')

    const { ctx, adapter } = await harness()
    apply(ctx)
    const handle = await ctx.agents.create({
      sessionId: SessionId('session-publication'),
      meta: { cwd: root },
      agentOptions: { provider: 'scripted', model: 'scripted' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain(activeBindingContext(operation))
  }, 120_000)

  it('leaves unbound Sessions without any Worktree context', async () => {
    const root = await fixture()
    const { ctx, adapter } = await harness()
    apply(ctx)
    const handle = await ctx.agents.create({
      sessionId: SessionId('session-unbound'),
      meta: { cwd: root },
      agentOptions: { provider: 'scripted', model: 'scripted' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(requestText(adapter.requests[0]!)).not.toContain('Worktree Session')
  }, 120_000)
})
