import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensurePrivateDirectories, assertPrivatePaths, secureNewPrivateFile } from '../scripts/launcher/private-files.mjs'
import { noPetStopPatch } from '../scripts/launcher/no-pet-stop-profile.mjs'
import { preparePetStop } from '../scripts/launcher/pet-stop.mjs'
import { apply as noPetStopPlugin } from '../scripts/launcher/no-pet-stop-plugin.mjs'
import known from '../scripts/launcher/no-pet-known-modules.json' with { type: 'json' }

const posix = { skip: process.platform === 'win32' }
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-private-posix-'))
  t.after(() => {
    assert(home.startsWith(path.join(os.tmpdir(), 'launcher-private-posix-')))
    fs.rmSync(home, { recursive: true, force: true })
  })
  const run = path.join(home, 'run'), dir = path.join(run, 'private')
  return { home, run, dir, directories: [{ path: run, exact: false }, { path: dir, exact: true }] }
}

test('POSIX helper creates private files and preserves the run read/execute allowance', posix, t => {
  const f = fixture(t)
  ensurePrivateDirectories(f.directories)
  fs.chmodSync(f.run, 0o755)
  ensurePrivateDirectories(f.directories)
  const file = path.join(f.dir, 'new.tmp')
  fs.writeFileSync(file, 'private', { flag: 'wx', mode: 0o600 })
  secureNewPrivateFile(file)
  assertPrivatePaths([{ path: file, type: 'file' }])
  assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(fs.statSync(f.run).mode & 0o777, 0o755)
})

test('POSIX helper rejects existing unsafe directories and files without repairing them', posix, t => {
  const f = fixture(t)
  ensurePrivateDirectories(f.directories)
  fs.chmodSync(f.dir, 0o755)
  assert.throws(() => ensurePrivateDirectories(f.directories), /unsafe/)
  assert.equal(fs.statSync(f.dir).mode & 0o777, 0o755)
  fs.chmodSync(f.dir, 0o700)
  const file = path.join(f.dir, 'existing')
  fs.writeFileSync(file, 'unchanged', { mode: 0o600 })
  fs.chmodSync(file, 0o644)
  assert.throws(() => assertPrivatePaths([{ path: file, type: 'file' }]), /unsafe/)
  assert.throws(() => secureNewPrivateFile(file), /unsafe/)
  assert.equal(fs.statSync(file).mode & 0o777, 0o644)
  assert.equal(fs.readFileSync(file, 'utf8'), 'unchanged')
  const link = path.join(f.dir, 'link')
  fs.symlinkSync(file, link)
  assert.throws(() => assertPrivatePaths([{ path: link, type: 'file' }]), /unsafe/)
})

test('POSIX patch refuses unsafe existing publication instead of replacing it', posix, t => {
  const f = fixture(t)
  const file = noPetStopPatch(f.home, path.resolve(import.meta.dirname, '..'), 'test')
  fs.chmodSync(file, 0o644)
  const content = fs.readFileSync(file, 'utf8')
  assert.throws(() => noPetStopPatch(f.home, path.resolve(import.meta.dirname, '..'), 'replacement'), /unsafe/)
  assert.equal(fs.readFileSync(file, 'utf8'), content)
  assert.equal(fs.statSync(file).mode & 0o777, 0o644)
})

test('POSIX noPet cleanup verifies boundaries before touching its descriptor', posix, async t => {
  const f = fixture(t)
  const disposers = [], warnings = []
  const fiber = { state: 2 }
  const loader = { root: { data: [], tree: { store: {} } }, getTasks: () => [], entries: () => [], await: async () => {} }
  loader.ctx = { root: { fiber } }
  noPetStopPlugin({
    fiber, root: { fiber }, loader, profileContext: { name: 'web', home: f.home },
    get: name => name === 'appReady' ? { onReady: callback => { callback(); return () => {} } } : undefined,
    on() {}, effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) },
    connection: { authenticatedUrl: origin => `${origin}/?token=fixture-only` },
    webServer: { port: 40001, register: () => () => {} }, logger: { warn: message => warnings.push(message) },
  }, { dshVersion: known.dshVersion })
  await new Promise(setImmediate)
  assert.deepEqual(warnings, [])
  const file = path.join(f.run, 'dsh-pet-stop/40001.json')
  assertPrivatePaths([{ path: file, type: 'file' }])
  const content = fs.readFileSync(file, 'utf8')
  fs.chmodSync(f.run, 0o777)
  assert.throws(() => disposers.at(-1)(), /unsafe/)
  assert.equal(fs.readFileSync(file, 'utf8'), content)
  fs.chmodSync(f.run, 0o700)
  disposers.at(-1)()
  assert.equal(fs.existsSync(file), false)
})

test('POSIX reader rejects writable run even with a missing descriptor', posix, async t => {
  const f = fixture(t)
  fs.mkdirSync(f.run, { mode: 0o700 })
  fs.chmodSync(f.run, 0o777)
  let probes = 0
  await assert.rejects(preparePetStop({ home: f.home, port: 40001,
    initial: { state: 'owned', processes: [{ pid: 42424, created: 'fixture', executable: process.execPath, argv: [process.execPath, 'fixture'] }] },
    probe: async () => { probes++; throw new Error('must not probe or authenticate') },
  }), /unreadable or unsafe descriptor/)
  assert.equal(probes, 0)
  assert.equal(fs.statSync(f.run).mode & 0o777, 0o777)
})
