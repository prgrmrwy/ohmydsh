/** Pet Host error type carrying a stable wire code. */

import type { PetErrorBody, PetErrorCode } from '../wire.js'

/**
 * An error with a stable, client-visible Pet error code.
 *
 * Messages are diagnostic and MUST NOT embed provider credentials, tokens or
 * other secrets: they are returned verbatim to the Web client.
 */
export class PetError extends Error {
  readonly code: PetErrorCode
  readonly fields?: Readonly<Record<string, string>>

  /**
   * @param code - Stable wire error code.
   * @param message - Diagnostic message, safe to display.
   * @param fields - Optional field-level validation details.
   */
  constructor(code: PetErrorCode, message: string, fields?: Readonly<Record<string, string>>) {
    super(message)
    this.name = 'PetError'
    this.code = code
    if (fields !== undefined) this.fields = fields
  }

  /**
   * Project this error onto the uniform wire body.
   * @returns the serializable error body.
   */
  toBody(): PetErrorBody {
    return this.fields === undefined
      ? { error: this.code, message: this.message }
      : { error: this.code, message: this.message, fields: this.fields }
  }
}

/**
 * Coerce an unknown thrown value into a Pet wire error body.
 *
 * Unrecognized failures collapse to `INTERNAL` with a bounded message so an
 * unexpected stack never reaches the browser.
 * @param error - Thrown value.
 * @returns the wire error body.
 */
export function toErrorBody(error: unknown): PetErrorBody {
  if (error instanceof PetError) return error.toBody()
  const message = error instanceof Error ? error.message : String(error)
  return { error: 'INTERNAL', message: message.slice(0, 500) }
}

/** HTTP status mapped from each stable Pet error code. */
export function statusOf(code: PetErrorCode): number {
  switch (code) {
    case 'INVALID_REQUEST':
    case 'SKILL_IMPORT_REJECTED':
    case 'BINDING_INVALID':
      return 400
    case 'UNKNOWN_CAPABILITY':
    case 'SOURCE_NOT_FOUND':
    case 'TASK_NOT_FOUND':
    case 'INVOCATION_NOT_FOUND':
    case 'SKILL_NOT_FOUND':
      return 404
    case 'REVISION_CONFLICT':
    case 'TASK_ARCHIVED':
    case 'ARCHIVE_BLOCKED':
    case 'SKILL_DISABLED':
    case 'SKILL_DIGEST_MISMATCH':
    case 'PROJECTION_DRIFT':
    case 'NO_CURRENT_INVOCATION':
    case 'AMBIGUOUS_CURRENT_INVOCATION':
      return 409
    case 'NOT_A_PET_SESSION':
    case 'CONTEXT_REQUIRED':
    case 'CAPABILITY_UNAVAILABLE':
      return 403
    case 'PET_DEGRADED':
    case 'MODEL_UNAVAILABLE':
      return 503
    default:
      return 500
  }
}
