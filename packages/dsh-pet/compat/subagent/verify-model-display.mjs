#!/usr/bin/env node
// Probe only the supplied compiled graph, with an inert adapter and no credentials.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--graph' || !isAbsolute(args[1])) throw new Error('Usage: verify-model-display.mjs --graph /absolute/launcher')
const requireGraph = createRequire(resolve(args[1], 'package.json'))
const load = async name => import(pathToFileURL(requireGraph.resolve(name)).href)
const template = JSON.parse(readFileSync(new URL('./model-display.package.template.json', import.meta.url), 'utf8'))
for (const spec of template.packages) {
  const file = requireGraph.resolve(`${spec.name}/package.json`)
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(pkg.version, template.version)
  assert.equal(pkg.dsh_compat?.patchSha256, template.patchSha256)
  assert.equal(pkg.dsh_compat?.upstreamBase, '639ed015397290b3745d163aafe02ffee4aa3f84')
  assert.equal(realpathSync(requireGraph.resolve(spec.name)), realpathSync(join(dirname(file), pkg.main)))
  if (spec.client) assert.ok(readFileSync(join(dirname(file), 'lib/client.js'), 'utf8').includes('__ModuleLoader__'))
}
const [{ Context }, Llm, { SessionController }] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'), load('@deepseek-ai/dsh-api-session-controller'),
])
const ctx = new Context()
try {
  await ctx.plugin(Llm.default)
  const metadata = Object.freeze({ id: 'family', label: 'Gateway · Family' })
  class Fake extends Llm.LlmAdapter {
    providerInfo(id) { return { id, name: 'Gateway' } }
    async listModels(provider) { return [{ provider, id: 'family/model', name: 'Model' }] }
    async resolveModel(provider, id) { return { provider, id, name: 'Model', displayGroup: metadata } }
    async *stream() { throw new Error('unexpected provider call') }
  }
  ctx.llm.registerAdapter(['gateway'], new Fake())
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'gateway', model: 'family/model' }) })
  const exact = await ctx.llm.resolveModelInfo('gateway', 'family/model')
  assert.deepEqual(exact.displayGroup, metadata)
  assert.notEqual(exact.displayGroup, metadata)
  // Execute the real controller method without initializing unrelated file/agent services.
  const receiver = Object.create(SessionController.prototype)
  Object.defineProperty(receiver, 'ctx', { value: ctx })
  const catalog = await receiver.modelCatalog()
  assert.deepEqual(catalog.routableProviders, ['gateway'])
  assert.deepEqual(catalog.groups[0].models[0].displayGroup, metadata)
  // Parse through the generated Remote codec, not a handwritten approximation.
  const { default: descriptor } = await load('@deepseek-ai/dsh-api-session-controller/remote')
  const method = descriptor.descriptors.find(method => method.namespace === 'session' && method.method === 'modelCatalog')
  assert.deepEqual(method.result.create().parse(catalog).groups[0].models[0].displayGroup, metadata)
  const remotesDir = dirname(requireGraph.resolve('@deepseek-ai/dsh-api-remotes/package.json'))
  assert.ok(readFileSync(join(remotesDir, 'lib/client.js'), 'utf8').includes('displayGroup'), 'aggregate Client response codec')
  const uiDir = dirname(requireGraph.resolve('@deepseek-ai/dsh-client-ui-model-selection/package.json'))
  const ui = readFileSync(join(uiDir, 'lib/client.js'), 'utf8')
  for (const marker of ['displayGroup', 'searchText']) assert.ok(ui.includes(marker), `selector ${marker}`)
  assert.ok(!ui.includes('actualAndNext'), 'selector uses the official single effort caption')
  const apiDir = dirname(requireGraph.resolve('@deepseek-ai/dsh-api-session-controller/package.json'))
  const nested = createRequire(join(apiDir, 'package.json'))
  assert.equal(realpathSync(nested.resolve('@deepseek-ai/dsh-llm')), realpathSync(requireGraph.resolve('@deepseek-ai/dsh-llm')))
  console.log('[compat/model-display] compiled metadata, controller catalog, generated codecs and UI artifacts verified')
} finally { await ctx.fiber.dispose() }
