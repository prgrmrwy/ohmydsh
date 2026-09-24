/**
 * Proves the Pet domain works against Pet's OWN storage backend at the exact
 * path the bundle patch configures, and that only the `dsh_pet` domain is
 * routed away from the profile's default backend.
 *
 * The default backend here is the official `storage-sqlite`, standing in for
 * whatever the profile composes: the point of these tests is that Pet's route
 * is an override, so an unrelated domain must keep landing on the default.
 */

import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as PetStorage from '../src/host/storage/plugin.js'
import { PET_BACKEND_NAME } from '../src/host/storage/backend.js'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { verifyBackendOwnership, verifyDatabaseLocation } from '../src/host/backend.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import { PetRepository } from '../src/host/repository.js'
import { petDomainSpec } from '../src/host/spec.js'
import { testTask } from './harness.js'

/** Stand-in for an unrelated DSH domain that must stay on the default backend. */
const otherDomainSpec = defineDomain({
  name: 'other_domain',
  version: 1,
  tables: { rows: domainTable<string, { value: string }>(z.object({ value: z.string() })) },
})

const contexts: Context[] = []

afterEach(async () => {
  // Dispose, don't just forget: Pet's backend owns its SQLite connection
  // exclusively and releases it through its plugin disposer. Dropping the
  // reference alone leaves the medium locked for the rest of the file.
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function composeProfile(paths: PetPaths): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)

  // The profile's default backend, kept in place by Pet's patch. Constructed
  // through the plugin so schemastery fills Config defaults exactly as the
  // real loader does.
  await ctx.plugin({
    name: 'default-backend',
    inject: ['storage'],
    async apply(backendCtx: Context) {
      await backendCtx.plugin(
        {
          name: 'default-backend-inner',
          inject: ['storage'],
          apply(inner: Context, config: StorageSqlite.Config) {
            const backend = new StorageSqlite.SqliteStorageBackend(config)
            inner.effect(() => inner.storage.backend.register('json', backend))
            inner.provide(storageBackendServiceKey('json'), backend)
          },
          Config: StorageSqlite.Config,
        },
        { path: ':memory:' },
      )
    },
  })

  // Pet's own registered backend, at the exact configured path.
  await ctx.plugin(PetStorage as never, { path: paths.databaseFile })

  // Pet's patch: an override map, not a replacement.
  await ctx.plugin(StorageDomain, {
    backend: 'json',
    routes: { dsh_pet: PET_BACKEND_NAME },
  })
  return ctx
}

describe('Pet SQLite composition', () => {
  it('opens the Pet domain on the real sqlite backend at the configured path', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-sqlite-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const ctx = await composeProfile(paths)

    expect((await verifyBackendOwnership(ctx, paths)).ok).toBe(true)

    const domain = await ctx.storage.domain.open(petDomainSpec)
    const repository = new PetRepository(domain)
    await repository.createTask(testTask())

    const location = await verifyDatabaseLocation(paths)
    expect(location.ok).toBe(true)
    expect((await stat(paths.databaseFile)).isFile()).toBe(true)

    await domain.close()
  })

  it('recovers Pet records from the real database file after a restart', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-sqlite-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)

    const first = await composeProfile(paths)
    const firstDomain = await first.storage.domain.open(petDomainSpec)
    await new PetRepository(firstDomain).createTask(testTask())
    // A restart releases the medium: closing only the domain would leave the
    // connection open and the second boot would be refused — correctly, but
    // that is medium ownership, not the recovery this test is about.
    await firstDomain.close()
    await first.fiber.dispose()

    const second = await composeProfile(paths)
    const secondDomain = await second.storage.domain.open(petDomainSpec)
    const recovered = new PetRepository(secondDomain).getTask('task-1')

    expect(recovered?.executorSessionId).toBe('exec-1')
    await secondDomain.close()
  })

  it('leaves every other domain on the profile default backend', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-sqlite-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const ctx = await composeProfile(paths)

    // Opening an unrelated domain must succeed via the untouched default
    // route; Pet's patch only adds one override.
    const other = await ctx.storage.domain.open(otherDomainSpec)
    await other.table('rows').put('k', { value: 'v' })
    expect(other.table('rows').get('k')).toEqual({ value: 'v' })

    await other.close()
  })
})

describe('backend ownership fails closed', () => {
  it('degrades when the sqlite backend is not registered at all', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-sqlite-'))
    const paths = resolvePetPaths(home)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)

    const verdict = await verifyBackendOwnership(ctx, paths)

    expect(verdict.ok).toBe(false)
    expect(verdict.diagnostic).toContain('not registered')
  })

  it('degrades when Pet records did not land at the configured path', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-sqlite-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)

    // A foreign composition owning `sqlite` with a different path leaves Pet's
    // configured database file absent.
    const verdict = await verifyDatabaseLocation(paths)

    expect(verdict.ok).toBe(false)
    expect(verdict.diagnostic).toContain('foreign medium')
  })
})
