import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-commands'
import { OptionsSchema, readOptions, type DshOpenSpecOptions } from './options.js'
import { getOfficialCatalog, getOfficialInitToolIds, resolveEffectiveSelection } from './upstream-compat.js'
import { registerWorkflowCommands } from './commands.js'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { createUpdateChecker } from './update-check.js'
import { createRoutingRegistry, createRoutingDispatcher } from './routing.js'
import { diagnoseSkillWinners } from './manage-check.js'
import { createGenerationBackedProvider } from './generation-provider.js'
import { closureIdentity } from './generation-closure.js'
import { materializeGeneration } from './generation-materializer.js'
import { managedInvocation } from './managed-invocation.js'
import { createManagementGuidance } from './manage-flow.js'
const manageSkill = { name: 'openspec-upgrade', description: 'Upgrade the managed official OpenSpec stack (adapter-defined)', body: createManagementGuidance() }
const approvedRoutingProviders: string[] = []

/**
 * Immutable generation identity. Besides the pinned release, selection and workflow ids it covers the
 * adapter-authored Skill body: that text is stored inside the generation, and the materializer refuses to
 * reuse an identity whose stored content differs. Hashing it here makes any wording change a new generation
 * (old ones are retained untouched) instead of an `generation-identity-collision` that stops the Host.
 */
function generationIdentity(version: string, fingerprint: string, workflowIds: string[], closure: string, telemetry: DshOpenSpecOptions['telemetry']): string {
  // The telemetry mode is part of the recorded managed invocation, so it must be part of the identity:
  // otherwise changing it would reuse an identity whose stored invocation differs (identity collision).
  // The resolved dependency closure is part of the identity as well: a generation holds a full copy of it,
  // so a real dependency change must select a new generation instead of colliding with the existing one.
  // Its fingerprint is host-path free (see generation-closure.ts), so reinstalling the same versions under
  // a different physical layout keeps both this identity and the bytes it names.
  return createHash('sha256').update(`${version}:${fingerprint}:${workflowIds.join(',')}:openspec-upgrade-v5:${createHash('sha256').update(manageSkill.body).digest('hex')}:closure=${closure}:telemetry=${telemetry}`).digest('hex').slice(0, 24)
}
import { createRegistryProvider } from './registry-provider.js'
import { prepareSessionManagement } from './session-management.js'
import { recoverGeneration } from './generations.js'
import { fileURLToPath } from 'node:url'
import { watchCatalogInvalidation } from './catalog-invalidation.js'
import { loadGeneration } from './generations.js'

export const name = 'dsh-openspec'
export const RoutingRegistryServiceName = 'openspec.routing'
export const activeRoutingProviderId = 'none'
const require = createRequire(import.meta.url)
const openspecEntry = require.resolve('@fission-ai/openspec')
const openspecRoot = dirname(dirname(openspecEntry))
const openspecPackage = JSON.parse(readFileSync(join(openspecRoot, 'package.json'), 'utf8'))
const openspecBin = join(openspecRoot, 'bin/openspec.js')

/**
 * Plugin Config. `updateCheck` and `telemetry` are the user options (DSH 0.2 persists them in the
 * profile patch and edits them through its settings form). The remaining fields are internal seams
 * used by tests and are never shown in a form.
 */
export const Config = OptionsSchema
export type Config = Partial<DshOpenSpecOptions> & { stateDir?: string; generationId?: string; selectedWorkflows?: string[]; allWorkflows?: boolean; initialDeployment?: boolean; officialConfigPath?: string }

/**
 * Stable, bounded diagnostic code for a failed startup contribution. Derived from the error's own code
 * or constructor name only: an error message can carry host paths or upstream text and is never used.
 */
function diagnosticCode(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code
  if (typeof code === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(code)) return code
  const name = (error as { name?: unknown } | undefined)?.name
  if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)) return name
  return 'unknown'
}

/**
 * Report a failed startup contribution exactly once. Every contribution is undone before this runs, so the
 * session surface stays absent (fail closed) — but the failure itself must be observable: a silent plugin
 * looks installed while contributing nothing. Reporting never escalates the failure into a Host-wide one.
 */
function reportStartupFailure(ctx: Context, error: unknown): void {
  const message = `dsh-openspec: startup contributions failed (${diagnosticCode(error)}); no Skills or commands were registered`
  try { ctx.logger?.error?.(message) } catch { /* a failed report must not become the failure */ }
}

