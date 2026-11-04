import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { noPetStopPatch } from '../scripts/launcher/no-pet-stop-profile.mjs'

const repo = path.resolve(import.meta.dirname, '..')
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-stop-patch-'))
  t.after(() => {
    assert(home.startsWith(path.join(os.tmpdir(), 'launcher-stop-patch-')))
    fs.rmSync(home, { recursive: true, force: true })
  })
  return home
}

test('managed noPet patch inserts a normal file-URL plugin in the official overlay format', t => {
  const home = fixture(t)
  const file = noPetStopPatch(home, repo, '0.2.0-rc.2')
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), [{ insert: [{ id: 'launcher-no-pet-stop', name: pathToFileURL(path.join(repo, 'scripts/launcher/no-pet-stop-plugin.mjs')).href, config: { dshVersion: '0.2.0-rc.2' } }] }])
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700)
  noPetStopPatch(home, repo, '0.2.0-rc.2')
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1)
})

test('launcher overlay refuses symlinked or writable private directories', async t => {
  for (const kind of ['run-link', 'private-link', 'private-mode']) await t.test(kind, t => {
    const home = fixture(t)
    const other = path.join(home, 'other')
    fs.mkdirSync(other)
    if (kind === 'run-link') fs.symlinkSync(other, path.join(home, 'run'))
    else {
      fs.mkdirSync(path.join(home, 'run'))
      if (kind === 'private-link') fs.symlinkSync(other, path.join(home, 'run/dsh-launcher'))
      else fs.mkdirSync(path.join(home, 'run/dsh-launcher'), { mode: 0o777 })
    }
    assert.throws(() => noPetStopPatch(home, repo, '0.2.0-rc.2'), /unsafe/)
    assert.deepEqual(fs.readdirSync(other), [])
  })
})
