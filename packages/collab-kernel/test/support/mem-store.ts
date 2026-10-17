import { CollabError, type CollabStore, type CommitRecord } from '../../src/index.js'
export class MemStore implements CollabStore {
  readonly records = new Map<string, CommitRecord[]>()
  private opened = new Set<string>()
  async open(spaceId: string) { this.opened.add(spaceId) }
  async close(spaceId: string) { this.opened.delete(spaceId) }
  async breakLock(_spaceId: string, _expectedInstanceId: string) {}
  async commit(spaceId: string, record: CommitRecord, expectedLastSeq: number) {
    if (!this.opened.has(spaceId)) throw new CollabError('COLLAB_STORE_FAILED')
    const records = this.records.get(spaceId) ?? []
    if ((records.at(-1)?.seq ?? 0) !== expectedLastSeq) throw new CollabError('COLLAB_STORE_CONFLICT')
    records.push(structuredClone(record)); this.records.set(spaceId, records)
  }
  async read(spaceId: string, fromSeq: number) { return structuredClone((this.records.get(spaceId) ?? []).filter(r => r.seq >= fromSeq)) }
  async list() { return [...this.records.keys()] }
}
