import { describe, expect, it } from 'vitest'
import { prepareCatalog } from '../src/upstream-compat.js'

describe('upstream compatibility gate', () => {
  it('rejects_incompatible_colliding_or_marker_bearing_upstream_and_keeps_active_generation', async () => {
    const active = { id: 'previous-generation' }
    await expect(prepareCatalog({ all: true, activeGeneration: active, customNames: ['openspec-propose'] }))
      .rejects.toMatchObject({ code: 'upstream-incompatible' })
  })
})
