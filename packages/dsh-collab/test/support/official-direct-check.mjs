import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { moduleOf } from './controller-harness.mjs'
export const name = 'collab-official-direct-check'
export const inject = ['tools', 'agents', 'sessionController']
export async function apply(ctx, config) {
  const { SessionId } = await moduleOf('dsh-session')
  let keepalive
  ctx.effect(() => () => clearInterval(keepalive))
  ctx.get('appReady').onReady(async () => {
    try {
      const agent = ctx.agents.get(SessionId('direct-caller'))
      assert.ok(agent)
      const before = config.replay ? await readFile(join(config.dataDir, 's.jsonl')) : undefined
      const r = await ctx.tools.execute({ callId: 'direct-create', name: 'collab_create_space', arguments: { spaceId: 's', cmdId: 'create', name: 'a' }, agent, signal: AbortSignal.timeout(5000) })
      assert.deepEqual(r.value, { seq: 1, spaceId: 's' })
      const state = await ctx.tools.execute({ callId: 'direct-read', name: 'collab_overview', arguments: { spaceId: 's' }, agent, signal: AbortSignal.timeout(5000) })
      assert.equal(state.value.members.a.binding.address, agent.id)
      if (before) assert.deepEqual(await readFile(join(config.dataDir, 's.jsonl')), before)
      keepalive = setInterval(() => {}, 60000)
      await writeFile(config.ready, JSON.stringify({ serviceId: state.value.serviceId, receipt: r.value }))
    } catch (error) { await writeFile(config.failed, String(error.stack ?? error)) }
  })
}
