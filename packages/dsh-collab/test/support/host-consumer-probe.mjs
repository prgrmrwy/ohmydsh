import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { controller, presets, moduleOf, moduleUrl } from './controller-harness.mjs'
import { createRequire } from 'node:module'

// Official CLI owns signals and the finite shutdown budget. This fixture only
// owns a real consumer component graph and its awaitable lifecycle teardown.
export const name = 'collab-host-consumer-probe'
export async function apply(ctx, config) {
  let runtime, plugin, keepalive
  ctx.effect(() => async () => {
    await fs.writeFile(config.disposing, 'started')
    await plugin?.dispose()
    await runtime?.fiber.dispose()
    clearInterval(keepalive)
    await fs.writeFile(config.closed, 'consumer closed')
  })
  runtime = await controller(config.runtimeRoot)
  await presets(runtime)
  const { SessionId } = await moduleOf('dsh-session')
  const id = SessionId('official-consumer')
  const cwd = join(config.runtimeRoot, 'workspace')
  await fs.mkdir(cwd, { recursive: true })
  if (!config.replay) await runtime.sessionController.create({ sessionId: id, cwd, agentPreset: 'P1' })
  const agent = (await runtime.sessionController.resolveAgent(id)).agent
  assert.ok(agent)
  const consumerDeps = createRequire(pathToFileURL(config.consumer))
  for (const name of ['cordis', 'dsh-tools', 'dsh-llm', 'dsh-session']) {
    assert.equal(await fs.realpath(consumerDeps.resolve(`@deepseek-ai/${name}`)), await fs.realpath(new URL(moduleUrl(name))))
  }
  const module = await import(pathToFileURL(config.consumer).href)
  await runtime.sessions.flush(agent.session)
  const original = fs.open
  if (config.mode === 'budget') fs.open = async (...args) => {
    const handle = await original(...args)
    if (args[0] !== join(config.dataDir, 'probe.jsonl') || args[1] !== 'a') return handle
    return new Proxy(handle, { get(target, key) {
      if (key === 'sync') return async () => { await fs.writeFile(config.blocked, 'consumer commit reached fsync'); await new Promise(() => {}) }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
  try {
    // Capture the production plugin's Host log lines for lock-01 assertions.
    const lines = []
    if (config.hostLog) {
      const original = runtime.logger.bind(runtime)
      const wrap = name => { const logger = original(name); return new Proxy(logger, { get(target, key) { const value = Reflect.get(target, key, target); return ['info', 'warn'].includes(key) ? (...args) => { lines.push(args.map(String).join(' ')); return value.apply(target, args) } : (typeof value === 'function' ? value.bind(target) : value) } }) }
      runtime.logger = Object.assign(wrap, original)
    }
    plugin = runtime.plugin(module, { dataDir: config.dataDir })
    if (config.hostLog) void plugin.inertia.then(() => fs.writeFile(config.hostLog, JSON.stringify(lines)))
    await plugin.inertia
    assert.equal(plugin.state, 2)
  } finally { fs.open = original }
  keepalive = setInterval(() => {}, 60000)
  const command = runtime.tools.execute({ callId: 'official-create', name: 'collab_space', arguments: { action: 'create', spaceId: 'probe', cmdId: 'create', name: 'a' }, agent, signal: new AbortController().signal })
  if (config.mode === 'budget') void command.catch(error => { console.error(error); process.exitCode = 1 })
  else {
    const result = await command
    assert.deepEqual(result.value, { seq: 1, spaceId: 'probe' })
    const overview = await runtime.tools.execute({ callId: 'official-overview', name: 'collab_read', arguments: { view: 'overview', spaceId: 'probe' }, agent, signal: new AbortController().signal })
    assert.equal(overview.value.members.a.binding.address, id)
    assert.equal(overview.value.lastSeq, 1)
    if (config.replayed) await fs.writeFile(config.replayed, JSON.stringify({ receipt: result.value, serviceId: overview.value.serviceId, address: overview.value.members.a.binding.address }))
    await runtime.sessions.flush(agent.session)
  }
  ctx.get('appReady').onReady(() => { void fs.writeFile(config.ready, 'official appReady; consumer active') })
}
