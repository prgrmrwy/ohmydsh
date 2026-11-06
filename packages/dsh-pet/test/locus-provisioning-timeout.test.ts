import { describe, expect, it, vi } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import type { LocusProvisioningKindV20 } from '../src/host/locus/contract-v20.js'
import { openPetHarness } from './harness.js'

const MINUTE = 60_000

/** The compensators a failed provisioning is cleaned with (same set startup recovery uses). */
interface Compensators {
  mainSession?: (input: { mainSessionId: string; operationId: string }) => Promise<void>
  locusMainSession?: (input: { locusMainSessionId: string; operationId: string }) => Promise<void>
  chat?: (input: { chatId: string; operationId: string }) => Promise<void>
}

/** Same atomic-write shim the other durable-repository tests use. */
function enableAtomicTransactions(harness: Awaited<ReturnType<typeof openPetHarness>>): void {
  if (harness.domain.supportsTransaction === true && typeof harness.domain.transaction === 'function') return
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: string, key: string, value: unknown): void
      delete(table: string, key: string): void
    }) => void) => Promise<void>
    table(name: string): {
      put(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<boolean>
    }
  }
  Object.defineProperty(domain, 'supportsTransaction', { value: true, configurable: true })
  domain.transaction = async body => {
    const writes: Array<{ kind: 'put' | 'delete'; table: string; key: string; value?: unknown }> = []
    body({
      put: (table, key, value) => { writes.push({ kind: 'put', table, key, value }) },
      delete: (table, key) => { writes.push({ kind: 'delete', table, key }) },
    })
    for (const write of writes) {
      if (write.kind === 'delete') await domain.table(write.table).delete(write.key)
      else await domain.table(write.table).put(write.key, write.value)
    }
  }
}

const ENDPOINT = { chatId: 'oc_stuck' }

/** An endpoint whose first creation failed at T0, leaving its locus main behind. */
async function failedAtT0(compensators: Compensators, kind: LocusProvisioningKindV20 = 'chat') {
  const harness = await openPetHarness()
  enableAtomicTransactions(harness)
  let clock = 1_000_000
  const repository = new LocusRepositoryV20(harness.domain as never, { now: () => clock })
  repository.setProvisioningCompensators(compensators)
  const diagnostics: string[] = []
  repository.setDiagnosticSink(message => diagnostics.push(message))
  await repository.beginProvisioning({
    provisioningId: 'provisioning-failed',
    kind,
    chatId: ENDPOINT.chatId,
    workSessionId: 'work-owner',
    startedAt: clock - 5,
  })
  // Only a `chat` operation creates the auto work session; rebind / migrate create just M1.
  if (kind === 'chat') await repository.recordProvisioningResource('provisioning-failed', { mainSessionId: 'session-work' })
  await repository.recordProvisioningResource('provisioning-failed', { locusMainSessionId: 'session-locus-main' })
  await repository.failProvisioning('provisioning-failed', 'establish space failed')
  // The failure time the 10-minute window is measured from.
  const T0 = (repository.getOperation('provisioning-failed') as { updatedAt: number }).updatedAt
  return { harness, repository, diagnostics, T0 }
}

function retry(repository: LocusRepositoryV20, at: number) {
  return repository.beginProvisioning({
    provisioningId: `provisioning-retry-${String(at)}`,
    kind: 'chat',
    chatId: ENDPOINT.chatId,
    startedAt: at,
  })
}

describe('provisioning 失败超时后不再阻塞', () => {
  it('超时后重试', async () => {
    const released: string[] = []
    const { harness, repository, T0 } = await failedAtT0({
      mainSession: async ({ mainSessionId }) => { released.push(`work:${mainSessionId}`) },
      locusMainSession: async ({ locusMainSessionId }) => { released.push(`locus-main:${locusMainSessionId}`) },
    })

    // t0 + 11 minutes: the compensator releases what the failed attempt left,
    // then the endpoint is established as if it had no stored creation debt.
    const operation = await retry(repository, T0 + 11 * MINUTE)

    expect(released).toEqual(['locus-main:session-locus-main', 'work:session-work'])
    expect(repository.getOperation('provisioning-failed')).toMatchObject({
      phase: 'compensated',
      compensatedResources: ['locus-main-session', 'main-session'],
    })
    expect(repository.getOperation('provisioning-retry-' + String(T0 + 11 * MINUTE))).toMatchObject({ phase: 'provisioning', endpointKey: ENDPOINT.chatId })
    expect(operation).toBeUndefined()
    await harness.close()
  })

  it.each(['chat', 'rebind', 'migrate'] as const)('compensates expired %s provisioning before retry', async kind => {
    const mainSession = vi.fn(async () => {})
    const locusMainSession = vi.fn(async () => {})
    const { harness, repository, T0 } = await failedAtT0({ mainSession, locusMainSession }, kind)
    try {
      await retry(repository, T0 + 11 * MINUTE)
      expect(locusMainSession).toHaveBeenCalledOnce()
      // Only a `chat` operation owns an auto work session; rebind / migrate reclaim M1 alone (D6, D7).
      expect(mainSession).toHaveBeenCalledTimes(kind === 'chat' ? 1 : 0)
      expect(repository.getOperation('provisioning-failed')?.phase).toBe('compensated')
    } finally { await harness.close() }
  })

  it('超时前仍阻塞', async () => {
    const mainSession = vi.fn(async () => {})
    const locusMainSession = vi.fn(async () => {})
    const { harness, repository, T0 } = await failedAtT0({ mainSession, locusMainSession })

    await expect(retry(repository, T0 + 5 * MINUTE)).rejects.toMatchObject({ code: 'LOCUS_CONFLICT' })

    expect(mainSession).not.toHaveBeenCalled()
    expect(locusMainSession).not.toHaveBeenCalled()
    expect(repository.getOperation('provisioning-failed')?.phase).toBe('failed')
    await harness.close()
  })

  it('补偿失败继续阻塞', async () => {
    let attempts = 0
    const { harness, repository, diagnostics, T0 } = await failedAtT0({
      mainSession: async () => {},
      locusMainSession: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('archive refused by host')
      },
    })

    await expect(retry(repository, T0 + 11 * MINUTE)).rejects.toMatchObject({ code: 'LOCUS_CONFLICT' })

    // Nothing new was established, the original error is on record, and the
    // operation is still the failed one — not parked as manual debt.
    expect(repository.getOperation('provisioning-failed')).toMatchObject({
      phase: 'failed',
      lastError: 'archive refused by host',
      updatedAt: T0,
    })
    expect(repository.getOperation('provisioning-retry-' + String(T0 + 11 * MINUTE))).toBeUndefined()
    expect(diagnostics.some(message => message.includes('archive refused by host'))).toBe(true)

    // The next request tries the compensation again and, now that it works,
    // the endpoint is free.
    await retry(repository, T0 + 12 * MINUTE)
    expect(attempts).toBe(2)
    expect(repository.getOperation('provisioning-retry-' + String(T0 + 12 * MINUTE))?.phase).toBe('provisioning')
    expect(repository.getOperation('provisioning-failed')?.phase).toBe('compensated')
    await harness.close()
  })
})
