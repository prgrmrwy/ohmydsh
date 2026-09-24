import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (relative: string) => readFile(path.join(root, 'src', relative), 'utf8')

describe('unified locus breaking cutover', () => {
  it('does not wire production legacy QA delivery, bind command, or createQaGroup route', async () => {
    const [index, service] = await Promise.all([
      source('index.ts'),
      source('host/channel/service.ts'),
    ])
    for (const retired of ['new QaDelivery', 'qaDelivery:', 'bindCommand:', 'createQaGroup:', 'probeSubagentSeam']) {
      expect(index).not.toContain(retired)
    }
    expect(service).toContain('requireLocus: true')
    expect(service).not.toContain('readonly qaDelivery')
    expect(service).not.toContain('readonly bindCommand')
  })

  it('routes the wheel Q&A entry only through LOCUS default-Q&A and exposes no legacy client call', async () => {
    const [overlay, api] = await Promise.all([
      source('client/overlay.tsx'),
      source('client/api.ts'),
    ])
    expect(overlay).toContain('petApi.locusDefaultQa')
    expect(overlay).not.toContain('petApi.createQaGroup')
    expect(api).not.toContain('createQaGroup:')
  })

  it('keeps ordinary Task, Invocation, and Snapshot production modules intact', async () => {
    const [index, routes] = await Promise.all([source('index.ts'), source('host/routes.ts')])
    expect(index).toContain('const coordinator = new PetCoordinator')
    expect(routes).toContain('ROUTES.invocationCreate')
    expect(routes).toContain('repository.listInvocations')
    expect(routes).toContain('repository.getSnapshot')
  })
})
