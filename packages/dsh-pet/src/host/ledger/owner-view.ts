/**
 * Owner-facing projection of one todo (`PetTodoView`), shared by the Host
 * wiring and the migration-equivalence tests so both compare the SAME view.
 */
import type { PetTodoView } from '../../wire.js'
import type { TodoRecord } from './todo.js'

/**
 * Project one durable todo into its owner-facing wire shape.
 *
 * Flattens `evidence` into `summary`/`detail` because the panel renders them
 * as two distinct fields, and passes `generation` through as an AUDIT fact
 * only — no consumer may use it to address a locus (design D6: a todo
 * references locus identity, never a locus instance).
 */
export function projectTodoForOwner(record: TodoRecord): PetTodoView {
  return {
    itemId: record.itemId,
    locusId: record.locusId,
    generation: record.generation,
    endpoint: record.endpoint,
    triggerMessageId: record.triggerMessageId,
    requestedBy: record.requestedBy,
    summary: record.evidence.summary,
    detail: record.evidence.detail,
    status: record.status,
    createdAt: record.createdAt,
    statusChangedAt: record.statusChangedAt,
  }
}
