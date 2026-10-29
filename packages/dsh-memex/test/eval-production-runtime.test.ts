import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context as HostContext } from '@deepseek-ai/cordis'
import { createHostEvalDispatch } from '../src/eval/host-plugin.js'
import { buildOfflineReport } from '../src/eval/offline-report.js'
import { readFrozenInput } from '../src/eval/freeze.js'
import { EvalLedger } from '../src/eval/ledger.js'
import { installTestedBudget } from '../src/eval/tested-budget.js'
import { controllerExecutionPort } from '../src/eval/controller.js'
import { createScopeResolver } from '../src/scope/resolver.js'
import type { FixedRound } from '../src/eval/round.js'

// Forward to real compat exports, not a mock implementation: the loop-request
// WeakSet is package-private, so the production boundary must share its LLM copy.
vi.mock('@deepseek-ai/dsh-llm', async () => {
  const { createRequire } = await import('node:module')
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  const graph = createRequire(fileURLToPath(new URL('../../dsh-pet/compat/subagent/.launcher/package.json', import.meta.url)))
  return import(/* @vite-ignore */ pathToFileURL(graph.resolve('@deepseek-ai/dsh-llm')).href)
})

const graph = createRequire(fileURLToPath(new URL('../../dsh-pet/compat/subagent/.launcher/package.json', import.meta.url)))
const load = (name: string): Promise<any> => import(/* @vite-ignore */ pathToFileURL(graph.resolve(name)).href)

