/**
 * `pet-locus-collaboration` requirement "关联具备双向发现且不过度披露" —
 * the two current scenarios that had no test named after them
 * (`pet-locus-collab-integration` test-plan Coverage Notes, tasks 5.3).
 *
 * Both assert TODAY's behavior against the real durable `LocusRepository`
 * (real Pet domain, only the medium substituted) and the real caller-bound
 * `pet_context` path a child actually reaches. They are the regression net
 * the collab migration must keep green.
 */
import { describe, expect, it } from 'vitest'
import { executePetContext, type PetLocusContextResult } from '../src/host/context-tool.js'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

const PARENT = 'session-main-toolface'
const ALPHA = { chatId: 'oc-toolface-alpha' } as const
const BETA = { chatId: 'oc-toolface-beta' } as const

/** Two entries under ONE main session — siblings, each with its own child. */
async function twoEntries(harness: PetHarness): Promise<LocusRepository> {
  const repository = new LocusRepository(harness.domain)
  for (const [id, endpoint, child] of [
    ['locus-alpha', ALPHA, 'child-alpha'],
    ['locus-beta', BETA, 'child-beta'],
  ] as const) {
    await repository.putLocus({
      id,
      generation: 1,
      endpoint,
      parentSessionId: PARENT,
      childSessionId: child,
      workspaceId: 'ws-toolface',
      source: 'auto',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    })
  }
  return repository
}

describe('pet-locus-collaboration: 关联具备双向发现且不过度披露', () => {
  it('toolface-01 双向核对: the main-session view and the entry view point at the same locus and the same main/child sessions', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoEntries(harness)

      // Direction 1: the owner looks at the collaboration entries of the main session.
      const fromMain = repository.listByParentSession(PARENT)
      expect(fromMain.map(record => record.id).sort()).toEqual(['locus-alpha', 'locus-beta'])

      // Direction 2: from each entry, open its session.
      for (const endpoint of [ALPHA, BETA]) {
        const fromEntry = repository.getCurrentLocus(endpoint)
        expect(fromEntry).toBeDefined()
        const listed = fromMain.find(record => record.id === fromEntry!.id)
        expect(listed).toBeDefined()
        expect(fromEntry!.parentSessionId).toBe(PARENT)
        expect(listed!.parentSessionId).toBe(fromEntry!.parentSessionId)
        expect(listed!.childSessionId).toBe(fromEntry!.childSessionId)
        expect(listed!.generation).toBe(fromEntry!.generation)
        // And the child the entry opens resolves back to the same locus.
        expect(repository.findByChildSessionId(fromEntry!.childSessionId!).map(record => record.id))
          .toEqual([fromEntry!.id])
      }
    } finally {
      await harness.close()
    }
  })

  it('toolface-02 子会话反查: a child querying its own association gets only its own locus, never an enumeration of its siblings', async () => {
    const harness = await openPetHarness(emptyMedium())
    try {
      const repository = await twoEntries(harness)
      const locusRepository = asLocusContextRepository(repository)

      // The child's real query path: caller-bound `pet_context`, no selector.
      const result = executePetContext(
        harness.repository,
        { agent: { id: 'child-alpha' } },
        { locusRepository },
      )

      expect(result.scope).toBe('locus')
      const own = result as PetLocusContextResult
      expect(own.locus.locusId).toBe('locus-alpha')
      expect(own.child.sessionId).toBe('child-alpha')
      expect(own.main.sessionId).toBe(PARENT)
      expect(own.endpoint.chatId).toBe(ALPHA.chatId)
      // Sharing a parent grants nothing: no sibling locus, child or entry appears.
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('locus-beta')
      expect(serialized).not.toContain('child-beta')
      expect(serialized).not.toContain(BETA.chatId)
    } finally {
      await harness.close()
    }
  })
})

// ---------------------------------------------------------------------------
// toolface-03..04: the child's collaboration tool face (design D6).
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LOCUS_BASE_TOOL_FILTER } from '../src/host/locus/child.js'
import { attestLocusComposition, LOCUS_SHELL_TIER_TOOL_NAMES } from '../src/host/locus/composition.js'
import { installLocusCollabTools, LOCUS_COLLAB_TOOL_NAMES } from '../src/host/collab/child-tools.js'
import { locusSpaceId } from '../src/host/collab/naming.js'
import { LocusCollabProxy } from '../src/host/collab/proxy.js'
import { SUBAGENT_HEADER, openCollabWorld, result, settle, type CollabWorld } from './support/collab-host.js'

const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
  createScope(ctx: Context, key: unknown): { ctx: Context }
}
const INHERITED = ['read', 'read_image', 'glob', 'grep', 'web_search', 'bash', 'skill']
const MEMBER_TOOLS = [...LOCUS_COLLAB_TOOL_NAMES].sort()

/**
 * A real ToolRuntime with the Host's inherited tools and, when given, the REAL
 * dsh-collab global definitions; one child scope per tier, composed the way
 * Pet composes a Locus child (base filter, safe tier deny, own-layer face).
 */
