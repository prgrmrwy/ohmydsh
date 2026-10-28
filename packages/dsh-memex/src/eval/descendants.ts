export interface DescendantRow { kind: string; id: string; mode?: string; reason?: string }

/** The lawful owner drains runs. This verifier never acquires or fabricates their disposal capabilities. */
export async function requireOneShotRelease(port: { list(): Promise<readonly DescendantRow[]>; live(id: string): boolean; known: ReadonlySet<string>; settleJobs(): Promise<void> }): Promise<void> {
  await port.settleJobs()
  const descendants = await port.list()
  for (const row of descendants) {
    if (row.kind !== 'child' || !['one-shot', 'continuable'].includes(row.mode ?? '') || !port.known.has(row.id)) {
      throw new Error(`Descendant lifecycle unproven: ${row.id}`)
    }
    if (port.live(row.id)) throw new Error(`Descendant owner has not released: ${row.id}`)
  }
}
