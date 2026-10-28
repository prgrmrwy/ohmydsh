import { mkdtempSync, realpathSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { storedEvidenceReader } from '../src/eval/storage-reader.js'
it('reads complete official physical bytes without acquiring a writer or changing the artifact', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-storage-reader-'))
  const path = join(directory, 'session.v4.jsonl.zstd')
  const rows = [{ type: 'session', id: 'reserved', version: 4, createdAt: 1, isSeeded: false, delegationDepth: 0 }, { type: 'session/end-seed', seq: 0, time: 1, data: {} }]
  const bytes = Buffer.concat(rows.map(row => zstdCompressSync(JSON.stringify(row) + '\n')))
  writeFileSync(path, bytes)
  const before = statSync(path).mtimeMs
  const read = storedEvidenceReader(async id => { expect(id).toBe('reserved'); return { path, encoding: 'zstd' } })
  expect(await read('reserved')).toMatchObject({ id: 'reserved', inheritedEventCount: 0, events: [{ seq: 0 }] })
  expect(statSync(path).mtimeMs).toBe(before)
  expect(readFileSync(path)).toEqual(bytes)
})
it('refuses corrupt tail instead of using a repaired valid prefix', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-storage-corrupt-'))
  const path = join(directory, 'session.jsonl')
  const bytes = Buffer.from(JSON.stringify({ type: 'session', id: 'reserved', version: 4, createdAt: 1, isSeeded: false, delegationDepth: 0 }) + '\n{"seq":0')
  writeFileSync(path, bytes)
  const read = storedEvidenceReader(async () => ({ path, encoding: 'jsonl' }))
  await expect(read('reserved')).rejects.toThrow()
  expect(readFileSync(path)).toEqual(bytes)
})
