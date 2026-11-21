import { describe, expect, it } from 'vitest'
import { apply, REMINDER_TEXT, routerActive, type Environment } from '../src/index.js'

type Decision = { kind: 'accept' | 'block'; feedback?: unknown; content?: unknown; additionalContexts?: any[] }
type Handler = (exec: any, result: unknown, next: () => Promise<Decision>) => Promise<Decision>

function setup(environment: Environment = { env: {}, skillDeployed: () => true }) {
  let handler: Handler | undefined
  const ctx = { on: (event: string, fn: Handler) => { if (event === 'tools/post-execute') handler = fn } }
  apply(ctx as any, undefined, environment)
  if (!handler) throw new Error('post-execute listener not registered')
  const call = (agent: object, name: string, args: unknown, downstream: Decision = { kind: 'accept' }) =>
    handler!({ agent, name, arguments: args }, {}, async () => downstream)
  return { call }
}

const reminders = (decision: Decision) =>
  (decision.additionalContexts ?? []).filter((m) => m.source?.kind === 'jev-workflow-router-hook')

describe('jev-workflow-router-hook', () => {
  it('reminds once when openspec-propose loads, keeping the result', async () => {
    const { call } = setup()
    const downstream: Decision = { kind: 'accept', content: [{ type: 'text', text: 'skill body' }] }
    const out = await call({}, 'skill', { name: 'openspec-propose' }, downstream)
    expect(out.kind).toBe('accept')
    expect(out.content).toEqual(downstream.content)
    expect(reminders(out)).toHaveLength(1)
    const message = reminders(out)[0]
    expect(message.role).toBe('user')
    expect(message.source.form).toBe('notice')
    expect(message.content[0].text).toBe(REMINDER_TEXT)
  })

  it('treats bash `openspec new change` as a fallback trigger', async () => {
    const { call } = setup()
    const out = await call({}, 'bash', { description: 'x', command: 'openspec new change "x" && openspec status --change x' })
    expect(reminders(out)).toHaveLength(1)
  })

  it('stays silent after the router skill or a Jev tool was used', async () => {
    const { call } = setup()
    const a = {}
    await call(a, 'skill', { name: 'jev-workflow-router' })
    expect(reminders(await call(a, 'skill', { name: 'openspec-propose' }))).toHaveLength(0)
    const b = {}
    await call(b, 'mcp__magpie__mcp__jev__jev_classify', { items: [] })
    expect(reminders(await call(b, 'bash', { command: 'openspec new change y' }))).toHaveLength(0)
    const c = {}
    await call(c, 'mcp__jev__jev_decide', {})
    expect(reminders(await call(c, 'skill', { name: 'openspec-propose' }))).toHaveLength(0)
  })

  it('reminds each agent at most once, independently', async () => {
    const { call } = setup()
    const a = {}
    expect(reminders(await call(a, 'skill', { name: 'openspec-propose' }))).toHaveLength(1)
    expect(reminders(await call(a, 'bash', { command: 'openspec new change z' }))).toHaveLength(0)
    expect(reminders(await call({}, 'bash', { command: 'openspec new change z' }))).toHaveLength(1)
  })

  it('ignores unrelated calls and calls without an agent', async () => {
    const { call } = setup()
    const a = {}
    const downstream: Decision = { kind: 'accept' }
    expect(await call(a, 'skill', { name: 'openspec-apply-change' }, downstream)).toBe(downstream)
    expect(await call(a, 'bash', { command: 'openspec status' }, downstream)).toBe(downstream)
    expect(await call(a, 'bash', { command: 'echo openspec-new-changes' }, downstream)).toBe(downstream)
    expect(await call(undefined as any, 'skill', { name: 'openspec-propose' }, downstream)).toBe(downstream)
    expect(reminders(await call(a, 'skill', { name: 'openspec-propose' }))).toHaveLength(1)
  })

  it('preserves a downstream block and existing contexts, prepending its own', async () => {
    const { call } = setup()
    const other = { role: 'user', source: { kind: 'repeat-tool-reminder' } }
    const out = await call({}, 'skill', { name: 'openspec-propose' }, {
      kind: 'block', feedback: [{ type: 'text', text: 'no' }], additionalContexts: [other],
    })
    expect(out.kind).toBe('block')
    expect(out.feedback).toEqual([{ type: 'text', text: 'no' }])
    expect(out.additionalContexts).toHaveLength(2)
    expect(out.additionalContexts![0].source.kind).toBe('jev-workflow-router-hook')
    expect(out.additionalContexts![1]).toBe(other)
  })

  it('is silent when the router skill is not deployed or disabled by env', async () => {
    const missing = setup({ env: {}, skillDeployed: () => false })
    expect(reminders(await missing.call({}, 'skill', { name: 'openspec-propose' }))).toHaveLength(0)
    for (const value of ['1', 'TRUE', 'yes', 'On']) {
      const disabled = setup({ env: { DSH_JEV_WORKFLOW_ROUTER_DISABLED: value }, skillDeployed: () => true })
      expect(reminders(await disabled.call({}, 'skill', { name: 'openspec-propose' }))).toHaveLength(0)
    }
    expect(routerActive({ env: { DSH_JEV_WORKFLOW_ROUTER_DISABLED: 'no' }, skillDeployed: () => true })).toBe(true)
  })

  it('does not consume the one reminder while the router is switched off', async () => {
    let deployed = false
    const { call } = setup({ env: {}, skillDeployed: () => deployed })
    const a = {}
    expect(reminders(await call(a, 'skill', { name: 'openspec-propose' }))).toHaveLength(0)
    deployed = true
    expect(reminders(await call(a, 'skill', { name: 'openspec-propose' }))).toHaveLength(1)
  })
})
