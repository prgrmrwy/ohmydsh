import { describe, expect, it, vi } from 'vitest'
import {
  adaptLocusInboxPort,
  createLocusChildAdapter,
  LOCUS_CHILD_PROVIDER,
  LOCUS_QUEUE_PROMPT_SYMBOL,
  probeLocusChildPorts,
  resolveLocusParent,
  type LocusChildIdentity,
  type LocusChildSettlementPort,
  type LocusLiveParent,
  type LocusParentPort,
  type LocusSubagentPort,
} from '../src/host/locus/child.js'

const PARENT_ID = 'session-parent'
const CHILD_ID = 'session-child'

function parent(id = PARENT_ID): LocusLiveParent {
  return { session: { id } }
}

function parentPort(options: {
  resident?: LocusLiveParent
  resumed?: LocusLiveParent
  resumeThrows?: boolean
} = {}): LocusParentPort {
  return {
    get: vi.fn(() => options.resident),
    resume: vi.fn(async () => {
      if (options.resumeThrows === true) throw new Error('not resumable')
      return options.resumed === undefined ? undefined : { agent: options.resumed }
    }),
  }
}

function subagentPort(
  start: LocusSubagentPort['startContinuable'] = async spec => ({
    childId: spec.childId ?? CHILD_ID,
  }),
  options: { readonly supportsSettlementNotice?: boolean } = {},
): LocusSubagentPort {
  return {
    startContinuable: vi.fn(start),
    supportsSettlementNotice: options.supportsSettlementNotice ?? true,
  }
}

