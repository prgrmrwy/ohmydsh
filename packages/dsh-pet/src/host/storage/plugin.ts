/**
 * Pet's storage backend as its own Cordis plugin row.
 *
 * WHY THIS IS A SEPARATE ROW AND NOT PART OF THE PET PLUGIN
 *
 * `storage-domain` resolves its routes through Cordis services: for every
 * routed backend name it injects `storageBackendServiceKey(name)` and only
 * activates once all of them are provided. The Pet plugin row injects
 * `storageDomain`. So if Pet also provided its own backend service, the graph
 * would be circular — Pet waits for the domain layer, the domain layer waits
 * for Pet — and neither would ever load.
 *
 * Registering the backend from a row that loads BEFORE the domain layer is the
 * same shape the official `storage-sqlite` plugin uses, and it keeps the
 * dependency order acyclic:
 *
 * ```
 * dsh-pet-storage  →  provides storage backend service
 *        ↓
 * storage-domain   →  routes dsh_pet to it
 *        ↓
 * dsh-pet          →  injects storageDomain, opens the domain
 * ```
 *
 * The Pet plugin reaches the live backend through `ctx.storage.backend.get()`,
 * so the two rows share one instance and therefore one exclusive connection.
 *
 * @module dsh-pet/host/storage/plugin
 */
import type { Context } from '@deepseek-ai/cordis'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { PET_BACKEND_NAME, PetStorageBackend } from './backend.js'

/** Cordis plugin name. */
export const name = 'dsh-pet-storage'

/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration: where Pet's medium lives. */
export interface PetStoragePluginConfig {
  /** Absolute path to Pet's SQLite database file. */
  readonly path: string
}

/**
 * Register Pet's backend and publish its lifecycle service.
 *
 * `ctx.provide` is what lets `storage-domain` wait for this backend instead of
 * racing it: a route naming this backend cannot resolve until the service
 * exists, so a domain can never open against a half-registered medium.
 *
 * @param ctx - plugin context (must inject `storage`).
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: PetStoragePluginConfig): void {
  const backend = new PetStorageBackend(config.path)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register(PET_BACKEND_NAME, backend as never)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'dsh-pet-storage.registerBackend')
  ctx.provide(storageBackendServiceKey(PET_BACKEND_NAME), backend as never)
}
