// Update check and auto-update with overlay entries (design D8).
//
// A local http registry stands in for both the default registry and a scoped
// one, so the scoped path can prove it went through npm with the profile's
// auth token rather than an unauthenticated fetch — no external network.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { detectRemotePluginUpdates } from '../scripts/lib/plugin-updates.mjs'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const HEAD = 'dshVersion: 0.1.0-rc.7\ndependencies: []\n'
const remoteEntry = (id, spec, version = '1.0.0') =>
  `  - id: ${id}\n    type: package\n    source: remote\n    spec: '${spec}'\n    version: ${version}\n    enabled: true\n`

function packument(name, latest) {
  const now = new Date().toISOString()
  return {
    name,
    'dist-tags': { latest },
    versions: {
      '1.0.0': { name, version: '1.0.0' },
      [latest]: { name, version: latest, dist: { tarball: `http://127.0.0.1/${name}.tgz` } },
    },
    time: { '1.0.0': now, [latest]: now, modified: now, created: now },
  }
}

async function startRegistry(t, packages) {
  const requests = []
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.slice(1).split('?')[0])
    requests.push({ name, authorization: req.headers.authorization })
    const latest = packages[name]
    if (latest === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"not found"}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(packument(name, latest)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}`, port, requests }
}

function runAsync(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

async function updateFixture(t, { publicEntries = '', overlay, npmrc }) {
  const fx = await overlayFixture({ manifest: `${HEAD}customizations:${publicEntries ? '\n' + publicEntries : ' []\n'}` })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  if (overlay !== undefined) await fx.writeOverlay(`customizations:\n${overlay}`)
  const userconfig = path.join(fx.root, 'empty-user-npmrc')
  await writeFile(userconfig, '')
  if (npmrc !== undefined) await writeFile(path.join(fx.profile, '.npmrc'), npmrc)
  const clean = Object.fromEntries(Object.keys(process.env).filter((k) => /^npm_config_/i.test(k)).map((k) => [k, undefined]))
  const env = fx.env({ ...clean, npm_config_userconfig: userconfig, npm_config_update_notifier: 'false' })
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key]
  return { ...fx, env: () => env }
}

test('every update row carries fromOverlay', async (t) => {
  const registry = await startRegistry(t, { 'dsh-a': '1.0.0', 'dsh-b': '1.1.0' })
  const fx = await updateFixture(t, {
    publicEntries: remoteEntry('a', 'dsh-a@1.0.0'),
    overlay: remoteEntry('b', 'dsh-b@1.0.0') + remoteEntry('g', 'github:example/g#v1').replace("version: 1.0.0\n", "version: 1.0.0\n    name: dsh-g\n"),
  })
  const { rows } = await detectRemotePluginUpdates({
    manifestPath: path.join(fx.repo, 'dsh.yaml'), repo: fx.repo, registry: registry.url, dshVersion: '0.1.0-rc.7', env: fx.env(),
  })
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  assert.deepEqual(Object.keys(byId).sort(), ['a', 'b', 'g'])
  assert.equal(byId.a.fromOverlay, false)
  assert.equal(byId.b.fromOverlay, true)
  assert.equal(byId.g.status, 'skipped')
  assert.equal(byId.g.fromOverlay, true)
})

test('scoped package metadata goes through npm with profile auth', async (t) => {
  const registry = await startRegistry(t, { '@example/q': '1.1.0' })
  const fx = await updateFixture(t, {
    overlay: remoteEntry('q', '@example/q@1.0.0'),
    npmrc: `@example:registry=${registry.url}/\n//127.0.0.1:${registry.port}/:_authToken=test-token\n`,
  })
  const { rows } = await detectRemotePluginUpdates({
    manifestPath: path.join(fx.repo, 'dsh.yaml'), repo: fx.repo,
    // The default registry is unreachable: only the scoped route can succeed.
    registry: 'http://127.0.0.1:9', dshVersion: '0.1.0-rc.7', env: fx.env(),
  })
  const scoped = registry.requests.filter((r) => r.name === '@example/q')
  assert.ok(scoped.length > 0, `expected a metadata request for @example/q, got ${JSON.stringify(registry.requests)}`)
  assert.ok(scoped.every((r) => r.authorization === 'Bearer test-token'), JSON.stringify(scoped))
  const row = rows.find((r) => r.id === 'q')
  assert.equal(row.latest, '1.1.0', JSON.stringify(row))
  assert.equal(row.status, 'upgrade-ready', JSON.stringify(row))
})

test('plugin-update skips overlay rows without touching dsh.yaml', async (t) => {
  const registry = await startRegistry(t, { '@example/b': '1.1.0' })
  const fx = await updateFixture(t, {
    overlay: remoteEntry('b', '@example/b@1.0.0'),
    npmrc: `@example:registry=${registry.url}/\n//127.0.0.1:${registry.port}/:_authToken=test-token\n`,
  })
  const git = (...args) => spawnSync('git', ['-C', fx.repo, ...args], { encoding: 'utf8' })
  assert.equal(git('init', '-q').status, 0)
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A')
  assert.equal(git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init').status, 0)
  const commitsBefore = git('rev-list', '--count', 'HEAD').stdout
  const manifestBefore = await readFile(path.join(fx.repo, 'dsh.yaml'))

  // Async spawn: the fake registry lives in this process and must keep serving.
  const result = await runAsync(process.execPath, [path.join(fx.repo, 'scripts', 'plugin-update.mjs'), '--yes'], { cwd: fx.repo, env: fx.env() })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /\bb\b.*overlay/)
  assert.deepEqual(await readFile(path.join(fx.repo, 'dsh.yaml')), manifestBefore)
  assert.equal(git('rev-list', '--count', 'HEAD').stdout, commitsBefore)
})
