import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { durableWrite } from './freeze.js'

/** No automatic retry: a crash between accepted delivery and receipt is conservatively uncertain. */
export async function sendRecordedPrompt(directory: string, session: string, turn: string, text: string, send: (requestId: string) => Promise<void>): Promise<void> {
  const key = createHash('sha256').update(JSON.stringify([session, turn])).digest('hex')
  const hash = createHash('sha256').update(text).digest('hex')
  const started = join(directory, `prompt-${key}.json`), accepted = join(directory, `prompt-${key}-accepted`)
  if (existsSync(started)) {
    const previous = JSON.parse(readFileSync(started, 'utf8')) as { hash: string }
    if (previous.hash !== hash) throw new Error('Frozen prompt identity mismatch')
    if (!existsSync(accepted)) throw new Error('Prompt delivery uncertain; do not resend automatically')
    return
  }
  const requestId = randomUUID()
  durableWrite(started, JSON.stringify({ requestId, session, turn, hash }) + '\n')
  await send(requestId)
  durableWrite(accepted, 'Prompt accepted\n')
}
