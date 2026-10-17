import type { CommitRecord } from '../model/index.js'
export interface CollabStore {
  open(spaceId: string): Promise<void>
  close(spaceId: string): Promise<void>
  breakLock(spaceId: string, expectedInstanceId: string): Promise<void>
  commit(spaceId: string, record: CommitRecord, expectedLastSeq: number): Promise<void>
  /** Read commits at or after fromSeq; service readSince uses its exclusive cursor. */
  read(spaceId: string, fromSeq: number): Promise<CommitRecord[]>
  list(): Promise<string[]>
}
