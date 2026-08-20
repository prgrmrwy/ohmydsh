import type { OperationPhase, WsErrorCode, WsWireError } from '../wire.js'

export class WsError extends Error {
  readonly code: WsErrorCode
  readonly phase?: OperationPhase
  readonly retryable: boolean
  readonly details?: Record<string, string | number | boolean>
  readonly cause?: unknown

  constructor(code: WsErrorCode, message: string, options: {
    phase?: OperationPhase
    retryable?: boolean
    details?: Record<string, string | number | boolean>
    cause?: unknown
  } = {}) {
    super(message)
    this.name = 'WsError'
    this.code = code
    if (options.phase !== undefined) this.phase = options.phase
    this.retryable = options.retryable ?? false
    if (options.details !== undefined) this.details = options.details
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function wireError(error: unknown): WsWireError {
  if (error instanceof WsError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.phase === undefined ? {} : { phase: error.phase }),
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  return { code: 'INTERNAL_ERROR', message: 'Worktree Session failed unexpectedly', retryable: true }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
