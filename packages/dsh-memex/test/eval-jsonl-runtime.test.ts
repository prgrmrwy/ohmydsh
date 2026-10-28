import { Context } from '@deepseek-ai/cordis'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { locateRegisteredArtifact } from '../src/eval/artifact-location.js'
import { storedEvidenceReader } from '../src/eval/storage-reader.js'
import { createHostEvidenceReader } from '../src/eval/host-reader.js'
import { EvalLedger } from '../src/eval/ledger.js'

it('reads actual official backend output with the pinned layout rather than a hand-written path fixture', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-real-jsonl-'))
  const ctx = new Context()
  try {
    await ctx.plugin(JsonlPersistence, { root, compression: 'zstd' })
    const ledger = new EvalLedger(root)
    const id = SessionId(ledger.reserve('round-fictional', 'know', 'mem'))
    const cwd = '/fictional/eval space/repo'
    const handle = await ctx.sessionPersistence.create({ id, version: 4, createdAt: 1, cwd, isSeeded: false, delegationDepth: 0 })
    try {
      await handle.append([{ type: 'session/end-seed', seq: 0, time: 1, data: {} }] as never)
      await handle.flush()
      const read = storedEvidenceReader(async request => locateRegisteredArtifact({ name: 'session-persistence-jsonl', version: '0.2.0-rc.2', root, compression: 'zstd' }, { id: request, cwd }))
      const hostRead = createHostEvidenceReader(ctx, ledger, { name: 'session-persistence-jsonl', version: '0.2.0-rc.2', root, compression: 'zstd' })
      expect(await hostRead(id)).toEqual(await read(id))
      await expect(hostRead('session-daily')).rejects.toThrow(/unregistered/)
      expect(await read(id)).toMatchObject({ id, inheritedEventCount: 0, events: [{ type: 'session/end-seed', seq: 0 }] })
    } finally { await handle.close() }
  } finally { await ctx.fiber.dispose() }
})
