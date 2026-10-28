import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, link, stat, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeIndependentPackageFiles } from '../scripts/lib/independent-package-files.mjs'

async function scene() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'independent-resources-'))
  const source = join(root, 'source'), deployed = join(root, 'deployed')
  for (const dir of [source, deployed]) await mkdir(join(dir, 'fixtures/eval'), { recursive: true })
  await writeFile(join(source, 'fixtures/eval/card.md'), 'fixed bytes')
  await link(join(source, 'fixtures/eval/card.md'), join(deployed, 'fixtures/eval/card.md'))
  return { root, source, deployed, path: 'fixtures/eval/card.md' }
}

test('detaches only declared deployed resources, preserving bytes, source and second-run mtime', async () => {
  const s = await scene()
  await writeFile(join(s.source, 'untouched.js'), 'code')
  await link(join(s.source, 'untouched.js'), join(s.deployed, 'untouched.js'))
  const original = await stat(join(s.source, s.path))
  assert.deepEqual(await materializeIndependentPackageFiles(s.source, s.deployed, ['fixtures/eval']), [s.path])
  assert.equal((await stat(join(s.source, s.path))).ino, original.ino)
  assert.equal((await stat(join(s.source, s.path))).nlink, 1)
  const after = await stat(join(s.deployed, s.path))
  assert.equal(after.nlink, 1)
  assert.notEqual(after.ino, original.ino)
  assert.equal(await readFile(join(s.deployed, s.path), 'utf8'), 'fixed bytes')
  assert.equal((await stat(join(s.deployed, 'untouched.js'))).nlink, 2)
  assert.deepEqual(await materializeIndependentPackageFiles(s.source, s.deployed, ['fixtures/eval']), [])
  assert.equal((await stat(join(s.deployed, s.path))).mtimeMs, after.mtimeMs)
})

test('no declaration is a no-op; unsafe declarations cannot escape the owned package', async () => {
  const s = await scene()
  assert.deepEqual(await materializeIndependentPackageFiles(s.source, s.deployed), [])
  for (const paths of [['../outside'], ['/outside'], ['fixtures/../eval'], ['node_modules'], 'fixtures', ['fixtures\\eval'], ['fixtures/eval', 'fixtures/eval']]) {
    await assert.rejects(materializeIndependentPackageFiles(s.source, s.deployed, paths), /independent|unsafe|duplicate/)
  }
  assert.equal((await stat(join(s.source, s.path))).nlink, 2)
})

test('preflights complete trees and refuses mismatched or extra bytes without detaching earlier files', async () => {
  for (const extra of [false, true]) {
    const s = await scene()
    await writeFile(join(s.source, 'fixtures/eval/z.md'), 'source')
    await writeFile(join(s.deployed, 'fixtures/eval/z.md'), extra ? 'source' : 'different')
    if (extra) await writeFile(join(s.deployed, 'fixtures/eval/extra.md'), 'extra')
    await assert.rejects(materializeIndependentPackageFiles(s.source, s.deployed, ['fixtures/eval']), /differ|entries/)
    assert.equal((await stat(join(s.source, s.path))).nlink, 2)
  }
})

test('refuses symlinks in roots, ancestors and leaves instead of following them', async () => {
  const s = await scene()
  await symlink(join(s.source, s.path), join(s.deployed, 'fixtures/eval/alias'))
  await assert.rejects(materializeIndependentPackageFiles(s.source, s.deployed, ['fixtures/eval']), /symbolic|link/)
  const clean = await scene()
  await symlink(clean.deployed, join(clean.root, 'alias'))
  await assert.rejects(materializeIndependentPackageFiles(clean.source, join(clean.root, 'alias'), ['fixtures/eval']), /symbolic|link/)
  assert.equal((await stat(join(clean.source, clean.path))).nlink, 2)
})
