import { bindJobReleaseEvents, JobReleaseProof, type ReleaseEvent } from './release.js'
export interface EvalJobView { id: string; owner?: string; status: string }
export interface EvalJobEvent { type: string; job?: EvalJobView }
export interface EvalJobsPort {
  events: { subscribe(filter: { owners: 'all' }, listener: (event: EvalJobEvent) => void): () => void }
  list(owner: string): EvalJobView[]
  kill(id: string, owner: string, reason?: string): unknown
  wait(id: string, timeoutMs: number, owner: string): Promise<unknown>
}

/** The caller installs this before creating any eval resources; it must retain the subscription until retirement. */
export function attachEvalJobs(jobs: EvalJobsPort, owners: ReadonlySet<string>, generation: string, persist: (event: ReleaseEvent) => void, timeoutMs: number, history: readonly ReleaseEvent[] = []): { settle(): Promise<void>; dispose(): void } {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid job settlement bound')
  let replaying = true
  const proof = new JobReleaseProof(generation, owners, event => { if (!replaying) persist(event) })
  for (const event of history) proof.observe(event)
  replaying = false
  const dispose = bindJobReleaseEvents(jobs.events, proof, generation)
  const list = (): EvalJobView[] => [...owners].flatMap(owner => jobs.list(owner).filter(job => job.owner === owner))
  return {
    dispose,
    async settle(): Promise<void> {
      const active = list().filter(job => job.status === 'running' || job.status === 'stopping')
      const errors: string[] = []
      // Request cancellation for the whole owned set before waiting on any one producer.
      for (const job of active) {
        try { jobs.kill(job.id, job.owner!, 'Memex selftest retirement') } catch { errors.push(job.id) }
      }
      for (const job of active) {
        try { await jobs.wait(job.id, timeoutMs, job.owner!) } catch { errors.push(job.id) }
      }
      proof.requireReleased(list())
      if (errors.length) throw new Error(`Job cancellation unproven: ${errors.join(', ')}`)
    },
  }
}
