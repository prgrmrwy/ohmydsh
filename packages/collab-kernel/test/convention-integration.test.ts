import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { defaultConvention } from '../src/convention/index.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'

it('convention-01：service creation records the bundled convention and authorised reads return exact bytes', async () => {
  const service = new CollabService({ serviceId: 'x', store: new MemStore(), providers: [new FakeProvider()] })
  const ctx = { spaceId: 's', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }
  await service.createSpace({ ...ctx, cmdId: 'create' }, { name: 'aily', address: 'a:1', kind: 'agent' })
  const state = await service.overview(ctx)
  const text = await service.readConvention(ctx, '1')
  expect(text).toBe(defaultConvention.text)
  expect(state.convention).toEqual({ version: '1', sha256: createHash('sha256').update(text).digest('hex') })
  expect(await service.project(ctx)).toContain('协作空间总览')
  await expect(service.readConvention(ctx, '9')).rejects.toMatchObject({ code: 'COLLAB_CONVENTION_UNKNOWN' })
  await service.close('s')
})
