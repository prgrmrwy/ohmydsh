import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveCliBin } from '../scripts/lib/dsh-cli.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONNECTION = path.join(REPO, 'packages/dsh-federation/lib/connection')
const FEDERATION = path.join(REPO, 'packages/dsh-federation')

function invocation() {
  const resolved = resolveCliBin({
    spec: '@deepseek-ai/dsh@0.1.1-rc.2', version: '0.1.1-rc.2', installProbe: false,
  })
  if (resolved === null) return undefined
  return resolved.kind === 'env'
    ? { command: resolved.bin, prefix: [] }
    : { command: process.execPath, prefix: [resolved.bin] }
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(error => error ? reject(error) : resolve(port))
  })
})

test('real rc.2 profile installs a self-consistent Connection override and boots one official graph', { timeout: 300_000 }, async t => {
  const dsh = invocation()
  if (dsh === undefined) return t.skip('pinned rc.2 DSH CLI is not locally ready')
  const root = await mkdtemp(path.join(os.tmpdir(), 'federation-connection-profile-'))
  const dshHome = path.join(root, 'dsh-home')
  const env = { ...process.env, DSH_HOME: dshHome, DSH_SKIP_UPDATE: '1' }
  let host
  try {
    // Other package-build tests deliberately replace `lib/` atomically. Snapshot
    // one complete publishable artifact before invoking pnpm so concurrent test
    // scheduling cannot make a file: source disappear halfway through add.
    const snapshot = path.join(root, 'packages/dsh-federation')
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(snapshot, { recursive: true })
        for (const file of ['package.json', 'cordis.patch.yml']) await cp(path.join(FEDERATION, file), path.join(snapshot, file))
        await cp(path.join(FEDERATION, 'lib'), path.join(snapshot, 'lib'), { recursive: true })
        JSON.parse(await readFile(path.join(snapshot, 'lib/connection/package.json'), 'utf8'))
        break
      } catch (error) {
        await rm(snapshot, { recursive: true, force: true })
        if (attempt >= 100) throw error
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    const snapshotConnection = path.join(snapshot, 'lib/connection')
    const add = spawnSync(dsh.command, [...dsh.prefix, 'plugin', '--profile', 'web', 'add',
      `file:${snapshotConnection}`, `file:${snapshot}`, '--ignore-scripts', '--reporter=silent'],
    { cwd: REPO, env, encoding: 'utf8' })
    assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`)

    const profile = path.join(dshHome, 'profiles/web')
    const profileRequire = createRequire(path.join(profile, 'package.json'))
    const packagePath = profileRequire.resolve('@deepseek-ai/dsh-client-connection/package.json')
    assert.ok((await realpath(packagePath)).startsWith(await realpath(profile)), packagePath)
    const packageRequire = createRequire(packagePath)
    const metadata = packageRequire('./package.json')
    assert.equal(metadata.federationProvenance.patchSha256,
      'e1b6c2d17a5efa05918c8044b011874c363c3f2cd7a4d83b7a2b5990aa87d0b9')
    // Own runtime dependencies must resolve immediately after add, before any
    // DSH profile boot/fallback healing.
    assert.match(packageRequire.resolve('@deepseek-ai/schemastery'), /schemastery/)
    assert.match(packageRequire.resolve('ws'), /ws/)
    assert.ok((await realpath(profileRequire.resolve('@deepseek-ai/dsh-client-connection/invariant')))
      .startsWith(await realpath(profile)))

    const profilePkg = profileRequire('./package.json')
    assert.deepEqual(profilePkg.dsh.profile.bundles,
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-federation'])

    const port = await freePort()
    host = spawn(dsh.command, [...dsh.prefix, 'web', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: REPO, env, stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 200; attempt++) {
      if (host.exitCode !== null) assert.fail(`real DSH Host exited early: ${host.exitCode}`)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`)
        if (response.ok) break
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const response = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(response.ok, true)

    // Profile preparation has now installed the official peer fallback graph;
    // the compatibility invariant subpath and Host face both import from the
    // profile-resolved override without installing a second bundle row.
    const hostModule = await import(`${pathToFileURL(profileRequire.resolve('@deepseek-ai/dsh-client-connection')).href}?v=${Date.now()}`)
    const invariant = await import(`${pathToFileURL(profileRequire.resolve('@deepseek-ai/dsh-client-connection/invariant')).href}?v=${Date.now()}`)
    assert.equal(typeof hostModule.HostConnectionService, 'function')
    assert.equal(typeof invariant.apply, 'function')

    host.kill('SIGTERM')
    await new Promise(resolve => host.once('exit', resolve))
    host = undefined

    const remove = spawnSync(dsh.command, [...dsh.prefix, 'plugin', '--profile', 'web', 'remove',
      'dsh-federation', '@deepseek-ai/dsh-client-connection', '--reporter=silent'],
    { cwd: REPO, env, encoding: 'utf8' })
    assert.equal(remove.status, 0, `${remove.stdout}\n${remove.stderr}`)
    const after = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
    assert.deepEqual(after.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    assert.equal(after.dependencies?.['@deepseek-ai/dsh-client-connection'], undefined)
  } finally {
    if (host?.exitCode === null && host?.signalCode === null) {
      host.kill('SIGKILL')
      await new Promise(resolve => host.once('exit', resolve))
    }
    await rm(root, { recursive: true, force: true })
  }
})
