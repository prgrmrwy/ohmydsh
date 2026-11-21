import { describe, expect, it, vi } from 'vitest'
import { composeLocusChild, LOCUS_CALLER_BOUND_TOOLS, LOCUS_SAFE_TOOL_NAMES } from '../src/host/locus/composition.js'
import { createLocusChildAdapter, type LocusLiveParent } from '../src/host/locus/child.js'
import { FakeOfficialRuntime } from './support/official-subagent.js'

describe('three-tier child context ownership', () => {
  it('旧 fork child 不受影响', () => {
    // GIVEN a fork child that inherited its parent's prefix. The migration deleted
    // the previous-model row that pointed at it, so no locus row references it.
    const install = vi.fn()
    const find = vi.fn(() => undefined)
    const scope = Object.freeze({})
    // WHEN it is published/resumed, THEN it is an ordinary session: not composed,
    // nothing installed on its scope, its history never consulted or trimmed.
    expect(composeLocusChild({ id: 'historical-fork', scope }, {
      lookup: { find }, surface: { install, visibleTools: () => [] },
    } as never)).toEqual({ composed: false })
    expect(find).toHaveBeenCalledWith('historical-fork')
    expect(install).not.toHaveBeenCalled()
  })

  it('spec Scenario "子会话发现不自动成为主会话认知"', async () => {
    const runtime = new FakeOfficialRuntime()
    const work = runtime.addParent('work')
    runtime.addParent('locus-main')
    runtime.agentCreatedListeners.push(({ agent }) => {
      composeLocusChild({ id: agent.id, scope: agent.ctx }, {
        lookup: { find: () => ({ locusMainSessionId: 'locus-main', sessionId: agent.id, locusId: 'locus', revision: 1, accessMode: 'read-only', endpoint: { chatId: 'oc_1' } }) },
        parentPreset: () => 'locus-base',
        childPreset: () => 'locus-child',
        writeEnabled: true,
        policy: { apply: () => {}, resolve: () => 'read-only' },
        surface: { install: () => {}, applyAccessMode: () => {}, installOutboundGuard: () => {}, visibleTools: () => [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS] },
      })
    })
    const adapter = createLocusChildAdapter({
      parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent, resume: async () => undefined },
      subagent: { startActivation: spec => runtime.startActivation(spec as never), getProvider: name => runtime.getProvider(name) },
    })
    expect(await adapter.createChild({ parentSessionId: 'locus-main', childId: 'child', label: 'entry', prompt: [{ type: 'text', text: 'ENTRY_FINDING' }] })).toMatchObject({ ok: true })
    expect(work.inbox).toEqual([])
    runtime.settle('child')
    expect(runtime.agents.get('locus-main')?.inbox).toEqual([{ kind: 'settlement-notice', from: 'child' }])
    expect(work.inbox).toEqual([])
    adapter.dispose()
  })

  /** A locus main with a long history of its own (GUI acceptance turns, sibling chats). */
  function richParent(runtime: FakeOfficialRuntime, id: string) {
    const parent = runtime.addParent(id)
    parent.inbox.push({ kind: 'user', text: 'PARENT_GUI_ACCEPTANCE_HISTORY' }, { kind: 'user', text: 'PARENT_SUMMARY_SENTINEL' })
    return parent
  }

  function adapterFor(runtime: FakeOfficialRuntime) {
    return createLocusChildAdapter({
      parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent, resume: async () => undefined },
      subagent: { startActivation: spec => runtime.startActivation(spec as never), getProvider: name => runtime.getProvider(name) },
    })
  }

  it('spec Scenario "长父历史不能冒充子身份"', async () => {
    const runtime = new FakeOfficialRuntime()
    richParent(runtime, 'locus-main')
    const adapter = adapterFor(runtime)

    expect(await adapter.createChild({ parentSessionId: 'locus-main', childId: 'qa-child', label: 'Q&A', prompt: [{ type: 'text', text: 'FIRST_ENTRY_REQUEST' }] })).toMatchObject({ ok: true })

    // The child starts on an independent-context provider with ONLY its entry's prompt.
    const call = runtime.startCalls[0]!
    expect(call.provider).toBe('spawn')
    expect(runtime.getProvider(call.provider)?.inheritsParentContext).not.toBe(true)
    expect(JSON.stringify(call.request.prompt)).toContain('FIRST_ENTRY_REQUEST')
    expect(JSON.stringify(call.request.prompt)).not.toMatch(/PARENT_GUI_ACCEPTANCE_HISTORY|PARENT_SUMMARY_SENTINEL/)
    adapter.dispose()
  })

  it('spec Scenario "新话题上下文"', async () => {
    const runtime = new FakeOfficialRuntime()
    richParent(runtime, 'locus-main')
    const group = adapterFor(runtime)
    expect(await group.createChild({ parentSessionId: 'locus-main', childId: 'group-child', label: 'group', prompt: [{ type: 'text', text: 'GROUP_DISCUSSION' }] })).toMatchObject({ ok: true })
    const topic = adapterFor(runtime)

    expect(await topic.createChild({ parentSessionId: 'locus-main', childId: 'topic-child', label: 'topic', prompt: [{ type: 'text', text: 'TOPIC_REQUEST' }] })).toMatchObject({ ok: true })

    // Same locus main (fixed ownership), but nothing of the parent or the group child is copied.
    const call = runtime.startCalls[1]!
    expect(call.request.parent.id).toBe('locus-main')
    expect(call.provider).toBe('spawn')
    expect(JSON.stringify(call.request.prompt)).not.toMatch(/GROUP_DISCUSSION|PARENT_SUMMARY_SENTINEL/)
    group.dispose()
    topic.dispose()
  })

  it('spec Scenario "重建后的子会话不继承旧子会话历史"', async () => {
    const runtime = new FakeOfficialRuntime()
    runtime.addParent('locus-main')
    const old = adapterFor(runtime)
    expect(await old.createChild({ parentSessionId: 'locus-main', childId: 'C0', label: 'entry', prompt: [{ type: 'text', text: 'C0_TURN_HISTORY' }] })).toMatchObject({ ok: true })
    old.dispose()
    runtime.release('C0')
    const startsBefore = runtime.startCalls.length
    const queuesBefore = runtime.queueCalls.length

    const rebuilt = adapterFor(runtime)
    expect(await rebuilt.createChild({ parentSessionId: 'locus-main', childId: 'C1', label: 'entry', prompt: [{ type: 'text', text: 'C1_FIRST' }] })).toMatchObject({ ok: true })

    // C1 is a fresh start under the new id; C0 is neither resumed nor sent anything.
    expect(runtime.startCalls.slice(startsBefore).map(call => call.childId)).toEqual(['C1'])
    expect(JSON.stringify(runtime.startCalls.at(-1)!.request.prompt)).not.toContain('C0_TURN_HISTORY')
    expect(runtime.queueCalls.slice(queuesBefore).filter(call => call.childId === 'C0')).toEqual([])
    expect(runtime.agents.has('C0')).toBe(false)
    rebuilt.dispose()
  })
})

