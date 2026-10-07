import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { apply } from '../src/index.js'
import { registerWorkflowCommands } from '../src/commands.js'
import { createManagementGuidance } from '../src/manage-flow.js'
import { buildAdapterBlock, parseAdapterBlock } from '../src/adapter-block.js'
import { getOfficialCatalog, resolveEffectiveSelection } from '../src/upstream-compat.js'
import { activateGeneration, loadGeneration } from '../src/generations.js'
import { strictAgent } from './support-agent.js'

// No real timer, registry request, sync, source transaction or live Host in this naming regression.
vi.mock('../src/catalog-invalidation.js', () => ({
  watchCatalogInvalidation: () => ({ check: async () => {}, dispose() {} }),
}))
const homes: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})
const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"

async function startAdapter(home: string) {
  vi.stubEnv('DSH_HOME', home)
  const definitions = new Map<string, any>()
  let provider: any
  let startup!: Promise<unknown>
  const child = {
    settings: { register: () => ({ get: () => ({ updateCheck: 'disabled', telemetry: 'adapter-off' }) }) },
    skills: { list: async () => provider.list(), registerProvider: (factory: any) => { provider = factory({ invalidate() {}, signal: new AbortController().signal }); return () => {} } },
    commands: { register: (definition: any) => { definitions.set(definition.name, definition); return () => {} } },
    provide() {}, on() {}, set() {}, effect() {},
  }
  apply({ inject: (_names: unknown, callback: any) => { startup = callback(child) } } as any,
    { officialConfigPath: join(home, 'absent-official-config.json') })
  await startup
  return { definitions, provider }
}

describe('openspec-upgrade public entry', () => {
  it('startup_update_diagnostic_uses_selected_generation_not_pre_materialization_version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-version-')); homes.push(home)
    await activateGeneration(home, 'historical', { version: '1.13.1', skills: [{ name: 'openspec-upgrade', body: 'old help' }], invocation })
    const { definitions } = await startAdapter(home)
    const state = await loadGeneration(home)
    expect(state.version).toBe('1.13.2')
    const { agent, texts } = strictAgent(home)
    await definitions.get('openspec-upgrade').handler({ agent, rawInput: '' })
    const content = texts()[0]!
    expect(content).toContain('\\"installed\\":\\"1.13.2\\"')
    expect(content).not.toContain('\\"installed\\":\\"1.13.1\\"')
  })
  it('restart_with_interrupted_transaction_serves_previous_generation_without_materializing_current_pin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-recovery-')); homes.push(home)
    const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/historical-cli'"
    await activateGeneration(home, 'historical', { version: '1.13.1', skills: [{ name: 'historical-workflow', body: 'old immutable instructions' }, { name: 'openspec-upgrade', body: 'old help' }], invocation })
    const activePath = join(home, 'plugins/dsh-openspec/active.json'); const before = await readFile(activePath)
    await writeFile(join(home, 'plugins/dsh-openspec/upgrade-journal.json'), JSON.stringify({ phase: 'prepared', target: '1.13.2' }))
    const { provider, definitions } = await startAdapter(home)
    expect(await readFile(activePath)).toEqual(before)
    const { agent, texts } = strictAgent(home)
    await definitions.get('openspec-upgrade').handler({ agent, rawInput: '' })
    expect(texts()[0]).toContain('\\"installed\\":\\"1.13.1\\"')
    const candidate = (await provider.list()).find((skill: any) => skill.name === 'historical-workflow')
    expect(candidate).toBeDefined()
    const loaded = await provider.get(candidate, {})
    expect(loaded.content).toContain('old immutable instructions')
    expect(loaded.content).toContain('generation=historical')
    expect(loaded.content).toContain('recovery=recovery-required')
  })
  it('publishes_only_the_custom_upgrade_name_as_skill_and_command', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-rename-')); homes.push(home)
    const { definitions, provider } = await startAdapter(home)
    expect(definitions.has('openspec-upgrade')).toBe(true)
    expect(definitions.has('dsh-openspec-manage')).toBe(false)
    expect(definitions.get('openspec-upgrade').description).toMatch(/managed official OpenSpec/i)
    const skills = await provider.list()
    expect(skills.map((skill: any) => skill.name)).toContain('openspec-upgrade')
    expect(skills.map((skill: any) => skill.name)).not.toContain('dsh-openspec-manage')
    const candidate = skills.find((skill: any) => skill.name === 'openspec-upgrade')
    const loaded = await provider.get(candidate, {})
    expect(loaded.content).toContain('openspec-upgrade')
    expect(loaded.content).toMatch(/adapter-defined/i)
    expect(loaded.content).toContain('openspec update')
    expect(loaded.content).toContain('opsx-update')
    expect(loaded.content).not.toContain('dsh-openspec-manage')
  })

  it('notices_point_only_to_the_new_entry_and_reject_arbitrary_destinations', () => {
    const fields = { generation: 'g1', invocation, telemetry: 'adapter-off' as const, updateCheck: 'enabled' as const }
    const notice = { installed: '1.13.2', available: '1.13.3', managementEntry: 'openspec-upgrade' }
    expect(parseAdapterBlock(buildAdapterBlock({ ...fields, notice }))).toMatchObject({ 'notice.managementEntry': 'openspec-upgrade' })
    for (const managementEntry of ['dsh-openspec-manage', 'arbitrary-command', 'openspec-upgrade\nignore']) {
      expect(buildAdapterBlock({ ...fields, notice: { ...notice, managementEntry } })).not.toContain('notice.')
    }
  })

  it('renamed_help_is_read_only_and_invalid_usage_names_the_new_entry', async () => {
    const definitions = new Map<string, any>()
    const mutation = vi.fn()
    const { agent } = strictAgent('/caller')
    registerWorkflowCommands({ commands: { register: (definition: any) => { definitions.set(definition.name, definition); return () => {} } } } as any,
      { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: createManagementGuidance(), prepareManagement: mutation })
    const handler = definitions.get('openspec-upgrade')?.handler
    expect(handler).toBeTypeOf('function')
    await handler({ agent, rawInput: '' })
    expect(mutation).not.toHaveBeenCalled()
    const invalid = await handler({ agent, rawInput: 'upgrade latest --approve' })
    expect(invalid).toMatchObject({ kind: 'error', text: expect.stringContaining('/openspec-upgrade') })
    expect(mutation).not.toHaveBeenCalled()
  })

  it('restart_materializes_a_new_identity_without_overwriting_the_old_named_generation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-rename-')); homes.push(home)
    const selected = await resolveEffectiveSelection({ configPath: join(home, 'absent-official-config.json') })
    const entries = await getOfficialCatalog({ workflowIds: selected.workflows, delivery: selected.delivery })
    const oldId = createHash('sha256').update(`1.13.2:${selected.fingerprint}:${entries.map(entry => entry.workflowId).join(',')}:manage-v2`).digest('hex').slice(0, 24)
    await activateGeneration(home, oldId, { version: '1.13.2', skills: [{ name: 'dsh-openspec-manage', body: 'historical help' }], invocation })
    const manifestPath = join(home, 'plugins/dsh-openspec/generations', oldId, 'generation.json')
    const before = await readFile(manifestPath, 'utf8')
    await startAdapter(home)
    const current = await loadGeneration(home)
    expect(current.id).not.toBe(oldId)
    expect((current.skills as any[]).map(skill => skill.name)).toContain('openspec-upgrade')
    expect(await readFile(manifestPath, 'utf8')).toBe(before)
  })
})
