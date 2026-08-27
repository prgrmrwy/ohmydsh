import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guard: a manifest `version` must be the version the installed package really
 * reports.
 *
 * `scripts/sync.mjs` detects remote drift with a strict string compare against
 * the installed `package.json` version. A decorated pin — a fork marker such as
 * `0.5.2+pr40`, or any value the tarball does not actually contain — can never
 * equal the installed version, so every sync re-adds the package and the whole
 * deployment stops being idempotent. Fork identity belongs in `spec` (the pinned
 * commit) and `note`, never in `version`.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Parses the manifest's customization entries without a YAML dependency. */
function parseEntries(manifest) {
  const entries = []
  let current
  for (const raw of manifest.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const start = /^\s*-\s+id:\s*(\S+)/.exec(line)
    if (start !== null) {
      if (current !== undefined) entries.push(current)
      current = { id: start[1], line }
      continue
    }
    if (current === undefined) continue
    // A new top-level key ends the entry list.
    if (/^[A-Za-z]/.test(line)) {
      entries.push(current)
      current = undefined
      continue
    }
    const field = /^\s+([A-Za-z]+):\s*(.*)$/.exec(line)
    if (field !== null && current[field[1]] === undefined) current[field[1]] = field[2]
  }
  if (current !== undefined) entries.push(current)
  return entries
}

test('every pinned manifest version is a plain release version sync can compare', async () => {
  const manifest = await readFile(path.join(REPO, 'dsh.yaml'), 'utf8')
  const offenders = []
  let audited = 0

  for (const entry of parseEntries(manifest)) {
    const version = entry.version
    if (version === undefined) continue
    audited += 1
    const plain = version.replace(/^['"]|['"]$/g, '')
    // Build metadata (`+meta`) is the specific shape that broke idempotency: npm
    // strips it from the published package, so the installed version can never
    // match the decorated pin.
    if (plain.includes('+')) {
      offenders.push(`${entry.id}: version "${plain}" carries build metadata sync can never match`)
      continue
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plain)) {
      offenders.push(`${entry.id}: version "${plain}" is not a plain release version`)
    }
  }

  assert.ok(audited >= 5, `expected to audit the pinned customizations, saw ${audited}`)
  assert.deepEqual(offenders, [], `manifest versions must stay comparable:\n${offenders.join('\n')}`)
})

test('the guard rejects a decorated pin', () => {
  // Mutation check: the guard is only meaningful if it fails on the real defect.
  const bad = [
    'customizations:',
    '  - id: llm-subscriptions',
    '    type: package',
    '    version: 0.5.2+pr40',
    '    enabled: true',
  ].join('\n')
  const [entry] = parseEntries(bad)
  assert.equal(entry.id, 'llm-subscriptions')
  assert.equal(entry.version, '0.5.2+pr40')
  assert.ok(entry.version.includes('+'), 'the decorated pin must be detectable')

  const good = ['customizations:', '  - id: x', '    version: 0.5.2'].join('\n')
  assert.equal(parseEntries(good)[0].version, '0.5.2')
})
