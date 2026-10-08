import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { createRoutingDispatcher, createRoutingRegistry } from '../src/routing.js'

vi.mock('../src/catalog-invalidation.js', () => ({ watchCatalogInvalidation: () => ({ check: async () => {}, dispose() {} }) }))
const homes: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

/** Start the real adapter and capture exactly what it publishes to the Host. */
async function published() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-openspec-routing-')); homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  const services = new Map<string, any>()
  let startup!: Promise<unknown>
  const tools: unknown[] = []
  const child = {
    skills: { registerProvider: () => () => {} },
    commands: { register: () => () => {} },
    tools: { register: (...args: unknown[]) => { tools.push(args); return () => {} } },
    provide: (name: string, value: unknown) => { services.set(name, value) }, on() {}, set() {}, effect() {},
  }
  apply({ inject: (_names: unknown, callback: any) => { startup = callback(child) } } as any, { officialConfigPath: join(home, 'absent.json'), updateCheck: 'disabled' })
  await startup
  return { services, tools }
}
const fixtureProvider = (decide: (request: any) => any) => ({ id: 'test', contractVersion: 1, stages: ['change-necessity', 'workflow-selection'] as ('change-necessity' | 'workflow-selection')[], testOnly: true, decide })

describe('routing surface and first-stage lifecycle', () => {
  it('published_registration_service_cannot_reach_a_provider_and_no_model_tool_is_registered', async () => {
    const { services, tools } = await published()
    const registration = services.get('openspec.routing')
    expect(Object.keys(registration).sort()).toEqual(['register'])
    expect(tools).toEqual([])
    // The single entry is the only published function that dispatches.
    expect(typeof services.get('openspec.routing.dispatch')).toBe('function')
  })
  it('first_stage_formal_recommendation_issues_a_session_bound_token_that_unlocks_exactly_one_second_stage', async () => {
    const registry = createRoutingRegistry('test'), dispatcher = createRoutingDispatcher()
    const decide = vi.fn((request: any) => request.stage === 'change-necessity'
      ? { status: 'selected', candidateId: 'formal-workflow', token: 'provider-forged', authority: 'none' as const }
      : { status: 'selected', candidateId: 'schema', authority: 'none' as const })
    registry.register(fixtureProvider(decide))
    const first = await dispatcher.dispatch(registry, { stage: 'change-necessity', sessionId: 'A', features: {} })
    expect(first).toMatchObject({ status: 'selected', candidateId: 'formal-workflow' })
    expect(typeof first.token).toBe('string'); expect(first.token).not.toBe('provider-forged')
    const second = { stage: 'workflow-selection' as const, sessionId: 'A', firstStageOutcome: 'formal-workflow' as const, features: {}, token: first.token, candidates: [{ id: 'schema', kind: 'official-schema' }] }
    expect(await dispatcher.dispatch(registry, { ...second, sessionId: 'B' }, { eligibleCandidateIds: ['schema'] })).toMatchObject({ reason: 'invalid-stage-token' })
    expect((await dispatcher.dispatch(registry, second, { eligibleCandidateIds: ['schema'] })).status).toBe('selected')
    expect(await dispatcher.dispatch(registry, second, { eligibleCandidateIds: ['schema'] })).toMatchObject({ reason: 'invalid-stage-token' })
  })
  it('direct_or_ineligible_first_stage_result_issues_no_token', async () => {
    const registry = createRoutingRegistry('test'), dispatcher = createRoutingDispatcher()
    let candidateId = 'direct'
    registry.register(fixtureProvider(() => ({ status: 'selected', candidateId, token: 'provider-forged', authority: 'none' as const })))
    const direct = await dispatcher.dispatch(registry, { stage: 'change-necessity', sessionId: 'A', features: {} })
    expect(direct).toMatchObject({ status: 'selected', candidateId: 'direct' }); expect(direct).not.toHaveProperty('token')
    candidateId = 'something-else'
    expect(await dispatcher.dispatch(registry, { stage: 'change-necessity', sessionId: 'A', features: {} })).toMatchObject({ status: 'needs-review', reason: 'ineligible-result' })
  })
  it.each([5, -0.1, Number.NaN, '0.9', null])('confidence_outside_zero_to_one_is_rejected_as_malformed_%s', async confidence => {
    const registry = createRoutingRegistry('test')
    registry.register(fixtureProvider(() => ({ status: 'selected', candidateId: 'direct', confidence, authority: 'none' as const })))
    expect(await createRoutingDispatcher().dispatch(registry, { stage: 'change-necessity', sessionId: 'A', features: {} })).toMatchObject({ status: 'needs-review', reason: 'malformed-result' })
  })
  it('candidate_count_and_description_are_bounded_in_bytes', async () => {
    const registry = createRoutingRegistry('test'), seen: any[] = []
    registry.register(fixtureProvider(request => { seen.push(request); return { status: 'needs-review', authority: 'none' as const } }))
    const dispatcher = createRoutingDispatcher()
    const many = Array.from({ length: 33 }, (_, index) => ({ id: `c${index}`, kind: 'official-schema' }))
    expect(await dispatcher.dispatch(registry, { stage: 'change-necessity', sessionId: 'A', features: {}, candidates: many }, { eligibleCandidateIds: many.map(c => c.id) })).toMatchObject({ status: 'needs-review', reason: 'too-many-candidates' })
    expect(seen).toHaveLength(0)
    await dispatcher.dispatch(registry, { stage: 'change-necessity', sessionId: 'A', features: {}, candidates: [{ id: 'c', kind: 'official-schema', description: '界'.repeat(2000) }] }, { eligibleCandidateIds: ['c'] })
    const description = seen[0].candidates[0].description as string
    expect(Buffer.byteLength(description)).toBeLessThanOrEqual(2048)
    expect(description).toContain('[untrusted schema description]')
  })
  it('existing_change_authority_comes_from_official_metadata_not_caller_supplied_context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-openspec-authority-')); homes.push(root)
    await mkdir(join(root, 'openspec/changes/add-auth'), { recursive: true })
    await writeFile(join(root, 'openspec/changes/add-auth/.openspec.yaml'), 'schema: anvil\ncreated: 2026-10-07\n')
    const registry = createRoutingRegistry('test'), decide = vi.fn(() => ({ status: 'selected', candidateId: 'direct', authority: 'none' as const }))
    registry.register(fixtureProvider(decide))
    const dispatcher = createRoutingDispatcher(), base = { stage: 'change-necessity' as const, sessionId: 'A', features: {} }
    const context = { changeRoot: root, changesDir: 'openspec/changes' }
    // A caller-supplied schema is ignored: the recorded one wins.
    expect(await dispatcher.dispatch(registry, { ...base, changeName: 'add-auth' }, { ...context, existingChange: { schema: 'spec-driven' } })).toMatchObject({ status: 'selected', source: 'existing-change', schema: 'anvil', authority: 'none' })
    expect(decide).not.toHaveBeenCalled()
    // No recorded metadata: no fabricated authority, and the provider is consulted normally.
    await mkdir(join(root, 'openspec/changes/no-meta'), { recursive: true })
    expect(await dispatcher.dispatch(registry, { ...base, changeName: 'no-meta' }, { ...context, existingChange: { schema: 'anvil' } })).not.toMatchObject({ source: 'existing-change' })
    // Unknown change name and a symlink escaping the changes directory are not authority either.
    expect(await dispatcher.dispatch(registry, { ...base, changeName: 'missing' }, context)).toMatchObject({ status: 'unavailable', reason: 'not-found' })
    const outside = await mkdtemp(join(tmpdir(), 'dsh-openspec-outside-')); homes.push(outside)
    await writeFile(join(outside, '.openspec.yaml'), 'schema: anvil\n')
    await symlink(outside, join(root, 'openspec/changes/escape'))
    expect(await dispatcher.dispatch(registry, { ...base, changeName: 'escape' }, context)).toMatchObject({ status: 'unavailable' })
  })
})
