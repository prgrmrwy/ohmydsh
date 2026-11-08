// Official-runtime acceptance for the behaviour the `fs-observation-policy`
// entry buys (change upgrade-dsh-0-2-2-runtime, specs/fs-observation-policy).
//
// Composes the real @deepseek-ai/dsh-fs-observation-policy, dsh-tool-fs and the
// local fs backend in-process and drives the model-facing `read` / `edit` tools.
// Not part of `npm test`; run explicitly:
//
//   DSH_TEST_OFFICIAL_RUNTIME=/abs/dir/with/node_modules node --test tests/fs-observation-policy-runtime.official.mjs
//
// Never skip when the prerequisite is absent: report what is missing.
//
// Only the session identity and working-directory are stubbed: the policy keys
// its observed state by `exec.agent.session`, and the real working-directory
// service needs a persisted session projection that is irrelevant here.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

const root = path.resolve(import.meta.dirname, '..')
const dshVersion = yaml.load(fs.readFileSync(path.join(root, 'dsh.yaml'), 'utf8')).dshVersion
const runtime = process.env.DSH_TEST_OFFICIAL_RUNTIME
assert(runtime && path.isAbsolute(runtime), 'DSH_TEST_OFFICIAL_RUNTIME must name an absolute directory holding a complete @deepseek-ai/dsh install')
const requireRuntime = createRequire(path.join(runtime, 'package.json'))
assert.equal(JSON.parse(fs.readFileSync(requireRuntime.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version, dshVersion, 'runtime @deepseek-ai/dsh version must equal dsh.yaml dshVersion')
for (const name of ['dsh-fs-observation-policy', 'dsh-tool-fs', 'dsh-fs-local']) {
  assert.equal(JSON.parse(fs.readFileSync(requireRuntime.resolve(`@deepseek-ai/${name}/package.json`), 'utf8')).version, dshVersion, `${name} version must equal dshVersion`)
}
const load = (name) => import(pathToFileURL(requireRuntime.resolve(`@deepseek-ai/${name}`)).href)
const { Context } = await load('cordis')
const { default: Llm } = await load('dsh-llm')

/** A composition with (or without) the observation policy, and a stub agent owning the observed state. */
async function compose(t, { policy }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-observation-runtime-')))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    assert(dir.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'fs-observation-runtime-')))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const install = async (name, config = {}) => {
    const mod = await load(name)
    await ctx.plugin(mod.default ?? mod, config).inertia
  }
  await ctx.plugin(Llm)
  for (const name of ['dsh-session', 'dsh-session-projection']) await install(name)
  await install('dsh-system-prompt', { persona: '' })
  await install('dsh-tools')
  await install('dsh-fs-local')
  ctx.provide('workingDirectory')
  ctx.set('workingDirectory', { ensure: async () => dir })
  if (policy) await install('dsh-fs-observation-policy')
  await install('dsh-tool-fs')
  const session = { header: { cwd: dir }, append() {}, requestHeader: () => undefined }
  const agent = { session, ctx: { fiber: { assertActive() {} } }, inject() {}, options: {} }
  const run = (name, args) => ctx.tools.get(name).execute(args, { agent, signal: new AbortController().signal, callId: `call-${Math.random()}` })
  return { dir, run }
}

test('spec Scenario "未读先改被拒绝"', async (t) => {
  const { dir, run } = await compose(t, { policy: true })
  const file = path.join(dir, 'unread.txt')
  fs.writeFileSync(file, 'original\n')
  await assert.rejects(run('edit', { file_path: file, old_string: 'original', new_string: 'changed' }), { code: 'FS_NOT_OBSERVED' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'original\n', 'file must be unchanged')
})

test('spec Scenario "读后被外部修改再编辑被拒绝"', async (t) => {
  const { dir, run } = await compose(t, { policy: true })
  const file = path.join(dir, 'f.txt')
  fs.writeFileSync(file, 'original\n')
  await run('read', { file_path: file })
  fs.writeFileSync(file, 'external write\n')
  await assert.rejects(run('edit', { file_path: file, old_string: 'external', new_string: 'agent' }), { code: 'FS_STALE_VERSION' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'external write\n', 'the external content must survive')
  await run('read', { file_path: file })
  await run('edit', { file_path: file, old_string: 'external', new_string: 'agent' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'agent write\n')
})

test('negative control: without the policy the same unread edit succeeds (official default)', async (t) => {
  const { dir, run } = await compose(t, { policy: false })
  const file = path.join(dir, 'unread.txt')
  fs.writeFileSync(file, 'original\n')
  await run('edit', { file_path: file, old_string: 'original', new_string: 'changed' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed\n')
})