/** Run contribution undos in reverse creation order; teardown is best effort and never throws. */
function undoContributions(undo: Array<() => void>): void {
  while (undo.length > 0) {
    const dispose = undo.pop()
    try { dispose?.() } catch { /* teardown is best effort */ }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  // DSH 0.2 has no settings registry: options come from this plugin's own Config row.
  const settings = readOptions(config)
  ctx.inject(['skills', 'commands'], async child => {
    // Every contribution registers its own undo, so a failure half-way through neither leaves a partial
    // surface registered nor stays invisible. The latch is set before any undo runs, on both paths.
    const lifecycle = { disposed: false }
    const undo: Array<() => void> = []
    try {
      await contribute(child, config, settings, undo, lifecycle)
    } catch (error) {
      lifecycle.disposed = true
      undoContributions(undo)
      reportStartupFailure(ctx, error)
    }
  })
}

async function contribute(child: Context, config: Config, settings: DshOpenSpecOptions, undo: Array<() => void>, lifecycle: { disposed: boolean }): Promise<void> {
  const version = openspecPackage.version as string
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const stateDir = config.stateDir ?? join(dshHome, 'plugins', 'dsh-openspec')
  // Host registers read-only guidance only. Source/npm/project mutations live exclusively in the session Bash updater.
  const updater = fileURLToPath(new URL('./session-updater.js', import.meta.url))
  const routingRegistry = createRoutingRegistry(activeRoutingProviderId)
  const routingDispatcher = createRoutingDispatcher()
  undo.push(() => routingRegistry.dispose())
  // Extensions may only register a provider. Dispatch and disposal stay private so the dispatcher
  // (tokens, feature/candidate validation, authority) is the single route to a provider callback.
  undo.push(child.provide(RoutingRegistryServiceName, { register: routingRegistry.register }))
  undo.push(child.provide('openspec.routing.dispatch', (request: Parameters<typeof routingDispatcher.dispatch>[1]) => routingDispatcher.dispatch(routingRegistry, request)))

  const selected = await resolveEffectiveSelection({ configPath: config.officialConfigPath, workflows: config.selectedWorkflows })
  const entries = await getOfficialCatalog({ workflowIds: selected.workflows, delivery: selected.delivery })
  const chosen = entries
  const generationSkillsData = [...chosen.map(entry => ({ name: entry.skillName, description: `Official OpenSpec ${entry.workflowId} workflow`, body: entry.body })), manageSkill]
  const closure = await closureIdentity(openspecRoot)
  const generationId = config.generationId ?? generationIdentity(version, selected.fingerprint, chosen.map(entry => entry.workflowId), closure, settings.telemetry)
  const invocation = managedInvocation({ node: process.execPath, cli: join(dshHome, 'plugins', 'dsh-openspec', 'generations', generationId, 'bin', 'openspec.js'), telemetry: settings.telemetry })
  const recoveryPending = async () => (await recoverGeneration(dshHome).catch(() => ({ state: 'recovery-required' as const }))).state === 'recovery-required'
  if (config.initialDeployment !== false && !await recoveryPending()) {
    await materializeGeneration({
      home: dshHome, id: generationId, sourceRoot: openspecRoot, version,
      skills: generationSkillsData,
      invocation,
      selectionFingerprint: selected.fingerprint,
      delivery: selected.delivery,
    })
  }
  // Materialization may have selected a newer pin; during recovery the previous
  // immutable active generation is intentionally retained. Report that actual selection.
  const initialState = await loadGeneration(dshHome)
  const installedVersion = typeof initialState.version === 'string' ? initialState.version : version
  const updateChecker = createUpdateChecker({ stateDir, installed: installedVersion, enabled: settings.updateCheck === 'enabled' })
  const liveScopes = new WeakSet<object>()
  let scopeRoot: any
  const generationsProvider = createGenerationBackedProvider({
    home: dshHome, telemetry: settings.telemetry, updateCheck: settings.updateCheck,
    isScopeLive: scope => liveScopes.has(scope),
    onGeneration: id => { void scopeRoot?.set('dsh-openspec:generation', id) },
    check: async () => {
      const result = await updateChecker.check()
      return result.state === 'newer' && result.available ? { installed: result.installed, available: result.available, managementEntry: 'openspec-upgrade' } : undefined
    },
  })
  let activeSurface = { entries: chosen.filter(entry => (initialState.skills as any[]).some(skill => skill.name === entry.skillName)),  generation: initialState.id, invocation: String(initialState.invocation), delivery: String(initialState.delivery ?? selected.delivery) }
  let fingerprint = selected.fingerprint
  let refreshFlight: Promise<void> | undefined
  let invalidate = () => {}
  let commands = () => {}
  const refreshSurface = async (): Promise<void> => {
    if (lifecycle.disposed) return
    if (refreshFlight) return refreshFlight
    refreshFlight = (async () => {
      if (await recoveryPending()) return
      const nextSelection = await resolveEffectiveSelection({ configPath: config.officialConfigPath, workflows: config.selectedWorkflows })
      if (lifecycle.disposed || nextSelection.fingerprint === fingerprint) return
      const nextEntries = await getOfficialCatalog({ workflowIds: nextSelection.workflows, delivery: nextSelection.delivery })
      const nextClosure = await closureIdentity(openspecRoot)
      const nextId = generationIdentity(version, nextSelection.fingerprint, nextEntries.map(entry => entry.workflowId), nextClosure, settings.telemetry)
      const nextInvocation = managedInvocation({ node: process.execPath, cli: join(dshHome, 'plugins', 'dsh-openspec', 'generations', nextId, 'bin', 'openspec.js'), telemetry: settings.telemetry })
      if (lifecycle.disposed) return
      await materializeGeneration({ home: dshHome, id: nextId, sourceRoot: openspecRoot, version, skills: [...nextEntries.map(entry => ({ name: entry.skillName, description: `Official OpenSpec ${entry.workflowId} workflow`, body: entry.body })), manageSkill], invocation: nextInvocation, selectionFingerprint: nextSelection.fingerprint, delivery: nextSelection.delivery, canActivate: () => !lifecycle.disposed })
      if (lifecycle.disposed) return
      activeSurface = { entries: nextEntries, generation: nextId, invocation: nextInvocation, delivery: nextSelection.delivery }
      fingerprint = nextSelection.fingerprint
      commands()
      commands = registerCommands()
      invalidate()
    })()
    try { await refreshFlight } finally { refreshFlight = undefined }
  }
  const catalogMonitor = watchCatalogInvalidation({
    configPath: config.officialConfigPath ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'openspec/config.json'),
    invalidate: refreshSurface,
    intervalMs: 30_000,
  })
  undo.push(() => catalogMonitor.dispose())
  scopeRoot = child
  const registration = child.skills.registerProvider(control => {
    invalidate = control.invalidate
    return createRegistryProvider(generationsProvider as any, { beforeList: refreshSurface, beforeGet: refreshSurface }) as any
  })
  undo.push(registration)
  const registerCommands = () => registerWorkflowCommands(child, {
    entries: activeSurface.delivery === 'skills' ? [] : activeSurface.entries, generation: activeSurface.generation, invocation: activeSurface.invocation,
    telemetry: settings.telemetry, updateCheck: settings.updateCheck,
    consumeWorkflow: async (skillName, scope) => {
      await refreshSurface()
      if (lifecycle.disposed || activeSurface.delivery === 'skills' || !activeSurface.entries.some(entry => entry.skillName === skillName)) return undefined
      return (await generationsProvider.get({ name: skillName }, { scope }))?.content
    },
    initInstruction: 'Initialize OpenSpec using the official CLI in this workspace.',
    initToolIds: getOfficialInitToolIds,
    hasOpenSpecDir: async cwd => await import('node:fs/promises').then(fs => fs.stat(join(cwd, 'openspec')).then(info => info.isDirectory()).catch(() => false)),
    manageInstruction: createManagementGuidance(),
    onGeneration: refreshSurface,
    generationState: async () => {
      const state = await loadGeneration(dshHome)
      return { id: state.id, invocation: String(state.invocation) }
    },
    checkManagedVersion: async () => {
      const state = await loadGeneration(dshHome)
      return typeof state.version === 'string' ? state.version : undefined
    },
    checkPathVersion: async () => {
      const { spawnSync } = await import('node:child_process')
      const result = spawnSync('openspec', ['--version'], { encoding: 'utf8', timeout: 2_000, env: process.env })
      if (result.status !== 0) return null
      return `${result.stdout}${result.stderr}`.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] ?? null
    },
    recoveryState: async () => (await recoverGeneration(dshHome)).state === 'recovery-required' ? 'recovery-required' : 'none',
    managedVersion: version,
    checkCommand: async () => JSON.stringify(await updateChecker.check({ explicit: true })),
    prepareManagement: (intent, cwd) => prepareSessionManagement({ home: dshHome, cwd, node: process.execPath, updater, intent, telemetry: settings.telemetry }),
    skillDiagnostics: caller => diagnoseSkillWinners(child.skills, [...activeSurface.entries.map(entry => entry.skillName), manageSkill.name], caller),
    // Read-only probe of `node` as resolved by PATH from the caller's workspace; this is the node the managed
    // invocation's Bash uses when it is not given an absolute path, and may differ from the Host's node.
    checkBashNodeVersion: async cwd => {
      const { spawnSync } = await import('node:child_process')
      const result = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 2_000, ...(cwd ? { cwd } : {}), env: process.env })
      return result.status === 0 ? result.stdout.trim().replace(/^v/, '') || null : null
    },
  })
  commands = registerCommands()
  undo.push(() => commands())
  // 0.2 listeners must return undefined; Set.add/delete return values are not part of the contract.
  child.on('agent/created', ({ agent }) => { liveScopes.add(agent); return undefined })
  child.on('agent/disposed', ({ agent }) => { liveScopes.delete(agent); return undefined })
  // The latch is set before the contributions it guards are undone, on this path and on the failure path.
  child.effect(() => () => { lifecycle.disposed = true; undoContributions(undo) }, 'dsh-openspec: contributions')
}
