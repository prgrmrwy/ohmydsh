import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

test('publication rollback preserves targets and refuses unknown entities', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat publish 中文 '))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  for (const name of ['old', 'new']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'marker'), name) }
  const launcher = path.join(root, '.launcher')
  const create = () => fs.symlinkSync(path.join(root, 'old'), launcher, 'dir')
  create()
  const validate = () => { assert.equal(fs.readFileSync(path.join(launcher, 'marker'), 'utf8'), 'new'); return 'verified' }
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', verify: () => { throw Error('injected verification failure') } }), /injected/)
  assert.equal(fs.readFileSync(path.join(launcher, 'marker'), 'utf8'), 'old')
  assert.equal(fs.readFileSync(path.join(root, 'new/marker'), 'utf8'), 'new')
  assert.equal(publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', verify: validate }), 'verified')
  assert.equal(fs.readFileSync(path.join(root, 'old/marker'), 'utf8'), 'old')
  fs.unlinkSync(launcher)
  fs.mkdirSync(launcher)
  fs.writeFileSync(path.join(launcher, 'unknown'), 'keep')
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', verify: validate }), /unknown|symbolic/i)
  assert.equal(fs.readFileSync(path.join(launcher, 'unknown'), 'utf8'), 'keep')
})

test('publication rollback recognizes physical targets behind a symlinked parent', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-parent-alias-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const physical = path.join(root, 'physical'), alias = path.join(root, 'alias')
  fs.mkdirSync(physical)
  fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
  for (const name of ['old', 'new']) { fs.mkdirSync(path.join(physical, name)); fs.writeFileSync(path.join(physical, name, 'marker'), name) }
  const launcher = path.join(alias, '.launcher')
  fs.symlinkSync(path.join(alias, 'old'), launcher, 'dir')
  assert.throws(() => publishLauncher({ launcher, target: path.join(alias, 'new'), platform: 'win32', verify() { throw Error('reject aliased candidate') } }), error => error.message === 'reject aliased candidate')
  assert.equal(fs.readFileSync(path.join(launcher, 'marker'), 'utf8'), 'old')
  assert.equal(publishLauncher({ launcher, target: path.join(alias, 'new'), verify: () => true }), true)
  assert.equal(fs.readFileSync(path.join(launcher, 'marker'), 'utf8'), 'new')
})

test('interrupted handoffs and dangling links refuse publication without deletion', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-interrupted-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const launcher = path.join(root, '.launcher')
  const target = path.join(root, 'target'); fs.mkdirSync(target)
  const backup = launcher + '.previous-interrupted'
  fs.symlinkSync(target, backup, 'dir')
  assert.throws(() => publishLauncher({ launcher, target, platform: 'win32', verify() {} }), /residual|recovery/i)
  assert.equal(fs.lstatSync(backup).isSymbolicLink(), true)
  fs.unlinkSync(backup)
  fs.symlinkSync(path.join(root, 'missing'), launcher, 'dir')
  assert.throws(() => publishLauncher({ launcher, target, platform: 'win32', verify() {} }), /dangling|unknown/i)
  assert.equal(fs.lstatSync(launcher).isSymbolicLink(), true)
})

test('failed restoration preserves backup and both errors for next-call recovery gate', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-restore-failure-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  for (const name of ['old', 'new']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'marker'), name) }
  const launcher = path.join(root, '.launcher'); fs.symlinkSync(path.join(root, 'old'), launcher, 'dir')
  const io = { ...fs, renameSync(from, to) { if (from.includes('.previous-')) throw Error('restore failed'); return fs.renameSync(from, to) } }
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', io, verify() { throw Error('verify failed') } }), error => error instanceof AggregateError && /verify failed/.test(error.message) && /restore failed/.test(error.message))
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.launcher.previous-')), true)
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), verify() {} }), /recovery/)
  for (const name of ['old', 'new']) assert.equal(fs.readFileSync(path.join(root, name, 'marker'), 'utf8'), name)
})

