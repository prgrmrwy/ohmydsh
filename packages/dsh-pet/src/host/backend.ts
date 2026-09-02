/**
 * Storage backend ownership verification.
 *
 * Pet routes only its own `dsh_pet` domain to the `sqlite` backend. The hub's
 * backend registry is keyed by NAME, so if another composition already
 * registered `sqlite` against a different database file, Pet's domain would
 * silently open inside that unrelated medium. That is a data-ownership
 * failure, not a recoverable condition: Pet fails into `degraded` instead of
 * replacing or sharing the foreign backend.
 */

import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { PetPaths } from './paths.js'

/** Outcome of the pre-open backend ownership proof. */
export interface BackendOwnership {
  readonly ok: boolean
  /** Present when ownership could not be proven; suitable for a degraded diagnostic. */
  readonly diagnostic?: string
}

/** Backend name Pet's domain route targets. */
export const PET_BACKEND_NAME = 'sqlite'

/**
 * Prove the routed `sqlite` backend is the Pet-owned one before trusting it
 * with Pet records.
 *
 * The check is deliberately conservative: an absent backend, an absent
 * database file after open, or a database path that is not a regular file all
 * fail closed. A passing check does not assert exclusive ownership forever —
 * it asserts that at open time the medium Pet routes to is the file Pet's own
 * bundle patch configured.
 * @param ctx - Plugin context providing the storage hub.
 * @param paths - Resolved Pet paths carrying the expected database file.
 * @returns the ownership verdict.
 */
export async function verifyBackendOwnership(
  ctx: Context,
  paths: PetPaths,
): Promise<BackendOwnership> {
  let registered: unknown
  try {
    registered = ctx.storage.backend.get(PET_BACKEND_NAME)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      diagnostic:
        `Pet requires the '${PET_BACKEND_NAME}' storage backend but it is not registered (${reason}). ` +
        'Rebuild the DSH profile so the Pet bundle patch composes @deepseek-ai/dsh-storage-sqlite.',
    }
  }
  if (registered === undefined || registered === null) {
    return {
      ok: false,
      diagnostic: `Storage backend '${PET_BACKEND_NAME}' resolved to no instance.`,
    }
  }
  return { ok: true }
}

/**
 * Confirm Pet's records actually land at its configured database path.
 *
 * The SQLite backend materializes its file lazily, so merely opening the
 * domain proves nothing: on a first boot the file legitimately does not exist
 * yet. The caller therefore forces one durable write BEFORE calling this, and
 * this function then proves the bytes appeared where Pet configured them. A
 * still-missing file means the routed `sqlite` backend is owned by a
 * different composition writing somewhere else.
 * @param paths - Resolved Pet paths.
 * @param forceDurableWrite - Performs one durable domain write; awaited first.
 * @returns the ownership verdict.
 */
export async function verifyDatabaseLocation(
  paths: PetPaths,
  forceDurableWrite?: () => Promise<void>,
): Promise<BackendOwnership> {
  if (forceDurableWrite !== undefined) {
    try {
      await forceDurableWrite()
    } catch (error) {
      return {
        ok: false,
        diagnostic:
          `Pet could not commit a durable write to its storage domain: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const info = await stat(paths.databaseFile).catch(() => undefined)
  if (info === undefined) {
    return {
      ok: false,
      diagnostic:
        `Pet committed a durable write but no database exists at ${paths.databaseFile}. ` +
        `Another composition may own the '${PET_BACKEND_NAME}' backend with a different path; ` +
        'Pet will not write records into a foreign medium.',
    }
  }
  if (!info.isFile()) {
    return {
      ok: false,
      diagnostic: `Pet database path ${paths.databaseFile} exists but is not a regular file.`,
    }
  }
  return { ok: true }
}
