/**
 * `pet-locus-intent-triage` — 协作空间由工作主会话与 locus 主会话两个普通成员组成.
 * Runs against the REAL dsh-collab plugin and collab-kernel (pitfalls §7).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { runTool } from './support/tool-call.js'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LocusCollab, type LocusMainRef } from '../src/host/collab/locus-collab.js'
import { locusSpaceId } from '../src/host/collab/naming.js'
import { attestLocusComposition, LOCUS_CALLER_BOUND_TOOLS } from '../src/host/locus/composition.js'
import { registerPetTools } from '../src/host/tools.js'
import { openCollabWorld, type CollabWorld } from './support/collab-host.js'

// Scope tags use a package-private Symbol: mint from ToolRuntime's own dependency root.
const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as typeof import('@deepseek-ai/dsh-scope')

const MAIN: LocusMainRef = { locusMainSessionId: 'locus-main-1', workSessionId: 'work-1' }

let world: CollabWorld | undefined
afterEach(async () => { await world?.stop(); world = undefined })

function attached(opened: CollabWorld, refs: readonly LocusMainRef[] = [MAIN]) {
  const collab = new LocusCollab({ directory: { list: () => refs } })
  const detach = collab.attach(opened.service)
  return { collab, detach }
}

async function eventsOf(collab: LocusCollab, locusMainSessionId: string): Promise<readonly Record<string, any>[]> {
  const records = await collab.readSpace(locusMainSessionId)
  return (records ?? []).flatMap(record => record.events as readonly Record<string, any>[])
}

describe('协作空间由工作主会话与 locus 主会话两个普通成员组成', () => {
  it('首次建立时 locus 主会话尚未登记：establishes before the locus_mains row exists, then stops vouching', async () => {
    world = await openCollabWorld()
    world.session(MAIN.locusMainSessionId)
    world.session(MAIN.workSessionId)
    // Production order: the pairing row is committed only AFTER the space exists.
    const { collab } = attached(world, [])

    expect(await collab.ensureSpace(MAIN)).toEqual({ ok: true, spaceId: locusSpaceId(MAIN.locusMainSessionId) })
    expect(collab.adapter.owns?.(MAIN.locusMainSessionId)).toBe(false)
  })

  it('建空间并邀请工作主会话', async () => {
    world = await openCollabWorld()
    world.session(MAIN.locusMainSessionId)
    world.session(MAIN.workSessionId)
    const { collab } = attached(world)

    const outcome = await collab.ensureSpace(MAIN)

    expect(outcome).toEqual({ ok: true, spaceId: locusSpaceId(MAIN.locusMainSessionId) })
    const events = await eventsOf(collab, MAIN.locusMainSessionId)
    const sequence = events
      .filter(event => ['space/created', 'manager/allowed', 'member/invited', 'member/joined'].includes(event.type))
      .map(event => `${event.type}:${event.member?.name ?? event.channel ?? event.leader}`)
    expect(sequence).toEqual([
      'space/created:locus', 'member/joined:locus', 'manager/allowed:pet-locus', 'member/invited:work', 'member/joined:work',
    ])
    const created = events.find(event => event.type === 'space/created')!
    expect(created.leader).toBe('locus')
    expect(events.find(event => event.type === 'manager/allowed')!.channel).toBe('pet-locus')
    const joined = events.filter(event => event.type === 'member/joined' || event.type === 'member/invited')
    const bindings = new Map(joined.map(event => [event.member.name, event.member.binding]))
    expect(bindings.get('work')).toMatchObject({ channel: 'dsh-session', address: MAIN.workSessionId })
    const members = new Set(events.filter(event => event.type === 'member/joined' || event.type === 'member/invited' || event.type === 'space/created').map(event => event.member?.name ?? event.leader))
    expect([...members].sort()).toEqual(['locus', 'work'])
    expect(collab.isEstablished(MAIN.locusMainSessionId)).toBe(true)
  })

  it('工作主会话不可邀请时不建入口', async () => {
    world = await openCollabWorld({ denySessionIds: [MAIN.workSessionId] })
    world.session(MAIN.locusMainSessionId)
    world.session(MAIN.workSessionId)
    const { collab } = attached(world)

    const outcome = await collab.ensureSpace(MAIN)

    expect(outcome).toMatchObject({ ok: false, reason: 'work-not-invitable', code: 'COLLAB_ADDRESS_UNCLAIMED' })
    expect(collab.isEstablished(MAIN.locusMainSessionId)).toBe(false)
  })

  it('子会话没有协作工具', async () => {
    // (1) The reviewed child surface names no collab_* tool, and one that appears is a leak.
    expect(LOCUS_CALLER_BOUND_TOOLS.filter(name => name.startsWith('collab_'))).toEqual([])
    expect(attestLocusComposition(['pet_context', 'collab_read'])).toMatchObject({ ok: false, reason: 'leaked', leaks: ['collab_read'] })

    // (2) What Pet itself publishes to a child scope contains none.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const key = { id: 'child-no-collab' } as never
    const scope = createScope(ctx, key)
    await new Promise<void>((resolve, reject) => {
      scope.ctx.inject(['tools'], toolCtx => {
        try {
          registerPetTools(toolCtx, {
            repository: {} as never,
            intentTriage: { loci: { findByChildSessionId: () => [] } },
            locusChildTools: { loci: { findByChildSessionId: () => [] }, collab: new LocusCollab({ directory: { list: () => [] } }), subagents: () => undefined },
          } as never)
          resolve()
        } catch (error) { reject(error) }
      })
    })
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }
    const names = runtime.schemas(key).map(schema => schema.name)
    expect(names.some(name => name.startsWith('collab_'))).toBe(false)

    // (3) A forged collab_read from the child finds no such tool.
    const forged = await runTool(ctx, {
      agent: key, name: 'collab_read', callId: 'forged-1' as never, arguments: { view: 'overview', spaceId: 'x' }, signal: new AbortController().signal,
    }) as unknown as { isError?: boolean; content?: readonly { text?: string }[] }
    expect(forged.isError).toBe(true)
    await ctx.fiber.dispose()
  })
})