it('production Host dispatch runs six real top-level conditions, eight turns and twelve owned judges completely offline', async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'memex-production-runtime-'))
  const root = join(home, '.dsh-memex-eval', 'selftest')
  const dshHome = join(home, '.dsh')
  const runRoot = join(home, '.dsh-memex-eval-runs')
  vi.stubEnv('DSH_HOME', dshHome)
  // A local adapter is the only provider registered; unexpected network use is
  // a test failure, not a silent trip through the developer's subscriptions.
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Offline test forbids network') })
  const [cordis, llm, agents, loop, sessions, projections, prompt, tools, subagents, spawn, loader,
    presets, native, defaults, jobs, storage, sqlite, domain, persistence, workspace, query, typert, controller, titles, titleProvider, fs, fsTools, delegation] = await Promise.all([
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-subagent-spawn-in-process', '@deepseek-ai/cordis-plugin-loader',
    '@deepseek-ai/dsh-agent-preset-registry', '@deepseek-ai/dsh-agent-tool-presentation', '@deepseek-ai/dsh-agent-default-model',
    '@deepseek-ai/dsh-jobs-local', '@deepseek-ai/dsh-storage', '@deepseek-ai/dsh-storage-sqlite', '@deepseek-ai/dsh-storage-domain',
    '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-workspace', '@deepseek-ai/dsh-session-query',
    '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-session-title',
    '@deepseek-ai/dsh-session-title-first-prompt-llm', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-subagent',
  ].map(load))
  const ctx = new cordis.Context() as HostContext & Record<string, any>
  const install = async (module: any, config?: any) => { await ctx.plugin(module.default ?? module, config) }
  const calls: GenerateOptions[] = []
  const released = new Set<string>()
  const ownedJobs = new Map<string, string>()
  const created: any[] = []
  let finishUnowned: (() => void) | undefined
  let detachController: (() => void) | undefined
  try {
    expect(graph.resolve('@deepseek-ai/dsh-api-session-controller')).toContain('/compat-packages/session-controller/')
    expect(graph.resolve('@deepseek-ai/dsh-agent-loop')).toContain('/compat-packages/agent-loop/')
    expect(graph.resolve('@deepseek-ai/dsh-subagent')).toContain('/compat-packages/subagent/')
    await install(llm); await install(storage); await install(sqlite, { path: ':memory:' }); await install(domain, { backend: 'sqlite' })
    await install(persistence, { root: join(dshHome, 'sessions'), compression: 'zstd' })
    await install(sessions); await install(projections); await install(prompt, { persona: '' }); await install(tools)
    await install(agents); await install(loop, { agents: [] }); await install(subagents); await install(spawn, { providerName: 'spawn' })
    await install(jobs, {}); detachController = ctx.jobs.attachController('offline-selftest-producer')
    await install(workspace); await install(query); await install(typert); await install(fs, { cwd: home })
    await install(loader)
    await install(defaults, { provider: 'offline', model: 'tested' })
    await install(await load('@deepseek-ai/dsh-tool-subagent/model-selection-settings'), { enabled: false, allowedModels: [] })
    await install(presets, { default: 'standard' })
    ctx.loader.builtins['offline-native'] = native
    ctx.loader.builtins['offline-fs'] = fsTools
    ctx.loader.builtins['offline-delegation'] = delegation
    // Fixture standard composition uses real native/fs/delegation plugins. It
    // deliberately omits AGENTS/skill loaders, which could read the real home;
    // this test covers Host/preset lifecycle, not the full shipped coding roster.
    await ctx.agentPresets.register({ id: 'standard', plugins: [
      { name: 'cordis:offline-native', config: { mode: 'native' } },
      { name: 'cordis:offline-fs' },
      { name: 'cordis:offline-delegation', config: { provider: 'spawn', modelSelectionSettings: true, backgroundMode: 'continuable' } },
    ] })
    await ctx.agentPresets.register({ id: 'memex-eval-judge', plugins: [{ name: 'cordis:offline-native', config: { mode: 'native' } }] })
    // Text-only upload admission is unrelated to eval control. Reject every
    // non-text capability instead of fabricating SessionController behavior.
    let admissionWait: Promise<void> | undefined, admissionEntered: (() => void) | undefined
    ctx.provide('attachments', {
      imageLimits: { maxImageBytes: 1000, maxImagesPerMessage: 1, maxMessageImageBytes: 1000, maxImagePixels: 1000, maxImageDimension: 100, mediaTypes: ['image/png'] },
      admitPromptContent: async (content: any[]) => { expect(content.every(part => part.type === 'text')).toBe(true); admissionEntered?.(); if (admissionWait) await admissionWait; return content },
    } as never)
    ctx.provide('fileUploads', {
      registerAgentResolver: () => () => {},
      bindPrompt: (_agent: unknown, receipts: unknown[]) => { expect(receipts).toEqual([]); return { commit() {}, [Symbol.dispose]() {} } },
      resolve: () => { throw new Error('File uploads outside offline fixture') },
      retirePrompt() {},
    } as never)
    await install(titles, { fallbackMaxWords: 8, fallbackMaxBytes: 64, maxTitleBytes: 72 })
    const titleFiber = ctx.plugin(titleProvider, { provider: 'offline', model: 'title', targetWords: 4, targetCjkCharacters: 8, maxInputBytes: 4000, maxOutputTokens: 100, timeoutMs: 1000 })
    await titleFiber
    // Match the live Host's optional Team listeners. Loading this composition
    // creates no teammates; it exercises one-shot child tool/prompt isolation.
    await install(await load('@deepseek-ai/dsh-experimental-agent-team'))
    await install(await load('@deepseek-ai/dsh-experimental-tool-agent-team'))
    // Global Host instructions must not enter a fixed judge's system prompt.
    ctx.systemPrompt.section({ name: 'offline-host-global', order: 50, text: 'GLOBAL HOST: MCP, GUI and model identity instructions' })
    ctx.systemPrompt.context({ name: 'offline-host-runtime', order: 50, text: 'GLOBAL HOST sandbox policy' })
    await install(await load('@deepseek-ai/dsh-time-context'), { timeZone: 'UTC', refreshIntervalMs: 600000 })
    await install(controller, { nativeOpen: false })
    expect(ctx.sessionController).toBeInstanceOf(controller.SessionController)
    const modes = new Map<string, string>(), routingCalls: [string, any][] = []
    // Narrow conservative service fixture: proves MANUAL acknowledgement and
    // readback ordering; it does not claim to exercise AUTO's routing algorithm.
    ctx.provide('autoModelRouting', { call: async (operation: string, payload: any) => {
      routingCalls.push([operation, payload])
      expect(ctx.agents.get(payload.sessionId)).toBeDefined()
      if (operation === 'setMode') { expect(payload.mode).toBe('MANUAL'); modes.set(payload.sessionId, payload.mode) }
      else expect(operation).toBe('state')
      return { mode: modes.get(payload.sessionId) ?? 'AUTO' }
    } } as never)
    // Internal judge spawn is not an official routing-tool creation. An AUTO
    // ordinary ancestor must be rejected before the child can issue a request.
    ctx.on('agent/pre-step', ({ agent }, next) => {
      let parent = agent.session.header.parentSession
      if (!parent) return next()
      let root = ctx.agents.get(parent)
      while (root?.session.header.parentSession) root = ctx.agents.get(root.session.header.parentSession)
      if (root && modes.get(root.id) !== 'MANUAL') throw new Error('Internal judge parent must be MANUAL before spawn')
      return next()
    })
    ctx.on('agent/created', ({ agent }) => {
      created.push(agent)
      if (agent.session.header.origin === 'subagent') {
        // Creation precedes the first-step descriptor: this is the regression window.
        expect(agent.session.snapshotEvents().some(event => event.type === 'subagent/descriptor')).toBe(false)
        expect(ctx.agentTeams.tryMembership(agent)).toBeUndefined()
      } else if (!agent.session.header.parentSession) {
        expect(ctx.agentTeams.tryMembership(agent)?.role).toBe('lead')
      }
      return undefined
    })
    const rootAgentsForBudget: any[] = []
    const answer = 'Current config.json: retryLimit is 4; leaseSeconds is 45; 20 seconds is below 45 seconds; the previous 15-second statement is stale.'
    class LocalFixedModel extends llm.LlmAdapter {
      async listModels(provider: string) { return ['tested', 'judge', 'title'].map(id => ({ provider, id, name: id, ...(id === 'title' ? {} : { reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }) })) }
      async resolveModel(provider: string, model: string) { return (await this.listModels(provider)).find(value => value.id === model)! }
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls.push(options)
        expect(options.provider).toBe('offline')
        let text = answer
        if (options.sessionId === 'offline-budget-control') {
          yield* toolResponse('read', { file_path: join(rootAgentsForBudget[0]!.session.header.cwd!, 'config.json') })
          return
        }
        if (options.purpose === 'session-title') text = 'Daily control title'
        else if (options.model === 'judge') {
          expect(options.tools?.map(tool => tool.name)).toEqual(['structured_output'])
          const packets = options.messages.flatMap(message => message.content).filter(part => part.type === 'text').flatMap(part => {
            try { const value = JSON.parse((part as { text: string }).text); return value.protocol === 'judge-v1' ? [value] : [] } catch { return [] }
          })
          expect(packets).toHaveLength(1)
          const source = packets[0].evidence.find((value: any) => value.text.includes('Current config.json'))
          expect(source).toBeDefined()
          yield* toolResponse('structured_output', { verdict: 'yes', reason: 'Fixed local protocol checks answer provenance only', quotes: [{ source: source.id, quote: source.text }] })
          return
        } else {
          const agent = ctx.agents.get(options.sessionId!)!
          expect(agent.session.header.parentSession).toBeUndefined()
          if (agent.session.header.cwd?.startsWith(runRoot)) {
            expect(modes.get(agent.id)).toBe('MANUAL')
            const events = agent.session.snapshotEvents()
            expect(events.find(event => event.type === 'session/title')?.data).toMatchObject({ title: expect.stringContaining('Memex selftest '), source: { kind: 'user' } })
            if (!ownedJobs.has(agent.id)) {
              let done!: (outcome: { status: 'killed' }) => void
              const completion = new Promise<{ status: 'killed' }>(resolve => { done = resolve })
              const id = ctx.jobs.start({ owner: agent.id, kind: 'bash', label: 'local fixture release proof', run: () => ({ done: completion,
                cancel: () => { released.add(agent.id); done({ status: 'killed' }) } }) })
              ownedJobs.set(agent.id, id)
              expect(options.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(['read', 'subagent']))
              yield* toolResponse('read', { file_path: join(agent.session.header.cwd!, 'config.json') })
              return
            }
          }
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    function* toolResponse(name: string, value: unknown): Generator<StreamChunk> {
      const args = JSON.stringify(value), id = llm.ToolCallId(`offline-call-${calls.length}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    ctx.llm.registerAdapter(['offline'], new LocalFixedModel())
    const unownedDone = new Promise<{ status: 'completed' }>(resolve => { finishUnowned = () => resolve({ status: 'completed' }) })
    const unownedJob = ctx.jobs.start({ kind: 'bash', label: 'unowned isolation control', run: () => ({ done: unownedDone, cancel: () => { throw new Error('Unowned control must not be cancelled') } }) })
    const scopes = createScopeResolver({ homeDir: home, config: { workspaces: [
      { path: runRoot, fallback: false }, { path: join(runRoot, 'nomem'), memory: false }, { path: join(runRoot, 'judge'), memory: false },
    ] } })
    let dispatch!: ReturnType<typeof createHostEvalDispatch>
    // Production mounts Memex under an injected plugin fiber, not the root Context.
    // Undeclared direct service properties throw there even while ctx.get works.
    await ctx.plugin({ name: 'offline-memex-owner', inject: ['tools'], apply(owner: HostContext) {
      expect(() => owner.agents).toThrow(/without inject/)
      expect(owner.get('agents')).toBeDefined()
      dispatch = createHostEvalDispatch(owner, root, { home, scopes, generation: 'offline-host-1', timeoutMs: 5000 })
    } })
    expect(dispatch).toBeTypeOf('function')
    const signal = new AbortController().signal
    const plan = await dispatch('eval/registerRound', { version: 'selftest-v1', tested: { provider: 'offline', model: 'tested', effort: 'high' }, judge: { provider: 'offline', model: 'judge', effort: 'high' }, maxJudgeCalls: 12 }, signal) as FixedRound
    expect(plan.items).toHaveLength(6)
    const result = await dispatch('eval/runRound', { round: plan.id, requestId: 'complete-offline-round' }, signal)
    expect((result as { evidenceComplete: boolean }).evidenceComplete).toBe(true)
    expect(Object.keys((result as { outcomes: object }).outcomes)).toEqual(plan.items.map(item => item.id))
    const ledger = new EvalLedger(join(root, plan.id))
    const identities = ledger.read()
    const roots = identities.filter(entry => entry.kind === 'reserved' && entry.question !== 'judge')
    const parent = identities.filter(entry => entry.kind === 'reserved' && entry.question === 'judge')
    expect(roots).toHaveLength(6); expect(parent).toHaveLength(1)
    const retirements = readdirSync(join(root, plan.id)).filter(name => name.startsWith('retirement-'))
      .map(name => readFrozenInput(join(root, plan.id, name)) as { version: number; root: string; observed: string[] })
    expect(retirements).toHaveLength(6)
    expect(retirements.map(receipt => receipt.root).sort()).toEqual(roots.map(entry => entry.id).sort())
    expect(retirements.every(receipt => receipt.version === 1 && receipt.observed.includes('inbox-empty'))).toBe(true)
    expect(identities.filter(entry => entry.kind === 'child')).toHaveLength(12)
    const rootAgents = roots.map(entry => ctx.agents.get(entry.id)!)
    expect(rootAgents.every(Boolean)).toBe(true) // archive is not dispose
    expect(rootAgents.flatMap(agent => agent.session.snapshotEvents().filter(event => event.type === 'turn/end'))).toHaveLength(8)
    expect(new Set(rootAgents.map(agent => agent.session.header.cwd)).size).toBe(6)
    expect(calls.filter(call => call.model === 'judge')).toHaveLength(12)
    expect(calls.filter(call => call.model === 'tested')).toHaveLength(14) // eight answers plus six real file reads
    expect(calls.filter(call => call.purpose === 'session-title')).toHaveLength(0)
    expect(released.size).toBe(6)
    expect(routingCalls.filter(([operation, payload]) => operation === 'setMode' && roots.some(root => root.id === payload.sessionId))).toHaveLength(6)
    expect(routingCalls.filter(([operation, payload]) => operation === 'setMode' && payload.sessionId === parent[0]!.id)).toHaveLength(12)
    for (const agent of rootAgents) {
      expect(ctx.workspaceRegistry.archivedSessionIds).toContain(agent.id)
      expect(agent.status).toBe('idle')
      expect(agent.inbox.nextStep.length + agent.inbox.nextTurn.length).toBe(0)
      expect(await ctx.sessionPersistence.stat(agent.id)).toBeDefined()
      const fileReads = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
      expect(fileReads).toHaveLength(1)
      expect(fileReads[0]!.data.message.isError).not.toBe(true)
      expect(ledger.releaseHistory('offline-host-1').filter(event => event.id === ownedJobs.get(agent.id)).map(event => event.type)).toEqual(['registered', 'settled'])
    }
    for (const agent of created.filter(agent => agent.session.header.parentSession || agent.id === parent[0]!.id)) expect(ctx.agents.get(agent.id)).toBeUndefined()
    expect(ctx.agents.list()).toHaveLength(6)
    expect(ctx.jobs.get(unownedJob).status).toBe('running')
    const beforeReplay = calls.length
    expect(await dispatch('eval/runRound', { round: plan.id, requestId: 'complete-offline-round' }, signal)).toEqual(result)
    expect(calls).toHaveLength(beforeReplay)
    for (const item of plan.items) {
      const attempt = readFrozenInput(join(root, plan.id, item.id, 'attempt')) as any
      expect(attempt.attempt.cwd.startsWith(`${home}/`)).toBe(true)
      expect(readFrozenInput(join(root, plan.id, item.id, 'execution-audit'))).toMatchObject({ status: 'valid' })
    }
    const publicRegistry = readFileSync(join(dshHome, 'plugins', 'dsh-memex', 'eval-registry.ndjson'), 'utf8')
    expect(publicRegistry).not.toContain('session-')
    expect(publicRegistry).not.toContain(answer)
    const publicRecords = publicRegistry.trim().split('\n').map(line => JSON.parse(line))
    expect(new Set(publicRecords.map(record => record.sessionHash)).size).toBe(19) // six roots, one parent, twelve judges
    expect(publicRecords.every(record => record.round === plan.id)).toBe(true)
    const snapshotTree = (path: string): unknown => readdirSync(path).sort().map(name => {
      const child = join(path, name), stat = statSync(child)
      return stat.isDirectory() ? [name, snapshotTree(child)] : [name, stat.size, stat.mtimeMs, readFileSync(child).toString('base64')]
    })
    const beforeReport = snapshotTree(root)
    const report = buildOfflineReport(root, plan.id)
    expect(report.exitCode).toBe(0) // no retrieval/write is an observed fail, not missing evidence
    expect(report.markdown).toContain('未校准')
    for (const item of plan.items) expect(report.markdown).toContain(item.id)
    expect(buildOfflineReport(root, plan.id)).toEqual(report)
    expect(snapshotTree(root)).toEqual(beforeReport)
    expect(calls).toHaveLength(beforeReplay)
    // Exercise the real Controller-installed archive pre-step gate after retire.
    rootAgents[0]!.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'must stay archived' }], source: { kind: 'user' } }))
    await rootAgents[0]!.whenIdle()
    expect(calls).toHaveLength(beforeReplay)
    rootAgents[0]!.cancel({ kind: 'user' }); await rootAgents[0]!.whenIdle()
    const daily = await ctx.sessionController.create({ sessionId: sessions.SessionId('offline-daily-control'), cwd: join(home, 'daily'), agentPreset: 'standard' })
    await ctx.sessionController.prompt({ sessionId: daily.sessionId, requestId: 'daily-control', mode: 'queue', content: [{ type: 'text', text: 'ordinary control' }] }, signal)
    await ctx.agents.get(daily.sessionId)!.whenIdle()
    await titleFiber.dispose()
    expect(calls.filter(call => call.purpose === 'session-title')).toHaveLength(1)
    expect(ctx.workspaceRegistry.archivedSessionIds).not.toContain(daily.sessionId)
    // Abort during the real controller's awaited attachment admission: a cancel
    // before followup must not allow the late queued prompt to reach the adapter.
    const racing = await ctx.sessionController.create({ sessionId: sessions.SessionId('offline-abort-admission'), cwd: join(home, 'abort'), agentPreset: 'standard' })
    const raceAgent = ctx.agents.get(racing.sessionId)!
    ctx.sessionTitle.rename(raceAgent.session, 'Memex selftest admission-race')
    await ctx.sessionController.selectModel({ sessionId: racing.sessionId, provider: 'offline', model: 'tested' })
    let release!: () => void
    admissionWait = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { admissionEntered = resolve })
    const carrier = new AbortController()
    const gate = installTestedBudget(ctx, { read: () => [] } as never, racing.sessionId, carrier.signal)
    const receipts = join(home, 'race-receipts'); mkdirSync(receipts)
    const port = controllerExecutionPort(ctx.sessionController, async () => ({ mode: 'MANUAL' }), join(home, 'abort'), gate.signal, receipts)
    const beforeRace = calls.length
    const race = port.prompt(racing.sessionId, 'late admitted text').catch(error => error)
    await entered; carrier.abort(); release()
    expect(await race).toMatchObject({ message: expect.stringMatching(/abort/) })
    expect(calls).toHaveLength(beforeRace)
    expect(raceAgent.status).toBe('idle')
    gate.dispose(); admissionWait = undefined; admissionEntered = undefined
    rootAgentsForBudget.push(rootAgents[0])
    const looping = await ctx.sessionController.create({ sessionId: sessions.SessionId('offline-budget-control'), cwd: join(home, 'budget'), agentPreset: 'standard' })
    const loopAgent = ctx.agents.get(looping.sessionId)!
    ctx.sessionTitle.rename(loopAgent.session, 'Memex selftest budget-control')
    await ctx.sessionController.selectModel({ sessionId: looping.sessionId, provider: 'offline', model: 'tested' })
    const budgetGate = installTestedBudget(ctx, { read: () => [] } as never, looping.sessionId, signal, { maxRequestsPerCondition: 2, maxDurationMsPerCondition: 5000 })
    const loopReceipts = join(home, 'loop-receipts'); mkdirSync(loopReceipts)
    const loopPort = controllerExecutionPort(ctx.sessionController, async () => ({ mode: 'MANUAL' }), join(home, 'budget'), budgetGate.signal, loopReceipts)
    const beforeLoop = calls.length
    const loopResult = await loopPort.prompt(looping.sessionId, 'continue using read').catch(error => error)
    expect(loopResult).toMatchObject({ message: expect.stringMatching(/abort/) })
    expect(calls.length - beforeLoop).toBe(2)
    expect(loopAgent.status).toBe('idle')
    budgetGate.dispose()
    // A real retired condition fails its physical collection checkpoint. Explicit
    // same-Host resume must keep the completed pair result and old attempt, and
    // create one new ordinary session instead of replaying any judge submission.
    await dispatch('eval/confirmDefaultReview', { round: plan.id, confirmation: 'I REVIEWED THE DEFAULT MODEL' }, signal)
    const resumePlan = await dispatch('eval/registerRound', { version: 'selftest-v1', tested: { provider: 'offline', model: 'tested', effort: 'high' }, judge: { provider: 'offline', model: 'judge', effort: 'high' }, maxJudgeCalls: 12 }, signal) as FixedRound
    const realFlush = ctx.sessions.flush.bind(ctx.sessions)
    let checkpoints = 0
    const checkpoint = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async session => {
      if (!session.header.parentSession && session.header.cwd?.startsWith(runRoot) && ++checkpoints === 2) throw new Error('offline checkpoint unavailable once')
      return realFlush(session)
    })
    const judgesBeforeResumeRound = calls.filter(call => call.model === 'judge').length
    await expect(dispatch('eval/runRound', { round: resumePlan.id, requestId: 'retryable-collection' }, signal)).rejects.toThrow(/checkpoint/)
    checkpoint.mockRestore()
    const retryLedger = new EvalLedger(join(root, resumePlan.id))
    const oldRoots = retryLedger.read().filter(e => e.kind === 'reserved' && e.question !== 'judge')
    expect(oldRoots).toHaveLength(2)
    const oldCwd = ctx.agents.get(oldRoots[1]!.id)!.session.header.cwd
    const resumed = await dispatch('eval/resumeRound', { round: resumePlan.id, requestId: 'explicit-safe-resume' }, signal) as { evidenceComplete: boolean }
    expect(resumed.evidenceComplete).toBe(true)
    const retryRoots = retryLedger.read().filter(e => e.kind === 'reserved' && e.question !== 'judge')
    expect(retryRoots).toHaveLength(7)
    expect(new Set(retryRoots.map(e => ctx.agents.get(e.id)!.session.header.cwd)).size).toBe(7)
    expect(ctx.agents.get(oldRoots[1]!.id)!.session.header.cwd).toBe(oldCwd)
    expect(calls.filter(call => call.model === 'judge').length - judgesBeforeResumeRound).toBe(12)
    expect(readdirSync(join(root, resumePlan.id, 'history'))).toHaveLength(1)
    expect(buildOfflineReport(root, resumePlan.id).exitCode).toBe(0)
    expect(network).not.toHaveBeenCalled()
  } catch (error) {
    // Preserve the actual isolated scene on failure rather than swapping in a
    // handwritten controller or weakening the production completion assertions.
    throw new Error(`Real compat eval failed; isolated evidence retained at ${home}`, { cause: error })
  } finally {
    finishUnowned?.()
    detachController?.()
    try { await ctx.fiber.dispose() }
    finally { network.mockRestore(); vi.unstubAllEnvs() }
  }
}, 30_000)
