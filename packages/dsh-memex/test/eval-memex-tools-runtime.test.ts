import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fixedProgramOutcome, programEvidence, type ProgramEvidence } from '../src/eval/program-evidence.js'
import { fixedPlanPreview } from '../src/eval/round.js'
import { registerMemexLifecycle } from '../src/lifecycle/index.js'
import type { ScopeResolution, ScopeService } from '../src/scope/types.js'
import { resetFailureLatch } from '../src/telemetry/sink.js'
import { registerMemexTools, type KernelRunner } from '../src/tools/index.js'

// Runner injection alone does not stop recall telemetry's direct git probe.
const subprocesses = vi.hoisted(() => vi.fn((..._args: unknown[]): never => { throw new Error('Offline contract forbids subprocesses') }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: subprocesses, spawnSync: subprocesses, exec: subprocesses, execSync: subprocesses,
  execFile: subprocesses, execFileSync: subprocesses, fork: subprocesses,
}))

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'agent': { kind: 'agent' } }
}

const plan = fixedPlanPreview()
const know = plan.items.find(item => item.id === 'know-mem')!
const writeback = plan.items.find(item => item.id === 'writeback-mem')!
const naturalPrompts = [know.prompt, writeback.prompt, writeback.followUp!]
const fact = 'Fictional Lantern permits four retries.'
const link = '[[retry-limit]]'
const card = '---\ntitle: Lease\ncreated: 2026-01-01\n---\nleaseSeconds is 45\n'
const retrievalTools = ['memex_read', 'memex_recall', 'memex_search'] as const
const writeTools = ['memex_retro', 'memex_write'] as const
const contexts: Context[] = []
let home: string

function textResponse(text = 'Local scripted answer'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResponse(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const raw = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: raw },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: raw } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly script: StreamChunk[][]) { super() }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    expect(options.provider).toBe('offline')
    const response = this.script.shift()
    if (!response) throw new Error('Offline script exhausted')
    yield* response
  }
}

function scopes(): { service: ScopeService; own: { scope: string; home: string; cwd: string } } {
  const cwd = join(home, 'workspace')
  const route = (scope: string): ScopeResolution => ({
    scope, home: join(home, 'libraries', scope), homeSource: 'configured', publish: 'internal', publishKnown: true,
    memory: true, fallback: false, personal: { read: false, write: false }, source: 'config',
    entries: [scope], access: { current: scope, read: ['eval-real-tools', 'eval-other'], write: [scope] },
    claim: { kind: 'none' }, offBy: { memory: [], fallback: [] }, created: false, workspacePaths: [cwd],
  })
  const routes = [route('eval-real-tools'), route('eval-other')]
  for (const value of routes) mkdirSync(value.home, { recursive: true })
  mkdirSync(cwd)
  const current = routes[0]!
  const service: ScopeService = {
    resolve: value => { expect(value).toBe(cwd); return current },
    list: () => routes,
    resolveByName: name => {
      const value = routes.find(value => value.scope === name)
      if (!value) throw new Error(`Unexpected scope: ${name}`)
      return value
    },
    ensure: value => { expect(value.home.startsWith(home + sep)).toBe(true); return value },
    bindingFor: () => undefined,
    accessFor: name => ({ current: name, read: routes.map(value => value.scope), write: [name] }),
  }
  return { service, own: { scope: current.scope, home: current.home, cwd } }
}

const ok = (stdout = '') => ({ ok: true, exitCode: 0, stdout, stderr: '' })
const failed = () => ({ ok: false, exitCode: 1, stdout: fact, stderr: 'scripted kernel failure' })
const readArgs = (tool: typeof retrievalTools[number]) => tool === 'memex_read' ? { slug: 'entry' } : { query: 'retry', intent: 'gap' }
const writeArgs = (tool: typeof writeTools[number]) => tool === 'memex_retro'
  ? { slug: 'lease', title: 'Lease', body: 'leaseSeconds is 45' }
  : { slug: 'lease', content: card }
const kernelText = (tool: typeof retrievalTools[number], text: string) => tool === 'memex_read' ? text : `## entry\nEntry\n${text}\n`

async function harness(script: StreamChunk[][], reply: KernelRunner = async () => ok()) {
  const { service, own } = scopes()
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  const lifecycle = registerMemexLifecycle(ctx, service)
  const runner = vi.fn<KernelRunner>(async (args, options) => {
    expect([own.home, join(home, 'libraries', 'eval-other')]).toContain(options.home)
    expect(['read', 'search', 'write']).toContain(args[0])
    return reply(args, options)
  })
  registerMemexTools(ctx, service, { runner, onToolSuccess: lifecycle.mark })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['offline'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId(`offline-${contexts.length}`), meta: { cwd: own.cwd }, agentOptions: { provider: 'offline', model: 'scripted' } })
  const events = () => handle.agent.session.snapshotEvents()
  const evidence = (prompts: readonly string[] = naturalPrompts) => programEvidence(handle.agent.id, events(), 0, own, prompts)
  const outcome = (observed: ProgramEvidence, item = know) => fixedProgramOutcome(item, { ...observed, sessions: [{ session: handle.agent.id, writeback: observed.writeback }] })
  return { adapter, agent: handle.agent, runner, own, events, evidence, outcome }
}

