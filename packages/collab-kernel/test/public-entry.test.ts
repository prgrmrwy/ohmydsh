import { expect, it } from 'vitest'
import * as api from '../src/index.js'

it('public package entry offers the library without exposing unauthorised convention or dispatch writers', () => {
  expect(api.CollabService).toBeTypeOf('function')
  expect(api.FileStore).toBeTypeOf('function')
  expect(api.project).toBeTypeOf('function')
  expect(api.principals.agent).toBeTypeOf('function')
  for (const name of ['readConvention', 'canonical', 'canonicalJson', 'recordDispatch', 'appendEvent', 'COMMANDS']) expect(api).not.toHaveProperty(name)
})
import { principals as p, reduce, type SpaceState } from '../src/index.js'
import { buildHistory } from './fixtures/history.js'
const pick = (s: Partial<SpaceState>) => ({ members: s.members, items: s.items, leader: s.leader, status: s.status, lastSeq: s.lastSeq })
it('reduce-01：公开推导与内核状态一致', async () => {
  const h = await buildHistory()
  const records = await h.service.readSince({ spaceId: 's', principal: p.internal('host-index') }, 0)
  let state: SpaceState | undefined
  for (const record of records) state = reduce(state, record)
  const overview = await h.service.overview({ spaceId: 's', principal: p.internal('host-index') })
  expect(pick(state!)).toEqual(pick(overview))
  expect(state!.leader).toBe('b'); expect(state!.items['item-1']!.status).toBe('decided'); expect(state!.items['item-2']!.status).toBe('escalated')
})
it('reduce-02：推导不修改输入', async () => {
  const h = await buildHistory()
  const [first, second] = h.records
  const previous = reduce(undefined, first!)!
  const before = structuredClone(previous), record = structuredClone(second!)
  reduce(previous, second!)
  expect(previous).toEqual(before); expect(second).toEqual(record)
})
it('reduce-03：推导函数不接触外部', async () => {
  const h = await buildHistory()
  let calls = 0
  const boom = () => { calls++; throw new Error('external access') }
  for (const target of [h.store, h.provider] as unknown as Record<string, unknown>[]) for (const key of [...Object.getOwnPropertyNames(Object.getPrototypeOf(target)), ...Object.keys(target)]) if (key !== 'constructor' && typeof target[key] === 'function') target[key] = boom
  let state: SpaceState | undefined
  for (const record of h.records) state = reduce(state, record)
  expect(state?.lastSeq).toBe(h.records.at(-1)!.seq)
  expect(calls).toBe(0)
})
