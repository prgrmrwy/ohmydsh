/**
 * Guard for the removal of Pet's vendored lark-cli fork.
 *
 * Pet downloads media through the machine's pinned official `lark-cli` into a
 * guarded private spool directory. A re-introduced `compat/lark-cli` checkout,
 * its patch, or its `--output-fd` capability markers would silently restore a
 * ~430 MB cold-build dependency, so their absence is asserted rather than
 * assumed.
 */
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const REPO = path.resolve(import.meta.dirname, '..')
const PET = path.join(REPO, 'packages', 'dsh-pet')

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

test('the manifest no longer declares the vendored lark-cli build inputs', async () => {
  const manifest = await readFile(path.join(REPO, 'dsh.yaml'), 'utf8')
  // Only *declarations* count: the dsh-pet note legitimately records the
  // removal by path, so prose is not evidence of a build input.
  const declared = manifest
    .split('\n')
    .filter(line => /^\s*-\s/.test(line) && line.includes('compat/lark-cli'))
  assert.deepEqual(declared, [], 'dsh.yaml still declares a compat/lark-cli build input')
})

test('the package build chain no longer compiles a lark-cli artifact', async () => {
  const pkg = JSON.parse(await readFile(path.join(PET, 'package.json'), 'utf8'))
  const scripts = Object.values(pkg.scripts ?? {}).join('\n')
  assert.equal(scripts.includes('compat/lark-cli'), false, 'a build script still runs compat/lark-cli')
  assert.equal(
    await stat(path.join(PET, 'compat', 'lark-cli')).then(() => true).catch(() => false),
    false,
    'packages/dsh-pet/compat/lark-cli still exists',
  )
})

test('no Pet source retains the inherited-fd download capability', async () => {
  const files = (await walk(path.join(PET, 'src'))).filter(file => file.endsWith('.ts'))
  const markers = ['output-fd', '--max-bytes', 'supportsBoundedFdDownload', 'bounded-fd']
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const marker of markers) {
      assert.equal(
        text.includes(marker),
        false,
        `${path.relative(REPO, file)} still references ${marker}`,
      )
    }
  }
})