function inboxPort(
  queue: (
    parent: LocusLiveParent,
    childId: string,
    prompt: { type: 'text'; text: string }[],
    source: { kind: 'user' },
    signal: AbortSignal,
  ) => Promise<string> = async () => 'message-1',
) {
  return { queuePrompt: vi.fn(queue) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushLifecycle(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('generic locus child adapter', () => {
  it('resolves a resident parent and preserves the exact live object', async () => {
    const live = parent()
    const result = await resolveLocusParent(parentPort({ resident: live }), PARENT_ID)

    expect(result).toEqual({ ok: true, parent: live })
    expect(result.ok && result.parent).toBe(live)
  })

  it('resumes a non-resident parent and rejects a wrong resumed identity', async () => {
    const live = parent()
    const port = parentPort({ resumed: live })
    const result = await resolveLocusParent(port, PARENT_ID)

    expect(result).toEqual({ ok: true, parent: live })
    expect(port.resume).toHaveBeenCalledWith({ resumeSessionId: PARENT_ID })

    const wrong = await resolveLocusParent(parentPort({ resumed: parent('session-other') }), PARENT_ID)
    expect(wrong).toEqual({ ok: false, reason: 'parent-unavailable' })
  })

  it('fails closed when parent resume throws or returns no agent', async () => {
    await expect(resolveLocusParent(parentPort({ resumeThrows: true }), PARENT_ID)).resolves.toEqual({
      ok: false,
      reason: 'parent-unavailable',
    })
    await expect(resolveLocusParent(parentPort(), PARENT_ID)).resolves.toEqual({
      ok: false,
      reason: 'parent-unavailable',
    })
    await expect(resolveLocusParent(parentPort(), '')).resolves.toEqual({
      ok: false,
      reason: 'invalid-parent-id',
    })
  })

  it('creates one child with startContinuable and exposes only its active identity', async () => {
    const live = parent()
    const start = subagentPort()
    const inbox = inboxPort()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: live }),
      subagent: start,
      inbox,
    })

    const created = await adapter.createChild({
      parentSessionId: PARENT_ID,
      label: '项目话题 child',
      prompt: 'initialize locus',
    })

    expect(created).toEqual({
      ok: true,
      created: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    expect(start.startContinuable).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: LOCUS_CHILD_PROVIDER,
        label: '项目话题 child',
        request: {
          prompt: [{ type: 'text', text: 'initialize locus' }],
          parent: live,
        },
        // A locus child answers in its own Feishu entry, so the runtime must
        // not push its settlement account into the main session.
        settlementNotice: 'silent',
      }),
    )
    expect(adapter.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })
    expect(adapter.activeChild).not.toHaveProperty('parent')

    const repeated = await adapter.createChild({
      parentSessionId: PARENT_ID,
      label: 'ignored label',
      prompt: 'ignored prompt',
    })
    expect(repeated).toEqual({
      ok: true,
      created: false,
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    expect(start.startContinuable).toHaveBeenCalledTimes(1)
  })

  it('refuses to create a child on a runtime that cannot suppress the parent account', async () => {
    for (const supportsSettlementNotice of [false, undefined]) {
      const start: LocusSubagentPort = {
        startContinuable: vi.fn(async spec => ({ childId: spec.childId ?? CHILD_ID })),
        // `undefined` is the unknown case: an old runtime exposes no such flag.
        ...(supportsSettlementNotice === undefined ? {} : { supportsSettlementNotice }),
      }
      const adapter = createLocusChildAdapter({
        parent: parentPort({ resident: parent() }),
        subagent: start,
        inbox: inboxPort(),
      })

      // Fail closed BEFORE creation: conclusions written into the parent's log
      // cannot be retracted, so an unproven capability must not be attempted.
      await expect(adapter.createChild({
        parentSessionId: PARENT_ID,
        label: 'child',
        prompt: 'seed',
      })).resolves.toEqual({ ok: false, reason: 'settlement-notice-unsupported' })
      expect(start.startContinuable).not.toHaveBeenCalled()
      expect(adapter.activeChild).toBeUndefined()
    }
  })

  it('rejects a second parent while an active child exists', async () => {
    const start = subagentPort()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: start,
      inbox: inboxPort(),
    })
    await adapter.createChild({ parentSessionId: PARENT_ID, label: 'one', prompt: 'one' })

    const result = await adapter.createChild({
      parentSessionId: 'session-other',
      label: 'two',
      prompt: 'two',
    })
    expect(result).toEqual({ ok: false, reason: 'active-child-conflict' })
    expect(start.startContinuable).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight create and fences adopt until create publishes', async () => {
    const gate = deferred<{ childId: string }>()
    const start = subagentPort(async () => gate.promise)
    const proof = { findChild: vi.fn(async () => ({ parentSessionId: PARENT_ID, childSessionId: 'persisted-child' })) }
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: start,
      inbox: inboxPort(),
      proof,
    })

    const first = adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    const second = adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    const adoption = adapter.adoptChild({ parentSessionId: PARENT_ID, childSessionId: 'persisted-child' })
    await flushLifecycle()
    expect(start.startContinuable).toHaveBeenCalledTimes(1)
    gate.resolve({ childId: CHILD_ID })
    await expect(first).resolves.toEqual({
      ok: true,
      created: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    // Preserve the existing same in-flight request semantics: both callers
    // observe the original create result, while only one host child is made.
    await expect(second).resolves.toEqual({
      ok: true,
      created: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    await expect(adoption).resolves.toEqual({ ok: false, reason: 'active-child-conflict' })
    expect(proof.findChild).not.toHaveBeenCalled()
  })

  it('does not publish a child when disposed while creation is in flight', async () => {
    const gate = deferred<{ childId: string }>()
    const release = vi.fn(async () => undefined)
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(async () => gate.promise),
      inbox: inboxPort(),
      compensation: { release },
    })

    const pending = adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    await flushLifecycle()
    adapter.dispose()
    gate.resolve({ childId: CHILD_ID })

    await expect(pending).resolves.toEqual({ ok: false, reason: 'adapter-disposed' })
    expect(adapter.activeChild).toBeUndefined()
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ parent: parent(), childId: CHILD_ID }),
    )
  })

  it('does not report a queued prompt after its signal aborts', async () => {
    const gate = deferred<string>()
    const controller = new AbortController()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(async () => gate.promise),
    })
    const created = await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    if (!created.ok) throw new Error('expected child')

    const pending = adapter.queuePrompt({ text: 'request', identity: created.identity, signal: controller.signal })
    await flushLifecycle()
    controller.abort()
    gate.resolve('message-late')

    await expect(pending).resolves.toEqual({ ok: false, reason: 'aborted' })
  })

  it('requires direct-child proof before adopting a persisted child', async () => {
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
    })
    await expect(adapter.adoptChild({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })).resolves.toEqual({
      ok: false,
      reason: 'child-proof-unavailable',
    })

    const adopted = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      proof: {
        findChild: vi.fn(async (parentSessionId, childSessionId) => ({ parentSessionId, childSessionId })),
      },
    })
    await expect(adopted.adoptChild({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })).resolves.toEqual({
      ok: true,
      adopted: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    expect(adopted.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })
  })

  it('uses the continuation owner to expose only the exact adopted child Session', async () => {
    const liveParent = parent()
    const session = { id: CHILD_ID, header: { parentSession: PARENT_ID } }
    const access = vi.fn(async (
      spec: { parent: LocusLiveParent; childId: string },
      operation: (candidate: unknown) => unknown,
    ) => operation(session))
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: liveParent }),
      subagent: {
        ...subagentPort(),
        supportsLiveContinuableChildSession: true,
        withLiveContinuableChildSession: access,
      },
      inbox: inboxPort(),
      proof: {
        findChild: vi.fn(async (parentSessionId, childSessionId) => ({ parentSessionId, childSessionId })),
      },
    })
    const identity = { parentSessionId: PARENT_ID, childSessionId: CHILD_ID }
    await adapter.adoptChild(identity)

    await expect(adapter.withChildSession({
      identity,
      operation: candidate => (candidate as typeof session).id,
    })).resolves.toEqual({ ok: true, value: CHILD_ID, identity })
    expect(access).toHaveBeenCalledWith(
      { parent: liveParent, childId: CHILD_ID, signal: expect.any(AbortSignal) },
      expect.any(Function),
    )

    await expect(adapter.withChildSession({
      identity: { parentSessionId: 'other-parent', childSessionId: CHILD_ID },
      operation: () => 'must not run',
    })).resolves.toEqual({ ok: false, reason: 'child-identity-mismatch' })
    expect(access).toHaveBeenCalledTimes(1)
  })

  it('keeps child Session access unavailable without the literal runtime marker', async () => {
    const access = vi.fn(async () => 'unsafe')
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: { ...subagentPort(), withLiveContinuableChildSession: access },
      inbox: inboxPort(),
      proof: {
        findChild: vi.fn(async (parentSessionId, childSessionId) => ({ parentSessionId, childSessionId })),
      },
    })
    const identity = { parentSessionId: PARENT_ID, childSessionId: CHILD_ID }
    await adapter.adoptChild(identity)

    await expect(adapter.withChildSession({ identity, operation: () => 'unsafe' }))
      .resolves.toEqual({ ok: false, reason: 'child-session-access-unsupported' })
    expect(access).not.toHaveBeenCalled()
  })

  it('rejects a proof that belongs to another parent or cannot find the child', async () => {
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      proof: { findChild: vi.fn(async () => undefined) },
    })
    await expect(adapter.adoptChild({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })).resolves.toEqual({
      ok: false,
      reason: 'child-not-found',
    })

    const mismatch = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      proof: {
        findChild: vi.fn(async () => ({ parentSessionId: 'other-parent', childSessionId: CHILD_ID })),
      },
    })
    await expect(mismatch.adoptChild({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })).resolves.toEqual({
      ok: false,
      reason: 'child-parent-mismatch',
    })
  })

  it('rejects create while compensation is queued for the active child', async () => {
    const releaseGate = deferred<void>()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      compensation: { release: vi.fn(async () => releaseGate.promise) },
    })
    const created = await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    if (!created.ok) throw new Error('expected child')

    const releasing = adapter.compensateChild({ identity: created.identity })
    await flushLifecycle()
    await expect(
      adapter.createChild({ parentSessionId: PARENT_ID, label: 'replacement', prompt: 'replacement' }),
    ).resolves.toEqual({ ok: false, reason: 'active-child-conflict' })

    releaseGate.resolve()
    await expect(releasing).resolves.toEqual({ ok: true, identity: created.identity })
  })

  it('rejects create while adoption is proving a persisted child', async () => {
    const proofGate = deferred<LocusChildIdentity | undefined>()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      proof: { findChild: vi.fn(async () => proofGate.promise) },
    })
    const adopting = adapter.adoptChild({ parentSessionId: PARENT_ID, childSessionId: 'persisted-child' })
    await flushLifecycle()

    await expect(
      adapter.createChild({ parentSessionId: PARENT_ID, label: 'new-child', prompt: 'new-child' }),
    ).resolves.toEqual({ ok: false, reason: 'active-child-conflict' })

    proofGate.resolve({ parentSessionId: PARENT_ID, childSessionId: 'persisted-child' })
    await expect(adopting).resolves.toEqual({
      ok: true,
      adopted: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: 'persisted-child' },
    })
  })

  it('allows a failed create to retry immediately after the failure settles', async () => {
    let attempts = 0
    const start = subagentPort(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transient host failure')
      return { childId: CHILD_ID }
    })
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: start,
      inbox: inboxPort(),
    })

    await expect(adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })).resolves.toEqual({
      ok: false,
      reason: 'child-create-failed',
    })
    await expect(adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })).resolves.toEqual({
      ok: true,
      created: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    expect(start.startContinuable).toHaveBeenCalledTimes(2)
  })

  it('falls back to subscribe when onChildSettled is malformed', async () => {
    let emit: ((event: { id: string }) => void) | undefined
    const subscribe = vi.fn((callback: (event: { id: string }) => void) => {
      emit = callback
      return () => undefined
    })
    const settlement = {
      onChildSettled: 'not-a-function',
      subscribe,
    } as unknown as LocusChildSettlementPort
    const listener = vi.fn()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      settlement,
    })
    adapter.onActivationSettled(listener)
    await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    emit?.({ id: CHILD_ID })

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
  })

  it('queues a host-authored prompt through the active child inbox', async () => {
    const live = parent()
    const inbox = inboxPort()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: live }),
      subagent: subagentPort(),
      inbox,
    })
    const created = await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    if (!created.ok) throw new Error('expected child')

    const queued = await adapter.queuePrompt({ text: 'current request', identity: created.identity })
    expect(queued).toEqual({
      ok: true,
      messageId: 'message-1',
      identity: created.identity,
    })
    expect(inbox.queuePrompt).toHaveBeenCalledWith(
      live,
      CHILD_ID,
      [{ type: 'text', text: 'current request' }],
      { kind: 'user' },
      expect.any(AbortSignal),
    )
  })

  it('rejects stale queue identity and queue failures without changing active identity', async () => {
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(async () => {
        throw new Error('inbox unavailable')
      }),
    })
    await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })

    const stale: LocusChildIdentity = {
      parentSessionId: PARENT_ID,
      childSessionId: 'session-old-child',
    }
    expect(await adapter.queuePrompt({ text: 'request', identity: stale })).toEqual({
      ok: false,
      reason: 'child-identity-mismatch',
    })
    expect(await adapter.queuePrompt({ text: 'request' })).toEqual({
      ok: false,
      reason: 'inbox-failed',
    })
    expect(adapter.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })
  })

  it('uses injected compensation and only clears identity after release succeeds', async () => {
    const release = vi.fn(async () => undefined)
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      compensation: { release },
    })
    const created = await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    if (!created.ok) throw new Error('expected child')

    expect(await adapter.compensateChild({ identity: created.identity, reason: 'publish failed' })).toEqual({
      ok: true,
      identity: created.identity,
    })
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: parent(),
        childId: CHILD_ID,
        reason: 'publish failed',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(adapter.activeChild).toBeUndefined()
  })

  it('keeps identity when compensation is absent or fails', async () => {
    const withoutPort = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
    })
    await withoutPort.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    expect(await withoutPort.compensateChild()).toEqual({
      ok: false,
      reason: 'compensation-unavailable',
    })
    expect(withoutPort.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })

    const failedRelease = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      compensation: { release: vi.fn(async () => { throw new Error('no release') }) },
    })
    await failedRelease.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    expect(await failedRelease.compensateChild()).toEqual({
      ok: false,
      reason: 'compensation-failed',
    })
    expect(failedRelease.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })
  })

  it('observes activation settlement only for the active child, not every delivery', async () => {
    let emit: ((event: { id: string; stopReason?: string }) => void) | undefined
    const listener = vi.fn()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parent() }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      settlement: {
        onChildSettled: callback => {
          emit = callback
          return () => undefined
        },
      },
    })
    adapter.onActivationSettled(listener)
    await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })

    emit?.({ id: 'some-other-child', stopReason: 'completed' })
    expect(listener).not.toHaveBeenCalled()
    expect(adapter.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })

    emit?.({ id: CHILD_ID, stopReason: 'completed' })
    expect(listener).toHaveBeenCalledWith({
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
      stopReason: 'completed',
    })
    // `subagent/end` ends an activation epoch, not the durable continuable
    // child.  The identity remains available for a later cold-resumed turn.
    expect(adapter.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })
    expect(await adapter.queuePrompt({ text: 'after activation end' })).toEqual({
      ok: true,
      messageId: 'message-1',
      identity: { parentSessionId: PARENT_ID, childSessionId: CHILD_ID },
    })
    // A lifecycle event does not synthesize or settle a delivery record.
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify the parent and disposal only removes lifecycle observation', async () => {
    let emit: ((event: { id: string }) => void) | undefined
    const parentAgent = parent()
    const onParent = vi.fn()
    const adapter = createLocusChildAdapter({
      parent: parentPort({ resident: parentAgent }),
      subagent: subagentPort(),
      inbox: inboxPort(),
      settlement: {
        subscribe: callback => {
          emit = callback as (event: { id: string }) => void
          return () => undefined
        },
      },
    })
    await adapter.createChild({ parentSessionId: PARENT_ID, label: 'child', prompt: 'seed' })
    adapter.dispose()
    emit?.({ id: CHILD_ID })

    expect(onParent).not.toHaveBeenCalled()
    expect(adapter.activeChild).toEqual({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID })
    expect(await adapter.queuePrompt({ text: 'after dispose' })).toEqual({
      ok: false,
      reason: 'adapter-disposed',
    })
  })
})

