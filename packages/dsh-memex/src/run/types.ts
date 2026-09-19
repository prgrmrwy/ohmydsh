export interface KernelRunOptions {
  readonly home: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly stdin?: string
  /** Test-only override; production resolves the pinned package executable. */
  readonly executable?: string
}

export interface KernelResult {
  readonly ok: boolean
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface SearchHit {
  readonly slug: string
  readonly title: string
  readonly summary: string
  readonly matched?: string
}

export type KernelFailureCode = 'missing' | 'timeout' | 'failed' | 'unparseable'

export class KernelError extends Error {
  constructor(
    readonly code: KernelFailureCode,
    message: string,
    readonly result?: KernelResult,
  ) {
    super(message)
  }
}