async function step(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}
const results = (events: readonly SessionEvent[]) => events.filter(event => event.type === 'tool/result')
const reminders = (events: readonly SessionEvent[]) => events.filter(event => event.type === 'user/message'
  && event.data.source.kind === 'plugin:dsh-memex' && 'summary' in event.data.source && event.data.source.summary === 'Memex write reminder')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'memex-tools-contract-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('DSH_HOME', join(home, '.dsh'))
  // Real producer timestamps must be strictly ordered without mutating snapshots.
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => ++now)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline contract forbids network'))
  subprocesses.mockClear()
})
afterEach(async () => {
  try {
    await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
    for (const [command, args] of subprocesses.mock.calls) {
      expect(command).toBe('git')
      expect(args).toEqual(['--no-optional-locks', '-C', expect.any(String), 'rev-parse', '--show-toplevel', 'HEAD'])
      expect([join(home, 'libraries', 'eval-real-tools'), join(home, 'libraries', 'eval-other')]).toContain((args as string[])[2])
    }
    expect(globalThis.fetch).not.toHaveBeenCalled()
    // The runner records writes but never creates cards or sync metadata.
    for (const scope of ['eval-real-tools', 'eval-other']) expect(readdirSync(join(home, 'libraries', scope))).toEqual([])
  } finally {
    vi.restoreAllMocks(); vi.unstubAllEnvs(); resetFailureLatch()
    const target = resolve(home)
    if (target !== home || !target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)!.startsWith('memex-tools-contract-')) throw new Error('Unexpected temporary cleanup target')
    rmSync(target, { recursive: true, force: true })
  }
})

