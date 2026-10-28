export interface OwnedJudgeRun<T> { result: Promise<T>; dispose(): Promise<void> }

/** start must honour signal and clean up unpublished resources on rejection (official SubagentRun contract). */
export async function runBoundedJudge<T>(carrier: AbortSignal, timeoutMs: number, start: (signal: AbortSignal) => Promise<OwnedJudgeRun<T>>): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid judge duration bound')
  if (carrier.aborted) throw new Error('Judge request aborted')
  const controller = new AbortController()
  const disconnect = (): void => { controller.abort(new Error('Judge carrier aborted')) }
  carrier.addEventListener('abort', disconnect, { once: true })
  const timer = setTimeout(() => { controller.abort(new Error('Judge timeout aborted')) }, timeoutMs)
  let run: OwnedJudgeRun<T> | undefined
  try {
    run = await start(controller.signal)
    // Do not race away from startup: its owner must finish unpublished-resource cleanup.
    const result = await run.result
    if (controller.signal.aborted) throw new Error('Judge request aborted')
    return result
  } finally {
    controller.abort()
    clearTimeout(timer)
    carrier.removeEventListener('abort', disconnect)
    if (run) {
      try { await run.dispose() }
      catch (error) { throw new Error(`Judge cleanup failed: ${String(error)}`, { cause: error }) }
    }
  }
}
