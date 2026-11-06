/**
 * Open Pet's storage domain over a state file WITHOUT loading the Host entry
 * (`src/index.ts`): migration tests only need to prove the migrated medium
 * opens under the current domain and reads back through the v20 repository.
 * Mirrors `composePetStorage` / `openPetDomain` in pet-host-fixture.ts.
 */
import { Context } from '@deepseek-ai/cordis'
import * as petStoragePlugin from '../../src/host/storage/plugin.js'
import { PET_BACKEND_NAME } from '../../src/host/storage/backend.js'
import { withAtomicWrites } from '../../src/host/storage/atomic-domain.js'
import { PET_DOMAIN_NAME } from '../../src/host/spec.js'
import { petDomainSpec } from '../../src/host/domain.js'

export interface OpenedPetDomain {
  readonly domain: unknown
  close(): Promise<void>
}

/** Open the domain with atomic writes attached, as the Host does. */
export async function openMigratedDomain(statePath: string): Promise<OpenedPetDomain> {
  const [Storage, Domain] = await Promise.all([
    import('@deepseek-ai/dsh-storage'),
    import('@deepseek-ai/dsh-storage-domain'),
  ])
  const ctx = new Context()
  await ctx.plugin(Storage.default as never)
  await ctx.plugin({
    name: 'default-backend',
    inject: ['storage'],
    apply(inner: Context) {
      const backend = { kv: { open: () => Promise.reject(new Error('no default unit in this suite')) }, close: () => Promise.resolve() }
      inner.effect(() => (inner as never as { storage: { backend: { register(name: string, value: unknown): () => void } } }).storage.backend.register('json', backend))
      inner.provide(Storage.storageBackendServiceKey('json'), backend as never)
    },
  } as never)
  await ctx.plugin(petStoragePlugin as never, { path: statePath })
  await ctx.plugin(Domain as never, { backend: 'json', routes: { [PET_DOMAIN_NAME]: PET_BACKEND_NAME } })
  const typed = ctx as never as {
    storageDomain: { open(spec: unknown): Promise<{ close(): Promise<void> }> }
    storage: { backend: { get(name: string): { unitFor(name: string): Promise<unknown> } } }
  }
  const raw = await typed.storageDomain.open(petDomainSpec)
  const domain = withAtomicWrites(raw as never, await typed.storage.backend.get(PET_BACKEND_NAME).unitFor(PET_DOMAIN_NAME) as never)
  return {
    domain,
    async close() {
      try { await raw.close() } finally { await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose() }
    },
  }
}
