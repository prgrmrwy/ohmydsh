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
const manageSkill = { name: 'dsh-openspec-manage', description: 'Manage the pinned DSH OpenSpec adapter runtime', body: createManagementGuidance() }
const approvedRoutingProviders: string[] = []
import { createRegistryProvider } from './registry-provider.js'
import { createManagementController } from './manage-controller.js'
import { watchCatalogInvalidation } from './catalog-invalidation.js'
import { createUpgradeTransaction } from './upgrade-transaction.js'
import { readSourceCheckout, isWorktreeCheckout } from './source-record.js'
import { stageTarget } from './stage-target.js'
import { officialStageDependencies } from './stage-official.js'
import { selectGeneration, loadGeneration } from './generations.js'
import { resolve as resolvePath } from 'node:path'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'

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
      const activeGeneration = await loadGeneration(dshHome).catch(() => undefined)
    const installedVersion = typeof activeGeneration?.version === 'string' ? activeGeneration.version : version
    const updateChecker = createUpdateChecker({ stateDir, installed: installedVersion, enabled: settings.updateCheck === 'enabled' })
    const recordedCheckout = await readSourceCheckout(stateDir)
    const sourceRoot = recordedCheckout
    const transaction = sourceRoot ? createUpgradeTransaction({
      checkout: sourceRoot, recordedCheckout: sourceRoot, stateDir,
      isWorktreeBound: Boolean(process.env.DSH_WORKTREE_SESSION) || await isWorktreeCheckout(sourceRoot),
      stage: target => stageTarget(sourceRoot, target, officialStageDependencies(sourceRoot)),
      verify: async staged => {
        const entry = staged.lockfile.packages?.['node_modules/@fission-ai/openspec']
        return staged.integrity.startsWith('sha512-') && entry?.integrity === staged.integrity && entry?.version === staged.target
      },
      activate: async target => {
        // A target other than the running package cannot be rendered by this process's official renderer:
        // the previously active generation keeps serving and the next Host start materializes the target.
        if (target !== version) return { activation: 'pending-reload' as const }
        await materializeGeneration({
          home: dshHome, id: generationId, sourceRoot: openspecRoot, version,
          skills: generationSkillsData, invocation, selectionFingerprint: selected.fingerprint, delivery: selected.delivery,
        })
        return { activation: 'live' as const }
      },
      runSync: async () => {
        const { spawnSync } = await import('node:child_process')
        const run = spawnSync(process.execPath, [join(sourceRoot!, 'scripts/sync.mjs')], { cwd: sourceRoot!, encoding: 'utf8', timeout: 120_000, env: { ...process.env, DSH_HOME: dshHome } })
        return run.status === 0
      },
    }) : undefined
    const management = transaction ? createManagementController({
      transact: async (target, approval) => transaction.upgrade(target, { approved: approval.approved }) as any,
      refreshProject: async () => {
        const { spawnSync } = await import('node:child_process')
        const run = spawnSync(process.execPath, [join(openspecRoot, 'bin/openspec.js'), 'update'], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000, env: { ...process.env, OPENSPEC_NO_UPDATE_CHECK: '1', OPENSPEC_TELEMETRY: settings.telemetry === 'adapter-off' ? '0' : '1' } })
        if (run.status !== 0) throw new Error('project-refresh-failed')
      },
    }) : undefined
    child.provide('openspec.management', management)
    const routingRegistry = createRoutingRegistry(activeRoutingProviderId)
    const routingDispatcher = createRoutingDispatcher()
    child.provide(RoutingRegistryServiceName, routingRegistry)
    child.provide('openspec.routing.dispatch', (request: Parameters<typeof routingRegistry.dispatch>[0]) => routingDispatcher.dispatch(routingRegistry, request))

    const selected = await resolveEffectiveSelection({ configPath: config.officialConfigPath, workflows: config.selectedWorkflows })
    const entries = await getOfficialCatalog({ workflowIds: selected.workflows, delivery: selected.delivery })
    const chosen = entries
    const generationSkillsData = [...chosen.map(entry => ({ name: entry.skillName, description: `Official OpenSpec ${entry.workflowId} workflow`, body: entry.body })), manageSkill]
    const generationId = config.generationId ?? createHash('sha256').update(`${version}:${selected.fingerprint}:${chosen.map(entry => entry.workflowId).join(',')}:manage-v2`).digest('hex').slice(0, 24)
    const invocation = managedInvocation({ node: process.execPath, cli: join(dshHome, 'plugins', 'dsh-openspec', 'generations', generationId, 'bin', 'openspec.js'), telemetry: settings.telemetry })
    if (config.initialDeployment !== false) {
      await materializeGeneration({
        home: dshHome, id: generationId, sourceRoot: openspecRoot, version,
        skills: generationSkillsData,
        invocation,
        selectionFingerprint: selected.fingerprint,
        delivery: selected.delivery,
      })
    }
    const liveScopes = new WeakSet<object>()
    let scopeRoot: any
    const generationsProvider = createGenerationBackedProvider({
      home: dshHome, telemetry: settings.telemetry, updateCheck: settings.updateCheck,
      isScopeLive: scope => liveScopes.has(scope),
      onGeneration: id => { void scopeRoot?.set('dsh-openspec:generation', id) },
      check: async () => {
        const result = await updateChecker.check()
        return result.state === 'newer' && result.available ? { installed: result.installed, available: result.available, managementEntry: 'dsh-openspec-manage' } : undefined
      },
    })
    const generationSkills = await generationsProvider.list()
    const effectiveEntries = chosen.filter(entry => generationSkills.some(skill => skill.name === entry.skillName))
    let activeSurface = { entries: effectiveEntries, generation: generationId, invocation }
    const refreshSurface = async () => {
      const nextSelection = await resolveEffectiveSelection({ configPath: config.officialConfigPath, workflows: config.selectedWorkflows })
      if (nextSelection.fingerprint === selected.fingerprint) return
      const nextEntries = await getOfficialCatalog({ workflowIds: nextSelection.workflows, delivery: nextSelection.delivery })
      const nextId = createHash('sha256').update(`${version}:${nextSelection.fingerprint}:${nextEntries.map(entry => entry.workflowId).join(',')}:manage-v2`).digest('hex').slice(0, 24)
      const nextInvocation = managedInvocation({ node: process.execPath, cli: join(dshHome, 'plugins', 'dsh-openspec', 'generations', nextId, 'bin', 'openspec.js'), telemetry: settings.telemetry })
      await materializeGeneration({ home: dshHome, id: nextId, sourceRoot: openspecRoot, version, skills: [...nextEntries.map(entry => ({ name: entry.skillName, description: `Official OpenSpec ${entry.workflowId} workflow`, body: entry.body })), manageSkill], invocation: nextInvocation, selectionFingerprint: nextSelection.fingerprint, delivery: nextSelection.delivery })
      activeSurface = { entries: nextEntries, generation: nextId, invocation: nextInvocation }
    }
    const catalogMonitor = watchCatalogInvalidation({
      configPath: config.officialConfigPath ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'openspec/config.json'),
      invalidate: () => { void refreshSurface() },
      intervalMs: 30_000,
    })
    scopeRoot = child
    const registration = child.skills.registerProvider(() => createRegistryProvider(generationsProvider as any, {
      beforeList: async () => { await catalogMonitor.check(); await refreshSurface() },
    }) as any)
    const commands = registerWorkflowCommands(child, {
      entries: effectiveEntries, generation: generationId, invocation,
      telemetry: settings.telemetry, updateCheck: settings.updateCheck,
      consumeWorkflow: async (skillName, scope) => (await generationsProvider.get({ name: skillName }, { scope }))?.content,
      initInstruction: 'Initialize OpenSpec using the official CLI in this workspace.',
      hasOpenSpecDir: async cwd => await import('node:fs/promises').then(fs => fs.stat(join(cwd, 'openspec')).then(info => info.isDirectory()).catch(() => false)),
      manageInstruction: createManagementGuidance(),
      onGeneration: async () => {
        const state = await loadGeneration(dshHome)
        activeSurface = { entries: chosen.filter(entry => (state.skills as any[]).some(skill => skill.name === entry.skillName)), generation: state.id, invocation: String(state.invocation) }
      },
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
      recoveryState: async () => transaction ? await transaction.inspectRecovery() : 'none',
      managedVersion: version,
      checkCommand: async () => JSON.stringify(await updateChecker.check({ explicit: true })),
      management,
      skillDiagnostics: async () => diagnoseSkillWinners(child.skills, effectiveEntries.map(entry => entry.skillName)),
    })
    child.on('agent/created', ({ agent }: any) => liveScopes.add(agent))
    child.on('agent/disposed', ({ agent }: any) => liveScopes.delete(agent))
    child.effect(() => () => { commands(); registration() }, 'dsh-openspec: contributions')
  })
}