describe('the measured symbol-keyed inbox adapter', () => {
  it('probes required host seams without making them hard dependencies', () => {
    expect(probeLocusChildPorts({ get: () => undefined })).toEqual({
      available: false,
      diagnostic: 'parent-service-unavailable',
    })
  })

  it('fails closed when the host service has no queue symbol', () => {
    expect(adaptLocusInboxPort({})).toBeUndefined()
    expect(adaptLocusInboxPort(undefined)).toBeUndefined()
  })

  it('prefers the runtime package helper over the symbol lookup', async () => {
    const calls: unknown[] = []
    const service = {
      [LOCUS_QUEUE_PROMPT_SYMBOL]: async () => 'from-symbol',
    }
    // The runtime's own package owns the argument contract, so when the exact
    // helper is supplied it must be used instead of the loose symbol call.
    const port = adaptLocusInboxPort(service, async (...args: unknown[]) => {
      calls.push(args)
      return 'from-helper'
    })

    await expect(port!.queuePrompt(
      parent(),
      CHILD_ID,
      [{ type: 'text', text: 'hello' }],
      { kind: 'user' },
      new AbortController().signal,
    )).resolves.toBe('from-helper')
    expect(calls[0]?.[0]).toBe(service)
    expect(calls[0]?.[2]).toBe(CHILD_ID)
  })

  it('binds the process-stable queue symbol without importing DSH internals', async () => {
    const calls: unknown[] = []
    const service = {
      [LOCUS_QUEUE_PROMPT_SYMBOL]: async (...args: unknown[]) => {
        calls.push(args)
        return 'message-symbol'
      },
    }
    const port = adaptLocusInboxPort(service)
    expect(port).toBeDefined()
    const result = await port!.queuePrompt(
      parent(),
      CHILD_ID,
      [{ type: 'text', text: 'hello' }],
      { kind: 'user' },
      new AbortController().signal,
    )
    expect(result).toBe('message-symbol')
    expect(calls[0]).toEqual([
      parent(),
      CHILD_ID,
      [{ type: 'text', text: 'hello' }],
      { kind: 'user' },
      expect.any(AbortSignal),
    ])
  })
})

