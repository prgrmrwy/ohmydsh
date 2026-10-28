import type { RoundItem } from './round.js'
export interface ItemOperations<T> { execute(item: RoundItem): Promise<void>; retire(): Promise<void>; collect(): Promise<void>; score(): Promise<T> }
export async function runFixedItem<T>(item: RoundItem, operations: ItemOperations<T>, signal: AbortSignal): Promise<T> {
  const active = () => { if (signal.aborted) throw new Error('Fixed item execution aborted') }
  active()
  let failed = false, executionError: unknown
  try { await operations.execute(item) } catch (error) { failed = true; executionError = error }
  try { await operations.retire() } catch (error) {
    if (failed) throw new AggregateError([executionError, error], 'Execution failed and resource release unproven; preserve scene')
    throw error
  }
  if (failed) throw executionError
  active()
  await operations.collect()
  active()
  return operations.score()
}
