import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import { credentialsMock } from './support/credentials.js'
import { deferred } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, memoryStore } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry(); vi.restoreAllMocks() })

for (const change of ['delete spare', 'save spare key', 'external spare key event'] as const) {
  test(`pending operation reselects after ${change} without an active generation change`, async () => {
    const a = line('https://a.example/v1', LINE_ID)
    const b = line('https://b.example/v1', LINE_ID_2)
    const credentials = credentialsMock('K1')
    const spareKey = lineCredentialRefs(LINE_ID_2).key
    credentials.setRef(String(spareKey), 'K2-old')
    const store = memoryStore([a, b])
    const entered = deferred(), gate = deferred<boolean>()
    let pauseNext = false
    const runtime = new MagpieRuntime(credentials.service, store, () => {}, {
      probe: async host => {
        if (pauseNext && host === 'a.example') {
          pauseNext = false
          entered.resolve()
          return gate.promise
        }
        return true
      },
    })
    cleanup.push(() => runtime.dispose())
    const request = vi.spyOn(runtime.transport, 'request').mockImplementation(async () => Response.json({ data: [] }))
    await runtime.start()
    const previous = runtime.current
    expect(previous.lineId).toBe(LINE_ID)
    request.mockClear()

    runtime.selector.invalidate()
    pauseNext = true
    const pending = runtime.beginOperation()
    try {
      // Probe starts only after both lines and their credentials have been captured.
      await entered.promise
      if (change === 'external spare key event') {
        credentials.setRef(String(spareKey), 'K2-new')
        runtime.invalidateCredential(spareKey)
      } else {
        const lines = change === 'delete spare' ? [a] : [a, { ...b, key: 'K2-new' }]
        expect((await runtime.settings({ lines })).status).toBe(200)
      }
      expect(runtime.current).toBe(previous)
      expect(store.value.lines).toEqual(change === 'delete spare' ? [a] : [a, b])
      expect(credentials.values.get(String(spareKey))).toBe(change === 'delete spare' ? undefined : 'K2-new')

      // Only the old selection sees A fail and B succeed after the save/event finishes.
      gate.resolve(false)
      const op = await pending
      try {
        if (change === 'delete spare') {
          expect(op).toMatchObject({ lineId: LINE_ID, baseUrl: a.baseUrl, key: 'K1' })
          expect(runtime.current).toBe(previous)
          expect(request).not.toHaveBeenCalled()
        } else {
          expect(op).toMatchObject({ lineId: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-new' })
          expect(runtime.current.lineId).toBe(LINE_ID_2)
          await runtime.current.syncPromise
          expect(request).toHaveBeenCalledTimes(1)
          expect(request.mock.calls[0]?.[0]).toMatchObject({ lineId: LINE_ID_2, baseUrl: b.baseUrl, key: 'K2-new' })
        }
        expect(op.gen).toBe(runtime.current)
      } finally { op.release() }
    } finally {
      gate.resolve(false)
      await pending.then(op => op.release(), () => {})
    }
  })
}

test('operation started during save validation also reselects after the credential write', async () => {
  const a = line('https://a.example/v1', LINE_ID)
  const b = line('https://b.example/v1', LINE_ID_2)
  const credentials = credentialsMock('K1')
  const spareKey = lineCredentialRefs(LINE_ID_2).key
  credentials.setRef(String(spareKey), 'K2-old')
  const validationEntered = deferred(), validationGate = deferred()
  const probeEntered = deferred(), probeGate = deferred<boolean>()
  let pauseNext = false
  const runtime = new MagpieRuntime(credentials.service, memoryStore([a, b]), () => {}, {
    probe: async host => {
      if (pauseNext && host === 'a.example') {
        pauseNext = false
        probeEntered.resolve()
        return probeGate.promise
      }
      return true
    },
  })
  cleanup.push(() => runtime.dispose())
  const request = vi.spyOn(runtime.transport, 'request').mockImplementation(async () => Response.json({ data: [] }))
  await runtime.start()
  const previous = runtime.current
  const describe = credentials.service.describe.bind(credentials.service)
  vi.spyOn(credentials.service, 'describe').mockImplementationOnce(async ref => {
    validationEntered.resolve()
    await validationGate.promise
    return describe(ref)
  })
  const save = runtime.settings({ lines: [a, { ...b, key: 'K2-new' }] })
  await validationEntered.promise
  runtime.selector.invalidate()
  pauseNext = true
  const pending = runtime.beginOperation()
  try {
    await probeEntered.promise
    validationGate.resolve()
    expect((await save).status).toBe(200)
    expect(runtime.current).toBe(previous)
    request.mockClear()
    probeGate.resolve(false)
    const op = await pending
    try {
      expect(op).toMatchObject({ lineId: LINE_ID_2, key: 'K2-new' })
      await runtime.current.syncPromise
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0]?.[0]).toMatchObject({ lineId: LINE_ID_2, key: 'K2-new' })
    } finally { op.release() }
  } finally {
    validationGate.resolve()
    probeGate.resolve(false)
    await save
    await pending.then(op => op.release(), () => {})
  }
})