describe('probed host child seams', () => {
  /** A host exposing every seam the probe requires. */
  function hostCtx(overrides: {
    readonly sessionController?: unknown
    readonly children?: readonly unknown[]
    /** Literal capability marker from the runtime actually loaded. */
    readonly supportsSettlementNotice?: boolean
    readonly supportsIdleContinuableCreate?: boolean
    readonly supportsLiveContinuableChildSession?: boolean
  } = {}) {
    const services: Record<string, unknown> = {
      // A resident parent, so a creation test exercises the capability gate
      // rather than stopping at parent resolution.
      agents: { get: (id: string) => (id === PARENT_ID ? parent() : undefined), resume: async () => undefined },
      subagents: {
        startContinuable: async () => ({ childId: CHILD_ID }),
        createIdleContinuable: async (spec: { childId: string }) => ({ childId: spec.childId }),
        withLiveContinuableChildSession: async (
          _spec: unknown,
          operation: (session: unknown) => unknown,
        ) => operation({ id: CHILD_ID }),
        listChildren: async () => overrides.children ?? [],
        ...(overrides.supportsSettlementNotice === true
          ? { supportsSettlementNotice: true }
          : {}),
        ...(overrides.supportsIdleContinuableCreate === true
          ? { supportsIdleContinuableCreate: true }
          : {}),
        ...(overrides.supportsLiveContinuableChildSession === true
          ? { supportsLiveContinuableChildSession: true }
          : {}),
        [LOCUS_QUEUE_PROMPT_SYMBOL]: async () => 'message-1',
      },
      ...(overrides.sessionController === undefined
        ? {}
        : { sessionController: overrides.sessionController }),
    }
    return { get: (name: string) => services[name], on: () => () => {} }
  }

  it('resumes the main session through the session controller, not a bare resume', async () => {
    const resolveAgent = vi.fn(() => ({ agent: parent() }))
    const probe = probeLocusChildPorts(hostCtx({ sessionController: { resolveAgent } }))
    expect(probe.available).toBe(true)

    const resumed = probe.available
      ? await probe.ports.parent.resume({ resumeSessionId: PARENT_ID })
      : undefined

    // A bare `agents.resume()` returns a parent whose composition was never
    // mounted; the controller path reconstructs the persisted preset.
    expect(resolveAgent).toHaveBeenCalledWith(PARENT_ID)
    expect(resumed?.agent).toEqual(parent())
  })

  it('treats a controller refusal and an absent controller as no parent', async () => {
    const refused = probeLocusChildPorts(hostCtx({
      sessionController: { resolveAgent: () => ({ error: 'not resumable' }) },
    }))
    await expect(refused.available
      ? refused.ports.parent.resume({ resumeSessionId: PARENT_ID })
      : undefined).resolves.toBeUndefined()

    // Without the controller, resume stays unavailable rather than falling
    // back to a path that yields an uncomposed parent.
    const bare = probeLocusChildPorts(hostCtx())
    await expect(bare.available
      ? bare.ports.parent.resume({ resumeSessionId: PARENT_ID })
      : undefined).resolves.toBeUndefined()
  })

  it('adapts continuation-owned child Session access only with its runtime marker', async () => {
    const marked = probeLocusChildPorts(hostCtx({ supportsLiveContinuableChildSession: true }))
    expect(marked.available && marked.ports.subagent.supportsLiveContinuableChildSession).toBe(true)
    await expect(marked.available
      ? marked.ports.subagent.withLiveContinuableChildSession?.(
        { parent: parent(), childId: CHILD_ID, signal: new AbortController().signal },
        session => (session as { id: string }).id,
      )
      : undefined).resolves.toBe(CHILD_ID)

    const unmarked = probeLocusChildPorts(hostCtx())
    expect(unmarked.available && unmarked.ports.subagent.supportsLiveContinuableChildSession).toBeUndefined()
  })

  it('creates a child once the loaded runtime proves it can suppress the parent report', async () => {
    // The literal belongs to the runtime instance the Host actually loaded.
    // An official older runtime has no marker, even though JavaScript would
    // accept and silently ignore an unknown `settlementNotice` field.
    const probe = probeLocusChildPorts(hostCtx({ supportsSettlementNotice: true }))
    expect(probe.available).toBe(true)
    expect(probe.available && probe.ports.subagent.supportsSettlementNotice).toBe(true)

    const adapter = createLocusChildAdapter(probe.available ? probe.ports : ({} as never))
    await expect(adapter.createChild({
      parentSessionId: PARENT_ID,
      label: 'locus child',
      prompt: 'seed',
    })).resolves.toMatchObject({ ok: true, created: true })
  })

  it('creates an idle child only when the loaded runtime publishes both markers', async () => {
    const probe = probeLocusChildPorts(hostCtx({
      supportsSettlementNotice: true,
      supportsIdleContinuableCreate: true,
    }))
    expect(probe.available).toBe(true)
    const adapter = createLocusChildAdapter(probe.available ? probe.ports : ({} as never))

    await expect(adapter.createIdleChild({
      parentSessionId: PARENT_ID,
      childId: 'child-reserved',
      label: 'locus child',
    })).resolves.toMatchObject({
      ok: true,
      created: true,
      identity: { parentSessionId: PARENT_ID, childSessionId: 'child-reserved' },
    })
  })

  it('keeps idle creation unavailable when only settlement silence is supported', async () => {
    const probe = probeLocusChildPorts(hostCtx({ supportsSettlementNotice: true }))
    expect(probe.available).toBe(true)
    const adapter = createLocusChildAdapter(probe.available ? probe.ports : ({} as never))

    await expect(adapter.createIdleChild({
      parentSessionId: PARENT_ID,
      childId: 'child-reserved',
      label: 'locus child',
    })).resolves.toEqual({ ok: false, reason: 'idle-child-create-unsupported' })
  })

  it('keeps creation unavailable while that capability is unproven', async () => {
    // Exactly the pinned runtime's state: the seams exist, the suppression
    // option does not.
    const probe = probeLocusChildPorts(hostCtx())
    expect(probe.available && probe.ports.subagent.supportsSettlementNotice).toBeUndefined()

    const adapter = createLocusChildAdapter(probe.available ? probe.ports : ({} as never))
    await expect(adapter.createChild({
      parentSessionId: PARENT_ID,
      label: 'locus child',
      prompt: 'seed',
    })).resolves.toEqual({ ok: false, reason: 'settlement-notice-unsupported' })
  })

  it('accepts a persisted child only when it is a continuable child', async () => {
    const cases = [
      { row: { id: CHILD_ID, kind: 'child', mode: 'continuable' }, adopted: true },
      // Diagnostics and one-shot runs appear in the same listing and carry an
      // id too; adopting one would bind a locus to a child that can never
      // take another turn.
      { row: { id: CHILD_ID, kind: 'diagnostic', mode: 'continuable' }, adopted: false },
      { row: { id: CHILD_ID, kind: 'child', mode: 'one-shot' }, adopted: false },
      // A runtime that reports neither field is accepted on id alone, which
      // is all the evidence it offers.
      { row: { id: CHILD_ID }, adopted: true },
    ] as const

    for (const { row, adopted } of cases) {
      const probe = probeLocusChildPorts(hostCtx({ children: [row] }))
      const found = probe.available
        ? await probe.ports.proof?.findChild(PARENT_ID, CHILD_ID)
        : undefined
      expect(found === undefined).toBe(!adopted)
    }
  })
})
