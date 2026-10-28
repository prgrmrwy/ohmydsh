import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sendRecordedPrompt } from '../src/eval/prompt-ledger.js'

it('persists identity before sending, and never retries an uncertain delivery', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prompt-ledger-'))
  let calls = 0
  const send = async () => { calls++; throw new Error('response lost') }
  await expect(sendRecordedPrompt(root, 'session', 'initial', 'fictional', send)).rejects.toThrow('response lost')
  await expect(sendRecordedPrompt(root, 'session', 'initial', 'fictional', send)).rejects.toThrow(/uncertain/)
  expect(calls).toBe(1)
})

it('returns a confirmed receipt without resending and binds identity to text', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-prompt-confirmed-'))
  const ids: string[] = []
  const send = async (id: string) => { ids.push(id) }
  await sendRecordedPrompt(root, 'session', 'initial', 'fictional', send)
  await sendRecordedPrompt(root, 'session', 'initial', 'fictional', send)
  expect(ids).toHaveLength(1)
  expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/)
  await expect(sendRecordedPrompt(root, 'session', 'initial', 'different', send)).rejects.toThrow(/mismatch/)
})