describe('production Memex tools → real session snapshots → program evidence (offline)', () => {
  it.each(retrievalTools)('%s delivers its actual current-library output to R with exact result provenance', async tool => {
    const text = kernelText(tool, fact)
    const h = await harness([toolResponse('retrieval', tool, readArgs(tool)), textResponse()], async () => ok(text))
    await step(h.agent, know.prompt)
    const event = results(h.events())[0]!
    expect(event.data.message.isError).not.toBe(true)
    const result = JSON.parse(event.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'))
    expect(result.current).toMatchObject({ scope: h.own.scope, home: h.own.home })
    expect(tool === 'memex_search' ? result.hits[0].scope : (tool === 'memex_read' ? result.target.scope : result.current.scope)).toBe(h.own.scope)
    const observed = h.evidence()
    expect(observed.retrieval).toEqual([{ source: `${h.agent.id}:${event.seq}`, tool, text: tool === 'memex_search' ? fact : text }])
    expect(h.outcome(observed).R).toEqual(['yes'])
    expect(programEvidence(h.agent.id, h.events(), h.events().length, h.own, naturalPrompts).retrieval).toEqual([])
  })

  it('does not attribute another library\'s read or fan-out search hit to current-library R', async () => {
    const h = await harness([
      toolResponse('other-read', 'memex_read', { slug: 'entry', scope: 'eval-other' }),
      toolResponse('fanout', 'memex_search', { query: 'retry', scope: 'all', intent: 'gap' }), textResponse(),
    ], async (args, options) => ok(args[0] === 'read' ? fact : kernelText('memex_search', options.home.endsWith('eval-other') ? fact : 'Unrelated current summary.')))
    await step(h.agent, know.prompt)
    const observed = h.evidence()
    expect(observed.retrieval).toEqual([{ source: `${h.agent.id}:${results(h.events())[1]!.seq}`, tool: 'memex_search', text: 'Unrelated current summary.' }])
    expect(h.outcome(observed).R).toEqual(['no'])
    expect(h.runner).toHaveBeenCalledTimes(3)
  })

  it.each(retrievalTools)('%s failure is not R delivery even if kernel stdout contains the fact', async tool => {
    const h = await harness([toolResponse('failed-read', tool, readArgs(tool)), textResponse()], async () => failed())
    await step(h.agent, know.prompt)
    expect(results(h.events())[0]!.data.message.isError).toBe(true)
    expect(h.evidence().retrieval).toEqual([])
    expect(h.outcome(h.evidence()).R).toEqual(['no'])
  })

  it.each(retrievalTools)('%s keeps a wikilink as delivered text and never expands its target into R', async tool => {
    const h = await harness([toolResponse('link-only', tool, readArgs(tool)), textResponse()], async () => ok(kernelText(tool, link)))
    await step(h.agent, know.prompt)
    const observed = h.evidence()
    expect(observed.retrieval).toHaveLength(1)
    expect(observed.retrieval[0]!.text).toContain(link)
    expect(observed.retrieval[0]!.text).not.toContain(fact)
    expect(h.outcome(observed).R).toEqual(['no'])
    expect(h.runner).toHaveBeenCalledTimes(1)
    expect(h.runner.mock.calls.some(([args]) => args[0] === 'read' && args.at(-1) === 'retry-limit')).toBe(false)
  })

  describe.each(writeTools)('%s success and failure', tool => {
    it.each([true, false])('counts only an actual written=true result (kernel success=%s)', async success => {
      const args = writeArgs(tool)
      const h = await harness([toolResponse('write', tool, args), textResponse()], async () => success ? ok() : failed())
      await step(h.agent, writeback.prompt)
      const event = results(h.events())[0]!
      expect(Boolean(event.data.message.isError)).toBe(!success)
      const observed = h.evidence()
      expect(observed.writes).toEqual([{ source: `${h.agent.id}:${event.seq}`, tool, at: event.time, success, targetCorrect: success, slug: 'lease', content: tool === 'memex_retro' ? args.body : args.content }])
      expect(observed.writeback).toEqual({ class: success ? 'proactive' : 'not-written', failedWrites: success ? 0 : 1 })
      expect(h.outcome(observed, writeback).W).toEqual(success ? ['yes', 'unknown'] : ['no'])
      expect(h.runner).toHaveBeenCalledTimes(1)
      expect(h.runner.mock.calls[0]![0]).toEqual(['write', '--', 'lease'])
      expect(h.runner.mock.calls[0]![1].stdin).toContain('source: dsh')
      expect(h.runner.mock.calls[0]![1].stdin).toContain('leaseSeconds is 45')
      expect(reminders(h.events())).toEqual([])
    })

    it('classifies the first successful write after the real next-turn reminder, preserving earlier failure', async () => {
      let writes = 0
      const h = await harness([
        toolResponse('recall', 'memex_recall', { query: 'retry', intent: 'gap' }),
        toolResponse('failed-write', tool, writeArgs(tool)), textResponse('First answer'),
        toolResponse('successful-write', tool, writeArgs(tool)), textResponse('Second answer'),
      ], async args => args[0] === 'write' ? (++writes === 1 ? failed() : ok()) : ok(kernelText('memex_recall', fact)))
      await step(h.agent, writeback.prompt)
      expect(h.evidence().writeback).toEqual({ class: 'not-written', failedWrites: 1 })
      expect(reminders(h.events())).toHaveLength(0)
      expect(h.adapter.requests).toHaveLength(3)
      await step(h.agent, writeback.followUp!)
      const observed = h.evidence()
      const reminder = reminders(h.events())[0]!
      expect(reminders(h.events())).toHaveLength(1)
      expect(observed.writes.map(value => value.success)).toEqual([false, true])
      expect(observed.writes[0]!.at).toBeLessThan(reminder.time)
      expect(observed.writes[1]!.at).toBeGreaterThan(reminder.time)
      expect(observed.writeback).toEqual({ class: 'reminded', failedWrites: 1 })
      expect(h.adapter.requests).toHaveLength(5)
      expect(JSON.stringify(h.adapter.requests[3]!.messages)).toContain('Memex write reminder')
      const answers = h.events().filter(event => event.type === 'assistant/message')
      expect(answers.at(-1)!.data.message.content).toContainEqual({ type: 'text', text: 'Second answer' })
    })
  })

  it('does not retroactively relabel a successful write because of a later unknown intervention', async () => {
    const h = await harness([toolResponse('early-write', 'memex_retro', writeArgs('memex_retro')), textResponse(), textResponse()])
    await step(h.agent, writeback.prompt)
    expect(h.evidence().writeback).toEqual({ class: 'proactive', failedWrites: 0 })
    await step(h.agent, 'Please revise the memory card with this finding.')
    expect(h.evidence().writeback).toEqual({ class: 'proactive', failedWrites: 0 })
    expect(h.evidence().writes).toHaveLength(1)
  })

  it.each(['user', 'agent'] as const)('unknown %s intervention before a successful write remains unknown, not requested', async kind => {
    const h = await harness([textResponse('First answer'), toolResponse('write', 'memex_write', writeArgs('memex_write')), textResponse()])
    await step(h.agent, writeback.prompt)
    const text = 'Please revise the memory card with this finding.'
    if (kind === 'user') await step(h.agent, text)
    else {
      h.agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind } }))
      await step(h.agent, writeback.followUp!)
    }
    expect(h.events().some(event => event.type === 'user/message' && event.data.source.kind === kind && event.data.content.some(part => part.type === 'text' && part.text === text))).toBe(true)
    expect(h.evidence().writes[0]).toMatchObject({ success: true, targetCorrect: true })
    expect(h.evidence().writeback).toEqual({ class: 'unknown', failedWrites: 0 })
  })
})
