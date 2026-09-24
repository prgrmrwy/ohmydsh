/**
 * Bounded concurrency helper shared by the tool fan-out and the settings channel.
 *
 * @module dsh-memex/run/concurrency
 */

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 * @param items - work items.
 * @param limit - maximum concurrent workers (a positive integer).
 * @param worker - async worker for one item.
 * @returns results in input order.
 */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('fanout concurrency must be a positive integer')
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}
