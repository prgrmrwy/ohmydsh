import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { conventions, defaultConvention } from '../src/convention/index.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'

it('convention-01：service creation records the bundled convention and authorised reads return exact bytes', async () => {
  const service = new CollabService({ serviceId: 'x', store: new MemStore(), providers: [new FakeProvider()] })
  const ctx = { spaceId: 's', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }
  await service.createSpace({ ...ctx, cmdId: 'create' }, { name: 'aily', address: 'a:1', kind: 'agent' })
  const state = await service.overview(ctx)
  const text = await service.readConvention(ctx, '4')
  expect(text).toBe(defaultConvention.text)
  expect(state.convention).toEqual({ version: '4', sha256: createHash('sha256').update(text).digest('hex') })
  expect(await service.project(ctx)).toContain('协作空间总览')
  // Every published version stays readable from a v4 space.
  for (const version of ['1', '2', '3']) expect(await service.readConvention(ctx, version)).toBe(conventions[version]!.text)
  await expect(service.readConvention(ctx, '9')).rejects.toMatchObject({ code: 'COLLAB_CONVENTION_UNKNOWN' })
  await service.close('s')
})

it('convention-04：v1–v3 spaces keep reading their recorded version', async () => {
  for (const version of ['1', '2', '3']) {
    const recorded = conventions[version]!
    const store = new MemStore()
    const old = new CollabService({ serviceId: 'x', store, providers: [new FakeProvider()], convention: recorded })
    const ctx = { spaceId: 'old', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }
    await old.createSpace({ ...ctx, cmdId: 'create' }, { name: 'aily', address: 'a:1', kind: 'agent' })
    await old.close('old')
    const upgraded = new CollabService({ serviceId: 'x', store, providers: [new FakeProvider()] })
    expect(defaultConvention.version).toBe('4')
    await upgraded.open('old')
    const state = await upgraded.overview(ctx)
    expect(state.convention).toEqual({ version, sha256: recorded.sha256 })
    const text = await upgraded.readConvention(ctx, version)
    expect(text).toBe(recorded.text)
    expect(createHash('sha256').update(text).digest('hex')).toBe(state.convention.sha256)
    await upgraded.close('old')
  }
})
