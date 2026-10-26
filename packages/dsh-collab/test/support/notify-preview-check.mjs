import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { moduleOf, presets } from './controller-harness.mjs'

export const name = 'collab-notify-preview-check'
export const inject = ['appReady', 'sessionController', 'sessions', 'llm', 'agentPresets', 'dshCollab', 'tools']
export async function apply(ctx, config) {
  const { LlmAdapter, createUserMessage } = await moduleOf('dsh-llm')
  const { SessionId } = await moduleOf('dsh-session')
  class LocalModel extends LlmAdapter {
    barrier
    requests = []
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) {
      this.requests.push(request)
      if (this.barrier) { const barrier = this.barrier; this.barrier = undefined; barrier.enter(); await barrier.wait }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'isolated local acceptance' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'isolated local acceptance' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const model = new LocalModel()
  ctx.llm.registerAdapter(['scripted'], model)
  await presets(ctx)
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  const call = async (agent, name, args) => {
    const result = await ctx.tools.execute({ callId: `accept-${name}`, name, arguments: args, agent, signal: AbortSignal.timeout(10000) })
    assert.ok(!result.isError && !result.value?.error, JSON.stringify(result))
    return result.value
  }
  const overview = (agent, spaceId) => call(agent, 'collab_read', { view: 'overview', spaceId })
  const drain = async (agent, spaceId) => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const state = await overview(agent, spaceId)
      if (!state.inFlightDeliveries.length) { assert.deepEqual(state.pendingDeliveries, []); return state }
      await pause(20)
    }
    throw new Error(`delivery did not finish: ${spaceId}`)
  }
  const turns = agent => agent.session.snapshotEvents().filter(event => event.type === 'turn/end').length
  const matchesPointer = (block, spaceId, seq) => {
    if (block.type !== 'text') return false
    const pointer = JSON.parse(block.text.split('\n').at(-1))
    return pointer.spaceId === spaceId && pointer.toSeq === seq
  }
  const pointerMessages = (agent, spaceId, seq) => agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'plugin:dsh-collab' && event.data.content.some(block => matchesPointer(block, spaceId, seq)))
  async function run() {
    const senderId = SessionId('notify-preview-sender'), targetId = SessionId('notify-preview-target')
    const cwd = join(config.root, 'workspace')
    await mkdir(cwd, { recursive: true })
    if (!config.replay) for (const sessionId of [senderId, targetId]) await ctx.sessionController.create({ sessionId, cwd, agentPreset: 'P1' })
    const sender = (await ctx.sessionController.resolveAgent(senderId)).agent
    const target = (await ctx.sessionController.resolveAgent(targetId)).agent
    assert.ok(sender && target, 'real SessionController must restore both Agents')
    const cases = []
    if (config.replay) {
      const original = JSON.parse(await readFile(config.first, 'utf8'))
      const before = await overview(sender, original.legacy.args.spaceId)
      const receipt = await call(sender, 'collab_send_message', original.legacy.args)
      assert.deepEqual(receipt, original.legacy.receipt)
      const after = await drain(sender, original.legacy.args.spaceId)
      assert.equal(after.lastSeq, before.lastSeq)
      assert.equal(after.serviceId, original.legacy.serviceId)
      assert.equal(model.requests.length, 0, 'old receipt replay must not call any model')
      cases.push({ case: 'restart-receipt', receiptStable: true, serviceIdStable: true, noNewCommit: true, modelCalls: 0 })
    } else {
      const combinations = [
        { key: 'tt', notify: true, needsReply: true }, { key: 'tf', notify: true, needsReply: false },
        { key: 'ft', notify: false, needsReply: true }, { key: 'ff', notify: false, needsReply: false },
        { key: 'legacy-true', needsReply: true }, { key: 'legacy-false', needsReply: false },
        { key: 'legacy-empty' }, { key: 'busy', notify: true, needsReply: false, busy: true },
      ]
      let legacy
      for (const { key, busy, ...intent } of combinations) {
        const spaceId = `accept-${key}`
        await call(sender, 'collab_space', { action: 'create', spaceId, cmdId: 'create', name: 'a' })
        await call(sender, 'collab_invite', { spaceId, cmdId: 'invite', name: 'b', recipientSessionId: targetId })
        await drain(sender, spaceId); await target.whenIdle()
        const before = turns(target)
        const entered = deferred(), release = deferred()
        const requestCount = model.requests.length
        if (busy) {
          model.barrier = { enter: entered.resolve, wait: release.promise }
          target.followup(createUserMessage({ content: [{ type: 'text', text: 'unrelated isolated work' }], source: { kind: 'plugin:collab-preview' } }))
          await entered.promise
        }
        const args = { spaceId, cmdId: 'message', to: 'b', body: 'PRIVATE_RESULT_BODY', ...intent }
        let receipt
        try {
          receipt = await call(sender, 'collab_send_message', args)
          if (busy) {
            assert.equal(model.requests.length, requestCount + 1)
          }
        } finally { release.resolve() }
        const state = await drain(sender, spaceId)
        await target.whenIdle()
        const notified = intent.notify ?? intent.needsReply ?? false
        assert.equal(turns(target) - before, Number(notified) + Number(!!busy))
        const messages = pointerMessages(target, spaceId, receipt.seq)
        assert.equal(messages.length, Number(notified), 'one admitted pointer per notification')
        assert.ok(!JSON.stringify(messages).includes('PRIVATE_RESULT_BODY'))
        const commits = await call(target, 'collab_read', { spaceId, view: 'since', sinceSeq: receipt.seq - 1 })
        const sent = commits.find(commit => commit.seq === receipt.seq)
        assert.equal(sent.events.filter(event => event.type === 'dispatch/intended' && event.delivery.kind === 'wake').length, Number(notified))
        const status = await call(target, 'collab_status', { spaceId })
        assert.equal(status.spaces[0].pending.replies.length, Number(intent.needsReply ?? false))
        const countBeforeReplay = turns(target)
        assert.deepEqual(await call(sender, 'collab_send_message', args), receipt)
        assert.equal((await overview(sender, spaceId)).lastSeq, state.lastSeq)
        assert.equal(turns(target), countBeforeReplay)
        const headers = target.session.snapshotEvents().filter(event => event.type === 'request/header')
        const schemas = headers.at(-1).data.header.tools.filter(tool => tool.name.startsWith('collab_'))
        assert.equal(schemas.length, 11)
        assert.ok(JSON.stringify(schemas).includes('"notify"'), 'actual model schema must advertise notify')
        assert.ok(JSON.stringify(schemas).length <= 4200)
        cases.push({ case: key, notified, needsReply: intent.needsReply ?? false, turnsAdded: turns(target) - before, admittedPointers: messages.length, schemaChars: JSON.stringify(schemas).length, retryDidNotDuplicate: true })
        if (key === 'legacy-true') legacy = { args, receipt, serviceId: state.serviceId }
      }
      const errors = target.session.snapshotEvents().filter(event => event.type === 'turn/end' && event.data.reason.kind !== 'completed')
      assert.deepEqual(errors, [], 'all actual turns must complete')
      const requests = target.session.snapshotEvents().filter(event => event.type === 'request/context')
      assert.ok(requests.length > 0)
      assert.ok(requests.every(event => event.data.provider === 'scripted' && event.data.model === 'scripted'), 'all requests must use the local fixture model')
      for (const agent of [sender, target]) assert.equal(await ctx.sessions.flush(agent.session), true)
      const result = { cases, legacy, modelCalls: model.requests.length, model: 'scripted/local-only' }
      await writeFile(config.first, JSON.stringify(result, null, 2))
    }
    await writeFile(config.ready, JSON.stringify({ cases, restoredWithRealController: true, model: 'scripted/local-only', modelCalls: model.requests.length }, null, 2))
  }
  ctx.appReady.onReady(() => { void run().catch(error => writeFile(config.failed, error.stack || String(error))) })
}