async function childSnapshots(collab: CollabWorld | undefined) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const probe = (name: string) => ({
    name, description: 'probe', parameters: {},
    output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'ok' }] },
    async execute() { return true },
  })
  for (const name of [...INHERITED, 'collab_space', 'collab_invite', 'collab_member', 'subagent']) {
    const real = collab?.tools.get(name)
    if (real === undefined && name.startsWith('collab_')) continue
    ctx.tools.register((real ?? probe(name)) as never)
  }
  for (const name of LOCUS_COLLAB_TOOL_NAMES) {
    const real = collab?.tools.get(name)
    if (real !== undefined) ctx.tools.register(real as never)
  }
  const keys = { safe: { id: 'child-safe' }, shell: { id: 'child-shell' } }
  const scopes = new Map<string, { ctx: Context }>()
  for (const tier of ['safe', 'shell']) {
    await ctx.plugin(Object.assign((inner: Context) => { scopes.set(tier, createScope(inner, keys[tier as 'safe' | 'shell'])) }, { inject: ['tools', 'systemPrompt'] }))
  }
  const snapshot = (tier: 'safe' | 'shell') => {
    const key = keys[tier]
    const scope = scopes.get(tier)!
    scope.ctx.tools.restrict(LOCUS_BASE_TOOL_FILTER as never)
    if (tier === 'safe') scope.ctx.tools.restrict({ deny: LOCUS_SHELL_TIER_TOOL_NAMES } as never)
    const global = ctx.tools as unknown as { get(name: string): never }
    installLocusCollabTools(scope.ctx.tools as never, name => global.get(name))
    const names = (ctx.tools as unknown as { schemas(scope: unknown): { name: string }[] }).schemas(key).map(schema => schema.name)
    return { names, schemas: (ctx.tools as unknown as { schemas(scope: unknown): unknown[] }).schemas(key) }
  }
  const out = { safe: snapshot('safe'), shell: snapshot('shell'), host: (ctx.tools as unknown as { schemas(): { name: string }[] }).schemas() }
  await ctx.fiber.dispose()
  return out
}

describe('pet-locus-collaboration: 子会话的协作工具面', () => {
  it('toolface-03：子会话的协作工具面', async () => {
    const collab = await openCollabWorld()
    try {
      const { safe, shell, host } = await childSnapshots(collab)
      const collabOf = (names: readonly string[]) => names.filter(name => name.startsWith('collab_')).sort()
      expect(collabOf(safe.names)).toEqual(MEMBER_TOOLS)
      expect(collabOf(shell.names)).toEqual(collabOf(safe.names))
      for (const names of [safe.names, shell.names]) {
        for (const forbidden of ['collab_space', 'collab_invite', 'collab_member', 'pet_locus_ledger_read', 'subagent']) {
          expect(names).not.toContain(forbidden)
        }
      }
      expect(shell.names).toEqual(expect.arrayContaining(['bash', 'skill']))
      expect(safe.names).not.toContain('bash')
      // Definitions are the global dsh-collab ones, unchanged.
      const hostSchema = (name: string) => JSON.stringify(host.find(schema => schema.name === name))
      for (const name of LOCUS_COLLAB_TOOL_NAMES) {
        expect(JSON.stringify((safe.schemas as { name: string }[]).find(schema => schema.name === name))).toBe(hostSchema(name))
      }
      // And the reviewed surface explains every one of them.
      expect(attestLocusComposition(safe.names, 'safe')).toEqual({ ok: true, leaks: [] })
      expect(attestLocusComposition(shell.names, 'shell')).toEqual({ ok: true, leaks: [] })
    } finally {
      await collab.stop()
    }
  })

  it('toolface-03（availability 证据）：dsh-collab 缺失时子会话照常组合，工具面无 collab_*', async () => {
    const { safe, shell } = await childSnapshots(undefined)
    expect(safe.names.filter(name => name.startsWith('collab_'))).toEqual([])
    expect(shell.names.filter(name => name.startsWith('collab_'))).toEqual([])
    expect(attestLocusComposition(safe.names, 'safe')).toEqual({ ok: true, leaks: [] })
    expect(attestLocusComposition(shell.names, 'shell')).toEqual({ ok: true, leaks: [] })
  })

  it('toolface-04：子会话不能向兄弟发消息', async () => {
    const MAIN = 'session-main-face'
    const collab = await openCollabWorld()
    try {
      collab.session(MAIN)
      const childA = collab.session('child-face-a', SUBAGENT_HEADER(MAIN))
      collab.session('child-face-b', SUBAGENT_HEADER(MAIN))
      const loci = [
        { id: 'rec-face-a', generation: 1, endpoint: { chatId: 'oc-face-a' }, parentSessionId: MAIN, childSessionId: 'child-face-a', state: 'active' },
        { id: 'rec-face-b', generation: 1, endpoint: { chatId: 'oc-face-b' }, parentSessionId: MAIN, childSessionId: 'child-face-b', state: 'active' },
      ]
      const proxy = new LocusCollabProxy({ listLoci: () => loci, liveAgent: id => collab.live.get(id) })
      proxy.attach(collab.service)
      expect(await proxy.ensureSpace(MAIN)).toMatchObject({ ok: true })
      const space = locusSpaceId(MAIN)
      const records = async () => JSON.stringify(await proxy.currentHandle()!.readManaged(space))
      const before = await records()
      for (const to of ['pet', 'child-face-b', 'oc-face-b', 'main-other']) {
        const sent = result(await collab.call(childA, 'collab_send_message', { spaceId: space, cmdId: `to-${to}`, to, body: '给兄弟的话', needsReply: true }))
        expect(sent).toEqual({ error: { code: 'COLLAB_BAD_RECIPIENT' } })
      }
      await settle()
      expect(await records()).toBe(before)
      expect(proxy.inbox()).toEqual([])
    } finally {
      await collab.stop()
    }
  })
})
