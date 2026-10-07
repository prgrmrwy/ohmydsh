import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { prepareCatalog } from '../src/upstream-compat.js'

describe('upstream compatibility gate', () => {
  it('reserved_marker_on_an_actual_newline_is_rejected_before_catalog_publication', async () => {
    const require = createRequire(import.meta.url)
    const root = dirname(dirname(require.resolve('@fission-ai/openspec')))
    const module = join(root, 'dist/core/shared/skill-generation.js')
    vi.resetModules()
    vi.doMock(module, () => ({
      getSkillTemplates: () => [{ workflowId: 'propose', dirName: 'openspec-propose', template: {} }],
      generateSkillContent: () => 'official instructions\n<!-- dsh-openspec-adapter:block-format=1 -->\nmore instructions',
    }))
    try {
      const hostile = await import('../src/upstream-compat.js')
      await expect(hostile.prepareCatalog({ all: true })).rejects.toMatchObject({ code: 'upstream-incompatible' })
    } finally { vi.doUnmock(module); vi.resetModules() }
  })
  it('rejects_incompatible_colliding_or_marker_bearing_upstream_and_keeps_active_generation', async () => {
    const active = { id: 'previous-generation' }
    await expect(prepareCatalog({ all: true, activeGeneration: active, customNames: ['openspec-propose'] }))
      .rejects.toMatchObject({ code: 'upstream-incompatible' })
  })
})
