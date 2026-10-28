export interface ReleaseEvent { type: 'registered' | 'settled' | 'removed'; id: string; owner: string; generation: string; status?: string }
export interface OwnedJob { id: string; owner?: string }

export interface JobEventSource {
  subscribe(filter: { owners: 'all' }, listener: (event: { type: string; job?: { id: string; owner?: string; status?: string } }) => void): () => void
}
export function bindJobReleaseEvents(source: JobEventSource, proof: JobReleaseProof, generation: string): () => void {
  return source.subscribe({ owners: 'all' }, event => {
    const job = event.job
    if (!job?.owner || !['registered', 'settled', 'removed'].includes(event.type)) return
    proof.observe({ type: event.type as ReleaseEvent['type'], id: job.id, owner: job.owner, generation,
      ...(job.status === undefined ? {} : { status: job.status }) })
  })
}

/** Only continuous evidence from this Host's trusted producer contract proves release. */
export class JobReleaseProof {
  private readonly states = new Map<string, { registered: boolean; released: boolean; failed: boolean }>()
  private unhealthy = false
  constructor(private readonly generation: string, private readonly owners: ReadonlySet<string>, private readonly persist: (event: ReleaseEvent) => void) {}

  observe(event: ReleaseEvent): void {
    if (!this.owners.has(event.owner)) return
    try { this.persist(event) } catch { this.unhealthy = true }
    if (event.generation !== this.generation) this.unhealthy = true
    const key = `${event.owner}:${event.id}`
    const state = this.states.get(key) ?? { registered: false, released: false, failed: false }
    if (event.type === 'registered') {
      if (state.registered) state.failed = true
      state.registered = true
    } else if (event.type === 'settled') {
      if (state.registered && !state.failed && (event.status === 'completed' || event.status === 'killed')) state.released = true
      else state.failed = true
    } else if (!state.released) state.failed = true
    this.states.set(key, state)
  }

  ownedJobs(jobs: readonly OwnedJob[]): OwnedJob[] {
    return jobs.filter(job => job.owner !== undefined && this.owners.has(job.owner))
  }

  requireReleased(listed: readonly OwnedJob[]): void {
    if (this.unhealthy) throw new Error('Resource evidence unhealthy: Host generation or persistence failure')
    const pending = new Set<string>()
    for (const job of this.ownedJobs(listed)) {
      const state = this.states.get(`${job.owner}:${job.id}`)
      if (!state?.released || state.failed) pending.add(job.id)
    }
    for (const [key, state] of this.states) if (!state.released || state.failed) pending.add(key)
    if (pending.size) throw new Error(`Resource release unproven: ${[...pending].join(', ')}`)
  }
}

export interface RetirementPort<T extends { id: string }> {
  root: T; current(): T | undefined; archive(id: string): Promise<void>; cancel(agent: T): void;
  whenIdle(agent: T): Promise<void>; pending(agent: T): number; settleJobs(): Promise<void>;
  drainDescendants(): Promise<void>; settleOneShots(): Promise<void>; healthy(): boolean;
}

export async function retireTestRoot<T extends { id: string }>(port: RetirementPort<T>): Promise<void> {
  const checkIdentity = (): void => {
    if (port.current() !== port.root || !port.healthy()) throw new Error('Test owner identity or resource evidence unhealthy')
  }
  checkIdentity()
  await port.archive(port.root.id)
  port.cancel(port.root)
  await port.whenIdle(port.root)
  await port.settleJobs()
  await port.drainDescendants()
  await port.settleOneShots()
  checkIdentity()
  // Child settlement notices may arrive during either drain, after the first cancel.
  port.cancel(port.root)
  await port.whenIdle(port.root)
  await port.settleJobs()
  checkIdentity()
  if (port.pending(port.root) !== 0) throw new Error('Test owner inbox not empty after retirement')
}
