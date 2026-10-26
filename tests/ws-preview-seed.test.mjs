import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { seedPreview, PATCH_ANCHOR, SEED_FILES } from '../scripts/lib/ws-preview-seed.mjs'
import { stopPreview, previewPorts } from '../scripts/launcher/preview.mjs'

async function fixture(t, built = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-seed-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo'), common = path.join(root, 'git'), source = path.join(root, 'source'), home = path.join(common, 'ws/dsh-home/operation-1234')
  for (const dir of [repo, source, home]) await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const put = async (base, file, data) => { await fs.mkdir(path.dirname(path.join(base, file)), { recursive: true }); await fs.writeFile(path.join(base, file), data) }
  if (built) {
    await put(home, 'profiles/web/package.json', '{}')
    await put(home, 'profiles/web/cordis.patch.yml', `${PATCH_ANCHOR}\n- id: other\n  config: keep\n`)
  }
  return { root, repo, source, home, put, env: { WS_WORKTREE: await fs.realpath(repo), WS_GIT_COMMON_DIR: await fs.realpath(common), WS_DSH_HOME: await fs.realpath(home), WS_SOURCE_DSH_HOME: await fs.realpath(source), WS_OPERATION_ID: 'operation-1234' } }
}
test('seed allowlist, credential exclusion, exact auth, idempotence and preview-local preservation', async t => {
  const f = await fixture(t)
  for (const file of SEED_FILES) await f.put(f.source, file, file.endsWith('auth.json') ? '{"codex":[],"claude":[]}\n' : '{}\n')
  await f.put(f.source, '.credentials.yaml', yaml.dump({ version: 1, refs: { API_KEY: 'fake' }, records: { 'client-connection/browser-session': 'source-fake' } }))
  await f.put(f.home, '.credentials.yaml', yaml.dump({ records: { 'client-connection/browser-session': 'preview-fake' } }))
  await f.put(f.source, 'profiles/web/cordis.patch.yml', `${PATCH_ANCHOR}\n- id: agent-default-model\n  config: {model: test}\n- id: ui-theme\n  config: do-not-copy\n`)
  await f.put(f.source, 'profiles/web/.npmrc', 'registry=https://example.invalid\n@scope:registry=https://scope.invalid\n//example.invalid/:_authToken=do-not-copy\n')
  await f.put(f.home, 'sessions/local', 'preview session')
  await f.put(f.source, 'sessions/source', 'do not copy')
  const sourceAuth = await fs.readFile(path.join(f.source, SEED_FILES[0]), 'utf8')
  const sourceCredentials = await fs.readFile(path.join(f.source, '.credentials.yaml'), 'utf8')
  const options = { env: f.env, repo: f.repo, log() {} }
  const first = await seedPreview(options)
  assert(first.writes > 0)
  assert.equal((await seedPreview(options)).writes, 0)
  assert.equal(await fs.readFile(path.join(f.home, SEED_FILES[0]), 'utf8'), await fs.readFile(path.join(f.source, SEED_FILES[0]), 'utf8'))
  const creds = yaml.load(await fs.readFile(path.join(f.home, '.credentials.yaml'), 'utf8'))
  assert.equal(creds.records['client-connection/browser-session'], 'preview-fake')
  assert(!JSON.stringify(creds).includes('source-fake'))
  const patch = await fs.readFile(path.join(f.home, 'profiles/web/cordis.patch.yml'), 'utf8')
  assert.match(patch, /agent-default-model/); assert.match(patch, /other/); assert(!patch.includes('ui-theme'))
  assert(!(await fs.readFile(path.join(f.home, 'profiles/web/.npmrc'), 'utf8')).includes('authToken'))
  assert.equal(await fs.readFile(path.join(f.home, 'sessions/local'), 'utf8'), 'preview session')
  await assert.rejects(fs.stat(path.join(f.home, 'sessions/source')))
  assert.equal((await fs.stat(path.join(f.home, SEED_FILES[0]))).mode & 0o777, 0o600)
  assert.equal(first.port, (await seedPreview(options)).port)
  assert.equal(await fs.readFile(path.join(f.source, SEED_FILES[0]), 'utf8'), sourceAuth)
  assert.equal(await fs.readFile(path.join(f.source, '.credentials.yaml'), 'utf8'), sourceCredentials)
})
test('before build or with an unsafe destination seed refuses without writes', async t => {
  const f = await fixture(t, false)
  await assert.rejects(seedPreview({ env: f.env, repo: f.repo }), /dsh build/)
  assert.deepEqual(await fs.readdir(f.home), [])
  await assert.rejects(seedPreview({ env: { ...f.env, WS_DSH_HOME: f.source }, repo: f.repo }), /operation-owned/)
  assert.deepEqual(await fs.readdir(f.source), [])
  await assert.rejects(seedPreview({ env: { ...f.env, WS_SOURCE_DSH_HOME: f.home }, repo: f.repo }), /differ/)
  assert.deepEqual(await fs.readdir(f.home), [])
})
test('preview stop checks recorded identity and ports wrap with a bounded limit', async t => {
  const f = await fixture(t)
  const file = path.join(f.home, 'preview.json')
  const record = { port: 3279, pid: 12345, created: 'start-time' }
  const owned = { state: 'owned', processes: [{ ...record, argv: ['node', 'dsh'] }] }
  let stopped = 0
  const stop = async () => { stopped++; return { ok: true } }
  await fs.writeFile(file, JSON.stringify(record))
  await stopPreview(f.home, { probe: async () => ({ ...owned, processes: [{ ...record, pid: 23456 }] }), stop })
  assert.equal(stopped, 0)
  await fs.writeFile(file, JSON.stringify(record))
  await stopPreview(f.home, { probe: async () => owned, stop })
  assert.equal(stopped, 1)
  await stopPreview(f.home, { probe: async () => { throw Error('must not probe') }, stop })
  assert.deepEqual(previewPorts(3279).slice(0, 3), [3279, 3180, 3181])
  assert.equal(previewPorts(3279).length, 20)
  assert.deepEqual(previewPorts(3200, true), [3200])
})
