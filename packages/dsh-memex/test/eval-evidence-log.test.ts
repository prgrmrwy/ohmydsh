import { zstdCompressSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { decodeEvidenceLog } from '../src/eval/evidence-log.js'

it('EVAL-019: 拼接 zstd 完整解压', () => {
  const bytes = Buffer.concat([zstdCompressSync(Buffer.from('{"seq":0}\n')), zstdCompressSync(Buffer.from('{"seq":1}\n'))])
  expect(decodeEvidenceLog(bytes, 'zstd')).toEqual([{ seq: 0 }, { seq: 1 }])
})
it('EVAL-020: 拼接尾帧损坏必须缺证', () => {
  const tail = zstdCompressSync(Buffer.from('{"seq":1}\n'))
  expect(() => decodeEvidenceLog(Buffer.concat([zstdCompressSync(Buffer.from('{"seq":0}\n')), tail.subarray(0, tail.length - 2)]), 'zstd')).toThrow()
})
it('rejects malformed JSON or noncontiguous events rather than retaining a valid prefix', () => {
  for (const text of ['{"seq":0}\nnot json\n', '{"seq":0}\n{"seq":2}\n', '{"seq":0}\n{"seq":0}\n']) expect(() => decodeEvidenceLog(Buffer.from(text), 'jsonl')).toThrow()
})
