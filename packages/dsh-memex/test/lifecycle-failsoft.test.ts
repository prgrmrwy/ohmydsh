import { describe, expect, it, vi } from 'vitest'

// Its own file because the module mock is file-wide: only the message
// constructor is made to fail, everything else stays real.
const failures = vi.hoisted(() => ({ next: false }))
vi.mock('@deepseek-ai/dsh-llm/message', async importOriginal => {
  const real = await importOriginal<typeof import('@deepseek-ai/dsh-llm/message')>()
  return {
    ...real,
    createUserMessage: (input: Parameters<typeof real.createUserMessage>[0]) => {
      if (failures.next) throw new Error('cannot build message')
      return real.createUserMessage(input)
    },
  }
})

const { registerMemexLifecycle } = await import('../src/lifecycle/index.js')

function fixture() {
  const listeners = new Map<string, (...args: any[]) => any>()
  const warnings: string[] = []
  const session = { header: { cwd: '/work/repo' } }
  const agent = { session, inject: () => undefined }
  const ctx = {
    on(name: string, listener: (...args: any[]) => any) { listeners.set(name, listener); return () => listeners.delete(name) },
    logger: () => ({ warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) } }),
  }
  const scopes = { resolve: () => ({ scope: 'repo', home: '/m', publish: 'internal', publishKnown: true, memory: true, source: 'derived', created: false, workspacePaths: [] }) }
  const userInput = { id: 'user-input', source: { kind: 'user' } }
  const stopping = (turn: number) => listeners.get('agent/turn-stopping')!({ agent, turn, signal: new AbortController().signal })
  const preStep = (turn: number): Promise<{ kind: string; messages: any[] }> => listeners.get('agent/pre-step')!(
    { agent, messages: [], turn, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [userInput] }),
  )
  return { ctx, scopes, session, warnings, userInput, stopping, preStep }
}

describe('a write reminder that cannot be built', () => {
  it('costs only the reminder: the step goes ahead untouched, the failure is logged, and it is offered again next turn', async () => {
    const f = fixture()
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    lifecycle.mark('recall', f.session)
    f.stopping(1)

    failures.next = true
    let decision: { kind: string; messages: any[] } | undefined
    try { decision = await f.preStep(2) } finally { failures.next = false }
    // The user's step is exactly what the rest of the chain admitted.
    expect(decision).toEqual({ kind: 'enter', messages: [f.userInput] })
    expect(f.warnings.some(line => line.includes('Could not build memex write reminder'))).toBe(true)

    // Nothing was spent: the reminder is still owed, so the next turn close schedules it again.
    f.stopping(2)
    const retried = await f.preStep(3)
    expect(retried.messages).toHaveLength(2)
    expect(retried.messages[1].source).toMatchObject({ plugin: 'dsh-memex', form: 'notice' })
  })
})