test('same-target next replacement is retained after backup failure', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-next-replaced-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  for (const name of ['old', 'new']) fs.mkdirSync(path.join(root, name))
  const launcher = path.join(root, '.launcher'); fs.symlinkSync(path.join(root, 'old'), launcher, 'dir')
  let next, replacement
  const io = { ...fs, renameSync(from, to) {
    if (from === launcher) {
      next = path.join(root, fs.readdirSync(root).find(name => name.startsWith('.launcher.next-')))
      fs.renameSync(next, path.join(root, 'external-next'))
      fs.symlinkSync(path.join(root, 'new'), next, 'dir')
      replacement = fs.lstatSync(next).ino
      throw Error('backup interrupted')
    }
    return fs.renameSync(from, to)
  } }
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', io, verify: () => true }), /recovery failed/)
  assert.equal(fs.lstatSync(next).ino, replacement)
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), verify: () => true }), /recovery/)
})

test('same-target replacement is not owned by publication rollback', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-replaced-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  for (const name of ['old', 'new']) fs.mkdirSync(path.join(root, name))
  const launcher = path.join(root, '.launcher'); fs.symlinkSync(path.join(root, 'old'), launcher, 'dir')
  let replacement
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', verify() {
    fs.renameSync(launcher, path.join(root, 'external-backup'))
    fs.symlinkSync(path.join(root, 'new'), launcher, 'dir')
    replacement = fs.lstatSync(launcher).ino
    throw Error('verify rejected replacement')
  } }), /recovery failed/)
  assert.equal(fs.lstatSync(launcher).ino, replacement)
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.launcher.previous-')), true)
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), verify() {} }), /recovery/)
})

if (process.platform !== 'win32') test('POSIX failed restoration retains durable recovery backup without active-pointer gap', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-posix-restore-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  for (const name of ['old', 'new']) fs.mkdirSync(path.join(root, name))
  const launcher = path.join(root, '.launcher'); fs.symlinkSync(path.join(root, 'old'), launcher, 'dir')
  const io = { ...fs, renameSync(from, to) {
    assert.equal(fs.lstatSync(launcher).isSymbolicLink(), true)
    if (from.includes('.previous-')) throw Error('restore blocked')
    return fs.renameSync(from, to)
  } }
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), io, verify() { throw Error('verify rejected') } }), /recovery failed/)
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.launcher.previous-')), true)
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), verify() {} }), /recovery/)
})

test('handoff mutation failures preserve old pointer and never remove generations', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  for (const stage of ['create-next', 'backup-old', 'publish-next', 'cleanup-backup']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-stage-' + stage + '-'))
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
    for (const name of ['old', 'new']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'marker'), name) }
    const launcher = path.join(root, '.launcher'); fs.symlinkSync(path.join(root, 'old'), launcher, 'dir')
    const io = { ...fs,
      symlinkSync(target, link, type) { if (stage === 'create-next') throw Error(stage); return fs.symlinkSync(target, link, type) },
      renameSync(from, to) { if ((stage === 'backup-old' && from === launcher) || (stage === 'publish-next' && from.includes('.next-'))) throw Error(stage); return fs.renameSync(from, to) },
      unlinkSync(file) { if (stage === 'cleanup-backup' && file.includes('.previous-')) throw Error(stage); return fs.unlinkSync(file) },
    }
    assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), platform: 'win32', io, verify: () => true }), new RegExp(stage))
    assert.equal(fs.readFileSync(path.join(launcher, 'marker'), 'utf8'), stage === 'cleanup-backup' ? 'new' : 'old')
    if (stage === 'cleanup-backup') assert.throws(() => publishLauncher({ launcher, target: path.join(root, 'new'), verify: () => true }), /recovery/)
    for (const name of ['old', 'new']) assert.equal(fs.readFileSync(path.join(root, name, 'marker'), 'utf8'), name)
  }
})

test('first publication failure restores absence and successful publications retain all generations', async t => {
  const { publishLauncher } = require('../packages/dsh-pet/compat/subagent/compat-publish.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-retain-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const launcher = path.join(root, '.launcher')
  for (let i = 0; i < 4; i++) { fs.mkdirSync(path.join(root, String(i))); fs.writeFileSync(path.join(root, String(i), 'marker'), String(i)) }
  assert.throws(() => publishLauncher({ launcher, target: path.join(root, '0'), platform: 'win32', verify() { throw Error('reject') } }), /reject/)
  assert.equal(fs.existsSync(launcher), false)
  for (let i = 0; i < 4; i++) publishLauncher({ launcher, target: path.join(root, String(i)), verify: () => true })
  for (let i = 0; i < 4; i++) assert.equal(fs.readFileSync(path.join(root, String(i), 'marker'), 'utf8'), String(i))
})
