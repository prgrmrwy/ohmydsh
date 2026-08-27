import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

function parse(text) {
  return yaml.load(text, { schema: entryListSchema })
}

function testService(Service) {
  const service = Object.create(Service.prototype)
  service.interceptors = new Map()
  service.ctx = {
    effect(install) {
      const dispose = install()
      return async () => { await dispose?.() }
    },
  }
  return service
}

test('built package carries an official-identity fixed-source Connection with the middleware seam', async () => {
  const artifact = path.join(PKG, 'lib/connection')
  const host = await import(`${pathToFileURL(path.join(artifact, 'lib/index.js')).href}?v=${Date.now()}`)
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof host.HostConnectionService, 'function')

  const metadata = JSON.parse(await readFile(path.join(artifact, 'package.json'), 'utf8'))
  assert.equal(metadata.name, '@deepseek-ai/dsh-client-connection')
  assert.equal(metadata.version, '0.1.1-rc.2')
  assert.equal(metadata.main, 'lib/index.js')
  assert.equal(metadata.types, 'lib/types/index.d.ts')
  assert.deepEqual(metadata.exports['./client'], {
    types: './lib/types/client/index.d.ts', default: './lib/client.js',
  })
  assert.deepEqual(metadata.exports['./invariant'], {
    types: './lib/types/invariant.d.ts', default: './lib/invariant.js',
  })
  assert.equal(metadata.exports['./src/*'], './src/*')
  assert.deepEqual(metadata.dependencies, {
    '@deepseek-ai/schemastery': '^3.18.1', ws: '^8.21.0',
  })
  assert.equal(metadata.peerDependencies['@deepseek-ai/cordis'], '^4.0.1')
  assert.equal(metadata.peerDependencies['@deepseek-ai/dsh-host-apiproxy'], '^0.1.1-rc.2')
  assert.equal(metadata.license, 'MIT')
  assert.equal((await readFile(path.join(artifact, 'LICENSE'), 'utf8')).length > 0, true)
  assert.equal((await readFile(path.join(artifact, 'lib/types/index.d.ts'), 'utf8')).length > 0, true)
  assert.equal((await readFile(path.join(artifact, 'src/rpc-host.ts'), 'utf8')).includes('get api()'), true)
  assert.equal(metadata.dsh.client.platform, 'web')
  assert.equal(metadata.dsh.client.immediately, true)
  assert.equal(metadata.federationProvenance.patchSha256,
    'e1b6c2d17a5efa05918c8044b011874c363c3f2cd7a4d83b7a2b5990aa87d0b9')
  assert.deepEqual(metadata.federationProvenance.toolchain, {
    node: process.version,
    esbuild: JSON.parse(await readFile(path.join(REPO, 'node_modules/esbuild/package.json'), 'utf8')).version,
    typescript: JSON.parse(await readFile(path.join(REPO, 'node_modules/typescript/package.json'), 'utf8')).version,
  })

  const browser = await readFile(path.join(artifact, 'lib/client.js'), 'utf8')
  assert.match(browser, /id: "@deepseek-ai\/dsh-client-connection"/)
  assert.deepEqual([...browser.matchAll(/require\((['"])(.*?)\1\)/g)].map(match => match[2]), [],
    'Connection declares no dsh.client.inject entries, so its browser bundle must be self-contained')

  // Prove the deployed Host artifact exposes real exclusive middleware
  // ownership, not merely source text or a declaration file.
  const service = testService(host.HostConnectionService)
  const dispose = service.api.use(async (request, next) => next.fetch(request))
  assert.throws(() => service.api.use(async (request, next) => next.fetch(request)),
    /already has an outer middleware/)
  await dispose()
  const disposeAgain = service.api.use(async (request, next) => next.fetch(request))
  await disposeAgain()
})

test('federation composition keeps the single official Connection row identity', async () => {
  const federationPatches = parse(await readFile(path.join(PKG, 'cordis.patch.yml'), 'utf8'))
  const officialRows = [{
    id: 'connection',
    name: '@deepseek-ai/dsh-client-connection',
    inject: ['webRuntime'],
    config: { trustedHosts: ['127.0.0.1'] },
  }]
  const warnings = []
  const composed = applyEntryPatches(officialRows, federationPatches, (...args) => warnings.push(args))
  const connection = composed.find(row => row.id === 'connection')
  assert.ok(connection, 'official connection row must remain present')
  assert.equal(connection.name, '@deepseek-ai/dsh-client-connection')
  assert.deepEqual(connection.inject, ['webRuntime'])
  assert.ok(connection.config?.trustedHosts)
  assert.equal(composed.filter(row => row.id === 'connection').length, 1)
  assert.equal(composed.find(row => row.id === 'dsh-federation')?.name, 'dsh-federation')
  assert.deepEqual(warnings, [])
})
