import { symbols, type Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { ensureDirectory } from './prepare-item.js'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { ScopeService } from '../scope/types.js'
import { createEvalBridge } from './host.js'
import { EvalLedger } from './ledger.js'
import { startHostEvalTracking } from './runtime-tracking.js'
import { createRegisteredRoundJudge } from './registered-judge.js'
import { createManagedRoundExecution } from './managed-round.js'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { resolve } from 'node:path'
import { buildOfflineReport } from './offline-report.js'

export interface HostEvalOptions {
  /** Live Host resolver; the judge parent route is verified against it, never reconstructed. */
  scopes?: Pick<ScopeService, 'resolve'>
  judgeCwd?: string
  timeoutMs?: number
  generation?: string
  /** Host-owned test seam; never accepted from an RPC payload. */
  home?: string
}

/**
 * Host-side eval bridge mounted on the existing authenticated memex channel.
 * The managed judge for a round is assembled lazily on its first judgement:
 * resource tracking is subscribed before the judge parent exists, and a
 * missing Host service fails closed before any session or model call.
 */
export function createHostEvalDispatch(ctx: Context, root = join(homedir(), '.dsh-memex-eval', 'selftest'), options: HostEvalOptions = {}) {
  const generation = options.generation ?? `host-${randomUUID()}`
  const timeoutMs = options.timeoutMs ?? 120_000
  const judgeCwd = options.judgeCwd ?? join(options.home ?? homedir(), '.dsh-memex-eval-runs', 'judge', 'repo')
  const registryFile = join(options.home ? join(options.home, '.dsh') : process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins', 'dsh-memex', 'eval-registry.ndjson')
  const rounds = new Map<string, Promise<{ judge: Awaited<ReturnType<typeof createRegisteredRoundJudge>>; settleJobs(): Promise<void> }>>()

  const managed = (round: string) => {
    let owned = rounds.get(round)
    if (!owned) {
      owned = (async () => {
        if (!options.scopes) throw new Error('Host scope resolver unavailable; no judge parent created')
        ensureDirectory(dirname(registryFile))
        ensureDirectory(judgeCwd)
        const ledger = new EvalLedger(join(root, round), registryFile)
        const tracking = startHostEvalTracking(ctx, ledger, generation, timeoutMs)
        const judge = await createRegisteredRoundJudge(ctx, root, round, judgeCwd, ledger, tracking, options.scopes, timeoutMs)
        return { judge, settleJobs: () => tracking.settleJobs() }
      })()
      rounds.set(round, owned)
    }
    return owned
  }

  const executions = new Map<string, ReturnType<typeof createManagedRoundExecution>>()
  const inputs = new Map<string, import('./managed-round.js').ManagedRoundInput>()
  const backends = new Map<string, { name: string; version: string; root: string; compression: string }>()
  const original = <T extends object>(value: T): T => (value as T & { [key: symbol]: T })[symbols.original] ?? value
  const routingPorts = new WeakMap<object, (operation: 'state' | 'setMode', payload: unknown) => Promise<unknown>>()
  const execute = async (plan: import('./round.js').FixedRound, signal: AbortSignal, resume: boolean) => {
    if (!options.scopes) throw new Error('Host scope resolver unavailable')
    const controller = ctx.get('sessionController') as SessionController | undefined
    const routing = ctx.get('autoModelRouting' as never) as { call(operation: 'state' | 'setMode', payload: unknown): Promise<unknown> } | undefined
    const persistence = ctx.get('sessionPersistence')
    const config = persistence && 'config' in persistence ? persistence.config as { root?: unknown; compression?: unknown } : undefined
    if (!controller || !routing || persistence?.name !== 'session-persistence-jsonl' || typeof config?.root !== 'string'
      || !['zstd', 'none'].includes(String(config.compression ?? 'zstd'))) throw new Error('Required eval Host controller/routing/evidence service unavailable')
    for (const name of ['agents', 'jobs', 'subagents', 'workspaceRegistry', 'agentPresets']) if (!ctx.get(name as never)) throw new Error(`Required eval Host ${name} service unavailable`)
    let routingPort = routingPorts.get(original(routing))
    if (!routingPort) { routingPort = routing.call.bind(routing); routingPorts.set(original(routing), routingPort) }
    const actualBackend = { name: persistence.name, version: '0.2.0-rc.2', root: resolve(config.root), compression: String(config.compression ?? 'zstd') }
    let backend = backends.get(plan.id)
    if (!backend) { backend = actualBackend; backends.set(plan.id, backend) }
    if (JSON.stringify(backend) !== JSON.stringify(actualBackend)) throw new Error('Host evidence backend changed; resume refused')
    let execution = executions.get(plan.id)
    if (!execution) {
      if (resume) throw new Error('Continuous same-Host execution unavailable; resume refused')
      execution = createManagedRoundExecution(ctx); executions.set(plan.id, execution)
    }
    const input = { root, round: plan.id, home: options.home ?? homedir(), generation, judgeCwd, timeoutMs, registryFile,
      scopes: options.scopes as ScopeService, controller, routing: routingPort, backend }
    let retained = inputs.get(plan.id)
    if (!retained) { retained = input; inputs.set(plan.id, retained) }
    if (original(retained.controller) !== original(controller) || retained.scopes !== options.scopes || retained.routing !== routingPort || retained.backend !== backend) throw new Error('Host execution services changed; resume refused')
    const outcomes = await (resume ? execution.resume(retained, signal) : execution.run(retained, signal))
    return { outcomes, evidenceComplete: buildOfflineReport(root, plan.id).exitCode === 0 }
  }
  const bridge = createEvalBridge({
    root,
    currentDefault: () => {
      const service = ctx.get('agentDefaultModel' as never) as { currentSelection(): unknown } | undefined
      if (!service) throw new Error('Default model service unavailable')
      return service.currentSelection()
    },
    run: (plan, signal) => execute(plan, signal, false),
    resume: (plan, signal) => execute(plan, signal, true),
    judge: async (plan, item, signal) => (await managed(plan.id)).judge.judge(plan, item, signal),
    cancel: async round => {
      const owned = rounds.get(round)
      if (!owned) return
      const { judge, settleJobs } = await owned
      await settleJobs()
      // A prior uncertain judgement keeps the parent for manual inspection.
      if (existsSync(join(root, round, 'unhealthy'))) throw new Error('Round unhealthy; judge parent preserved, release unproven')
      await judge.dispose()
    },
  })
  ctx.effect(() => () => bridge.dispose(), 'memex-eval: abort active work on unload')
  return (endpoint: string, payload: unknown, signal: AbortSignal) => bridge.dispatch(endpoint, payload, signal)
}
