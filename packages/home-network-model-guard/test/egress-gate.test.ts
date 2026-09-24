import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { GuardCheckResult } from '../src/contract.js'
import { createEgressGate, EgressRestrictedError } from '../src/egress-gate.js'
import type { NetworkVerdict } from '../src/contract.js'

function resultOf(verdict: NetworkVerdict): GuardCheckResult {
  return verdict === 'unknown'
    ? { verdict, degraded: true, degradedReason: 'fetch-failed' }
    : { verdict, sampledAt: 1_000, freshForMs: 60_000, degraded: false }
}

function passthroughStream(): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'text-delta', index: 0, text: 'ok' } satisfies StreamChunk
  })()
}

const CLAUDE_OPTIONS = { provider: 'claude', model: 'claude-sonnet-4-5' }
const OTHER_OPTIONS = { provider: 'deepseek', model: 'deepseek-chat' }

async function consume(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

describe('createEgressGate', () => {
  it('passes Claude through when the verdict is allowed', async () => {
    const check = vi.fn(async () => resultOf('allowed'))
    const gate = createEgressGate(check)
    const next = vi.fn(passthroughStream)
    const chunks = await consume(gate(CLAUDE_OPTIONS as never, next))
    expect(next).toHaveBeenCalledTimes(1)
    expect(chunks).toHaveLength(1)
  })

  it('rejects Claude on blocked egress without calling next()', async () => {
    const check = vi.fn(async () => resultOf('blocked'))
    const gate = createEgressGate(check)
    const next = vi.fn(passthroughStream)
    await expect(consume(gate(CLAUDE_OPTIONS as never, next))).rejects.toBeInstanceOf(EgressRestrictedError)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects Claude on unknown egress without calling next() (fail closed)', async () => {
    const check = vi.fn(async () => resultOf('unknown'))
    const gate = createEgressGate(check)
    const next = vi.fn(passthroughStream)
    await expect(consume(gate(CLAUDE_OPTIONS as never, next))).rejects.toThrow(/restricted/)
    expect(next).not.toHaveBeenCalled()
  })

  it('passes non-Claude calls through untouched even when restricted', async () => {
    const check = vi.fn(async () => resultOf('blocked'))
    const gate = createEgressGate(check)
    const next = vi.fn(passthroughStream)
    const chunks = await consume(gate(OTHER_OPTIONS as never, next))
    expect(next).toHaveBeenCalledTimes(1)
    expect(check).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(1)
  })

  it('reports refusals to the diagnostic observer with sanitized fields only', async () => {
    const observed: unknown[][] = []
    const check = vi.fn(async () => resultOf('unknown'))
    const gate = createEgressGate(check, (...args) => { observed.push(args) })
    await expect(consume(gate(CLAUDE_OPTIONS as never, vi.fn(passthroughStream)))).rejects.toThrow()
    expect(observed).toEqual([['unknown', 'fetch-failed']])
    const serialized = JSON.stringify(observed)
    expect(serialized).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/) // no IP
    expect(serialized).not.toMatch(/https?:/) // no endpoint
  })

  it('does not invoke the observer for allowed or non-Claude calls', async () => {
    const onReject = vi.fn()
    const allowedGate = createEgressGate(async () => resultOf('allowed'), onReject)
    await consume(allowedGate(CLAUDE_OPTIONS as never, vi.fn(passthroughStream)))
    const blockedGate = createEgressGate(async () => resultOf('blocked'), onReject)
    await consume(blockedGate(OTHER_OPTIONS as never, vi.fn(passthroughStream)))
    expect(onReject).not.toHaveBeenCalled()
  })

  it('still refuses when the observer throws — diagnostics never change the outcome', async () => {
    const next = vi.fn(passthroughStream)
    const gate = createEgressGate(async () => resultOf('blocked'), () => { throw new Error('log sink down') })
    await expect(consume(gate(CLAUDE_OPTIONS as never, next))).rejects.toBeInstanceOf(EgressRestrictedError)
    expect(next).not.toHaveBeenCalled()
  })

  it('error text never leaks verdict internals beyond the stable marker', async () => {
    const check = vi.fn(async () => resultOf('unknown'))
    const gate = createEgressGate(check)
    try {
      await consume(gate(CLAUDE_OPTIONS as never, vi.fn(passthroughStream)))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      expect(message).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/) // no IP
      expect(message).toContain('restricted')
      return
    }
    throw new Error('gate did not reject')
  })
})