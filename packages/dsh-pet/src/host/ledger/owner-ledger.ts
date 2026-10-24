/**
 * The owner management surface over the two todo sources (design D10).
 *
 *  - Collab todos (the Locus collaboration space) are the live ledger.
 *  - Legacy todos (the Pet Domain store, registered before the migration) are
 *    listed read-only and marked `legacy: true`; they are never written again.
 *  - When the collaboration layer cannot be read, the list says so
 *    (`collab: 'unavailable'`) and still carries the legacy todos — it never
 *    reads as an empty ledger.
 *  - Records the proxy received but could not route are listed for the owner.
 *
 * Pure composition over injected ports, so every branch is unit-testable.
 */
import { PetError } from '../errors.js'
import type { PetTodoAction, PetTodoLedgerView, PetTodoView, PetUnroutableView } from '../../wire.js'
import type { ProxyInboxEntry } from '../collab/proxy.js'
import type { TodoBackend } from './backend.js'
import { LedgerStoreError } from './store.js'
import { projectTodoForOwner } from './owner-view.js'

export interface OwnerLedgerDeps {
  readonly collab: TodoBackend
  readonly legacy: TodoBackend
  /** Whether Pet is currently attached to dsh-collab. */
  readonly collabAvailable: () => boolean
  /** Unroutable proxy registrations for one main session. */
  readonly unroutable: (parentSessionId: string) => readonly ProxyInboxEntry[]
}

export interface OwnerLedger {
  /** One main session's merged, owner-facing ledger. */
  list(parentSessionId: string): Promise<PetTodoLedgerView>
  /**
   * Refuse any disposition of a legacy todo before it reaches a backend.
   * Resolves for every other id; the collab path then applies its own rules.
   */
  guard(itemId: string, action: PetTodoAction): Promise<void>
}

const LEGACY_REFUSAL = '这是旧版待办（迁移前登记），只读保留，不能受理、完成或放弃。'

function unroutableView(entry: ProxyInboxEntry): PetUnroutableView {
  return {
    seq: entry.seq,
    ...(entry.at === undefined ? {} : { at: entry.at }),
    subject: entry.subject,
    ...(entry.messageId === undefined ? {} : { messageId: entry.messageId }),
    ...(entry.itemId === undefined ? {} : { itemId: entry.itemId }),
  }
}

export function createOwnerLedger(deps: OwnerLedgerDeps): OwnerLedger {
  return {
    async list(parentSessionId) {
      const legacy: PetTodoView[] = (await deps.legacy.listForParent(parentSessionId))
        .map(record => ({ ...projectTodoForOwner(record), legacy: true as const }))
      let collab: PetTodoView[] = []
      let available = deps.collabAvailable()
      if (available) {
        try {
          collab = (await deps.collab.listForParent(parentSessionId)).map(projectTodoForOwner)
        } catch (error) {
          if (!(error instanceof LedgerStoreError) || error.code !== 'COLLAB_UNAVAILABLE') throw error
          available = false
        }
      }
      const unroutable = available ? deps.unroutable(parentSessionId).map(unroutableView) : []
      // Legacy first: they are older, and the list reads oldest-first.
      return {
        parentSessionId,
        items: [...legacy, ...collab],
        collab: available ? 'available' : 'unavailable',
        ...(unroutable.length === 0 ? {} : { unroutable }),
      }
    },
    async guard(itemId) {
      if ((await deps.legacy.getTodoItem(itemId)) !== undefined) {
        throw new PetError('INVALID_REQUEST', LEGACY_REFUSAL)
      }
    },
  }
}
