import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-commands'
import { registerDshOpenSpecSettings } from './options.js'
import { getOfficialCatalog, resolveEffectiveSelection } from './upstream-compat.js'
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
import { materializeGeneration } from './generation-materializer.js'
import { managedInvocation } from './managed-invocation.js'
import { createManagementGuidance } from './manage-flow.js'
const manageSkill = { name: 'openspec-upgrade', description: 'Upgrade the managed official OpenSpec stack (adapter-defined)', body: createManagementGuidance() }
const approvedRoutingProviders: string[] = []
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

export type Config = { stateDir?: string; generationId?: string; selectedWorkflows?: string[]; allWorkflows?: boolean; initialDeployment?: boolean; officialConfigPath?: string }
export function apply(ctx: Context, config: Config = {}): void {
  ctx.inject(['skills', 'settings', 'commands'], async child => {
    const settings = registerDshOpenSpecSettings(child).get()
    const version = openspecPackage.version as string
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const stateDir = config.stateDir ?? join(dshHome, 'plugins', 'dsh-openspec')
    // Host registers read-only guidance only. Source/npm/project mutations live exclusively in the session Bash updater.
    const updater = fileURLToPath(new URL('./session-updater.js', import.meta.url))
    const routingRegistry = createRoutingRegistry(activeRoutingProviderId)
    const routingDispatcher = createRoutingDispatcher()
    child.provide(RoutingRegistryServiceName, routingRegistry)
    child.provide('openspec.routing.dispatch', (request: Parameters<typeof routingRegistry.dispatch>[0]) => routingDispatcher.dispatch(routingRegistry, request))

    const selected = await resolveEffectiveSelection({ configPath: config.officialConfigPath, workflows: config.selectedWorkflows })
    const entries = await getOfficialCatalog({ workflowIds: selected.workflows, delivery: selected.delivery })
    const chosen = entries
    const generationSkillsData = [...chosen.map(entry => ({ name: entry.skillName, description: `Official OpenSpec ${entry.workflowId} workflow`, body: entry.body })), manageSkill]
    const generationId = config.generationId ?? createHash('sha256').update(`${version}:${selected.fingerprint}:${chosen.map(entry => entry.workflowId).join(',')}:openspec-upgrade-v5`).digest('hex').slice(0, 24)
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
    let disposed = false
    let refreshFlight: Promise<void> | undefined
    let invalidate = () => {}
    let commands = () => {}
    const refreshSurface = async (): Promise<void> => {
      if (disposed) return
      if (refreshFlight) return refreshFlight
      refreshFlight = (async () => {
        if (await recoveryPending()) return
        const nextSelection = await resolveEffectiveSelection({ configPath: config.officialConfigPath, workflows: config.selectedWorkflows })
        if (disposed || nextSelection.fingerprint === fingerprint) return
        const nextEntries = await getOfficialCatalog({ workflowIds: nextSelection.workflows, delivery: nextSelection.delivery })
        const nextId = createHash('sha256').update(`${version}:${nextSelection.fingerprint}:${nextEntries.map(entry => entry.workflowId).join(',')}:openspec-upgrade-v5`).digest('hex').slice(0, 24)
        const nextInvocation = managedInvocation({ node: process.execPath, cli: join(dshHome, 'plugins', 'dsh-openspec', 'generations', nextId, 'bin', 'openspec.js'), telemetry: settings.telemetry })
        if (disposed) return
        await materializeGeneration({ home: dshHome, id: nextId, sourceRoot: openspecRoot, version, skills: [...nextEntries.map(entry => ({ name: entry.skillName, description: `Official OpenSpec ${entry.workflowId} workflow`, body: entry.body })), manageSkill], invocation: nextInvocation, selectionFingerprint: nextSelection.fingerprint, delivery: nextSelection.delivery, canActivate: () => !disposed })
        if (disposed) return
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
    scopeRoot = child
    const registration = child.skills.registerProvider(control => {
      invalidate = control.invalidate
      return createRegistryProvider(generationsProvider as any, { beforeList: refreshSurface, beforeGet: refreshSurface }) as any
    })
    const registerCommands = () => registerWorkflowCommands(child, {
      entries: activeSurface.delivery === 'skills' ? [] : activeSurface.entries, generation: activeSurface.generation, invocation: activeSurface.invocation,
      telemetry: settings.telemetry, updateCheck: settings.updateCheck,
      consumeWorkflow: async (skillName, scope) => {
        await refreshSurface()
        if (disposed || activeSurface.delivery === 'skills' || !activeSurface.entries.some(entry => entry.skillName === skillName)) return undefined
        return (await generationsProvider.get({ name: skillName }, { scope }))?.content
      },
      initInstruction: 'Initialize OpenSpec using the official CLI in this workspace.',
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
      skillDiagnostics: async () => diagnoseSkillWinners(child.skills, activeSurface.entries.map(entry => entry.skillName)),
    })
    commands = registerCommands()
    child.on('agent/created', ({ agent }: any) => liveScopes.add(agent))
    child.on('agent/disposed', ({ agent }: any) => liveScopes.delete(agent))
    child.effect(() => () => { disposed = true; routingRegistry.dispose(); catalogMonitor.dispose(); commands(); registration() },  'dsh-openspec: contributions')
  })
}
