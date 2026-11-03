import { describe, expect, it } from 'vitest'
import { createLocusChildAdapter, type LocusChildPorts, type LocusLiveParent } from '../src/host/locus/child.js'
import { FakeOfficialRuntime } from './support/official-subagent.js'

const LOCUS_MAIN = 'session-locus-main'
const WORK_MAIN = 'session-work-main'

/** Adapter ports over the official-runtime stand-in; nothing Pet-specific is faked. */
function portsOver(runtime: FakeOfficialRuntime): LocusChildPorts {
  return {
    parent: {
      get: id => runtime.agents.get(id) as unknown as LocusLiveParent | undefined,
      resume: async () => undefined,
    },
    subagent: {
      startContinuable: spec => runtime.startContinuable(spec as never),
      getProvider: name => runtime.getProvider(name),
    },
  }
}

function setup() {
  const runtime = new FakeOfficialRuntime()
  const locusMain = runtime.addParent(LOCUS_MAIN)
  const workMain = runtime.addParent(WORK_MAIN)
  return { runtime, locusMain, workMain }
}

const prompt = (text: string) => [{ type: 'text' as const, text }]

describe('结算通知只到 locus 主会话', () => {
  it('结算通知只到 locus 主会话', async () => {
    const { runtime, locusMain, workMain } = setup()
    const adapter = createLocusChildAdapter(portsOver(runtime))

    const created = await adapter.createChild({
      parentSessionId: LOCUS_MAIN,
      childId: 'child-a',
      label: 'entry a',
      prompt: prompt('first message'),
    })
    expect(created.ok).toBe(true)

    // The default notice is what the official runtime sends; Pet must not ask
    // for a silent one (that capability is no longer in the runtime).
    const call = runtime.startCalls[0]!
    expect(call).not.toHaveProperty('settlementNotice')
    expect(call.request.parent).toBe(locusMain)

    runtime.settle('child-a')

    expect(locusMain.inbox.filter(item => item.kind === 'settlement-notice')).toEqual([
      { kind: 'settlement-notice', from: 'child-a' },
    ])
    // The work main is never the parent, so it never sees the settlement.
    expect(workMain.inbox).toEqual([])
  })
})

describe('多个入口结算不打断干活主会话', () => {
  it('多个入口结算不打断干活主会话', async () => {
    const { runtime, locusMain, workMain } = setup()
    workMain.turnOpen = true
    const adapters = ['a', 'b', 'c'].map(() => createLocusChildAdapter(portsOver(runtime)))

    for (const [index, adapter] of adapters.entries()) {
      const created = await adapter.createChild({
        parentSessionId: LOCUS_MAIN,
        childId: `child-${String(index)}`,
        label: `entry ${String(index)}`,
        prompt: prompt(`message ${String(index)}`),
      })
      expect(created.ok).toBe(true)
    }
    for (const index of [0, 1, 2]) runtime.settle(`child-${String(index)}`)

    expect(locusMain.inbox.filter(item => item.kind === 'settlement-notice').map(item => item.from))
      .toEqual(['child-0', 'child-1', 'child-2'])
    // The in-progress turn of the work main saw nothing injected and was not interrupted.
    expect(workMain.inbox).toEqual([])
    expect(workMain.turnOpen).toBe(true)
  })
})
