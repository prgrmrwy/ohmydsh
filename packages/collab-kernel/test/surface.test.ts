import { expect, it } from 'vitest'
import { CollabService } from '../src/index.js'
import { world } from './support/world.js'

it('surface-01：不存在的协作空间被拒', async () => {
  const w = await world()
  await w.service.close('s')
  const service = new CollabService({ serviceId: 'service-2', store: w.store, providers: [w.provider] })
  await service.open('space-x')
  await expect(service.sendMessage({ spaceId: 'space-x', principal: w.principal('aily'), cmdId: 'missing' }, { to: 'doubao', body: 'hello' })).rejects.toMatchObject({ code: 'COLLAB_SPACE_NOT_FOUND' })
  expect(w.store.records.has('space-x')).toBe(false)
})
