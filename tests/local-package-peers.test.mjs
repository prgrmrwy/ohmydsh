import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_SCOPE = '@deepseek-ai/dsh-'
const BLOCKS = ['dependencies', 'devDependencies', 'peerDependencies']

/** The pinned runtime version is the manifest's dshVersion — the single source of truth. */
async function pinnedRuntimeVersion() {
  const manifest = await readFile(path.join(REPO, 'dsh.yaml'), 'utf8')
  const match = manifest.match(/^dshVersion:\s*(\S+)/m)
  assert.ok(match, 'dsh.yaml must declare dshVersion')
  return match[1]
}

/**
 * Version family = everything up to the prerelease tag. Upstream publishes each
 * release as `^<version>` on its siblings, so a local package is aligned when its
 * runtime ranges carry the same caret range as the pinned runtime.
 */
function expectedRange(runtimeVersion) {
  return `^${runtimeVersion}`
}

function localPackages() {
  const dir = path.join(REPO, 'packages')
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'package.json')))
    .map(entry => ({ id: entry.name, file: path.join(dir, entry.name, 'package.json') }))
}

async function runtimeRanges(file) {
  const pkg = JSON.parse(await readFile(file, 'utf8'))
  const found = []
  for (const block of BLOCKS) {
    for (const [name, range] of Object.entries(pkg[block] ?? {})) {
      if (name.startsWith(RUNTIME_SCOPE)) found.push({ block, name, range })
    }
  }
  return found
}

test('local packages declare runtime dependencies in the pinned version family', async () => {
  const expected = expectedRange(await pinnedRuntimeVersion())
  const drifted = []
  for (const { id, file } of localPackages()) {
    for (const entry of await runtimeRanges(file)) {
      if (entry.range !== expected) drifted.push(`${id} → ${entry.block}.${entry.name} = "${entry.range}" (expected "${expected}")`)
    }
  }
  assert.deepEqual(drifted, [], `runtime dependency drift:\n  ${drifted.join('\n  ')}`)
})

test('local packages never pin runtime dependencies to an exact version', async () => {
  // An exact pin can resolve a second copy of a runtime package after an upgrade,
  // producing two instances of the same module (broken service/identity checks).
  const exact = []
  for (const { id, file } of localPackages()) {
    for (const entry of await runtimeRanges(file)) {
      if (/^\d/.test(entry.range)) exact.push(`${id} → ${entry.block}.${entry.name} = "${entry.range}"`)
    }
  }
  assert.deepEqual(exact, [], `exact runtime pins are not allowed:\n  ${exact.join('\n  ')}`)
})

test('the check leaves non-runtime dependencies alone', async () => {
  // react / cordis / schemastery follow their own upstream cadence and must not be
  // dragged into the runtime family.
  const seen = new Set()
  for (const { file } of localPackages()) {
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    for (const block of BLOCKS) {
      for (const name of Object.keys(pkg[block] ?? {})) {
        if (!name.startsWith(RUNTIME_SCOPE)) seen.add(name)
      }
    }
  }
  const ranges = await Promise.all(localPackages().map(p => runtimeRanges(p.file)))
  const guarded = new Set(ranges.flat().map(entry => entry.name))
  for (const name of seen) assert.equal(guarded.has(name), false, `${name} must not be treated as a runtime dependency`)
  assert.ok(seen.has('@deepseek-ai/cordis'), 'expected cordis among the unguarded dependencies')
})
