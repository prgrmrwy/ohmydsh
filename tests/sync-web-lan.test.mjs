import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SYNC_SCRIPT = path.join(REPO, 'scripts', 'sync.mjs')

async function fixture({ web, open } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-web-lan-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  await mkdir(path.join(repo, 'scripts'), { recursive: true })
  await mkdir(path.join(dshHome, 'profiles', 'web'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(SYNC_SCRIPT))
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')))
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(
    path.join(dshHome, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2) + '\n',
  )
  const webLines = []
  if (web !== undefined) webLines.push(`  lan: ${JSON.stringify(web)}`)
  if (open !== undefined) webLines.push(`  open: ${JSON.stringify(open)}`)
  const webYaml = webLines.length ? `web:\n${webLines.join('\n')}\n` : ''
  await writeFile(
    path.join(repo, 'dsh.yaml'),
    `dshVersion: 0.1.0-rc.6\n${webYaml}dependencies: []\ncustomizations: []\n`,
  )

  const run = (extraEnv = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_BIN: '/usr/bin/true', DSH_HOME: dshHome, ...extraEnv },
  })

  const patchPath = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  return { root, repo, dshHome, patchPath, run }
}

test('web.lan true renders the 0.0.0.0 webserver override into the profile patch, idempotently', async () => {
  const fx = await fixture({ web: true })

  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  const patch = await readFile(fx.patchPath, 'utf8')
  assert.match(patch, /fragment: web-lan/)
  assert.match(patch, /- id: webserver/)
  assert.match(patch, /host: !!js ctx\.webStartup\.host \?\? '0\.0\.0\.0'/)
  assert.match(patch, /port: !!js ctx\.webStartup\.port \?\? 3080/)

  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.equal(await readFile(fx.patchPath, 'utf8'), patch)
})

test('absent or false web.lan leaves the profile patch without the LAN override', async () => {
  for (const web of [undefined, false]) {
    const fx = await fixture({ web })
    const result = fx.run()
    assert.equal(result.status, 0, result.stderr)
    const patch = await readFile(fx.patchPath, 'utf8')
    assert.doesNotMatch(patch, /0\.0\.0\.0/)
  }
})

test('non-boolean web.lan fails the sync with a manifest error', async () => {
  const fx = await fixture({ web: 123 })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /web\.lan/)
})

test('web.open: false passes sync idempotently without touching the patch', async () => {
  const fx = await fixture({ open: false })
  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  const patch = await readFile(fx.patchPath, 'utf8')
  assert.doesNotMatch(patch, /0\.0\.0\.0/)
  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.equal(await readFile(fx.patchPath, 'utf8'), patch)
})

test('non-boolean web.open fails the sync with a manifest error', async () => {
  const fx = await fixture({ open: 'false' })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /web\.open/)
})

test('DSH_LAN env overrides the manifest: enables when the manifest is off', async () => {
  const fx = await fixture({ web: false })
  const result = fx.run({ DSH_LAN: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(await readFile(fx.patchPath, 'utf8'), /host: !!js ctx\.webStartup\.host \?\? '0\.0\.0\.0'/)
})

test('DSH_LAN env overrides the manifest: disables when the manifest is on', async () => {
  const fx = await fixture({ web: true })
  const result = fx.run({ DSH_LAN: '0' })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(await readFile(fx.patchPath, 'utf8'), /0\.0\.0\.0/)
})
