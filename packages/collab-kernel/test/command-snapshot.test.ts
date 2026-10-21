import { expect, it } from 'vitest'
import { world } from './support/world.js'

it('a queued command keeps the payload whose receipt it hashes', async () => {
  const w = await world()
  const input = { to: 'doubao', body: 'original', needsReply: false }
  const ctx = w.ctx('aily', 'stable-command')
  const pending = w.service.sendMessage(ctx, input)
  input.body = 'changed after admission'
  await pending
  const event = w.log().flatMap(r => r.events).find(e => e.type === 'message/sent')
  expect(event?.type === 'message/sent' && event.message.body).toBe('original')
  await expect(w.service.sendMessage(ctx, { to: 'doubao', body: 'original', needsReply: false })).resolves.toHaveProperty('seq')
})
