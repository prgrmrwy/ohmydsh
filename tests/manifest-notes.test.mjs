// Manifest note discipline (OpenSpec change github-facade-refresh, capability
// repo-layout: 「manifest 条目说明以人读摘要为准」 and 「note 精简迁移不改变
// manifest 的机器可读结构」). `note` is human-readable review text, never data:
// every enabled customization carries a short `brief`, every `note` stays within
// the length cap, and a note required by another spec keeps its fact categories.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(REPO, 'scripts', 'maintenance', 'manifest-structure-diff.mjs')

const BRIEF_MAX = 80
const NOTE_MAX = 600

/** Unicode code points, not UTF-16 units. */
const length = (value) => [...value].length

/**
 * Problems of one manifest: an enabled entry without a non-empty brief, a brief
 * over the cap, or any note over the cap (named by id with the actual length).
 */
function noteViolations(manifest) {
  const problems = []
  for (const entry of manifest.customizations ?? []) {
    if (entry.enabled === true) {
      if (typeof entry.brief !== 'string' || entry.brief.trim() === '') problems.push(`${entry.id}: enabled entry has no brief`)
      else if (length(entry.brief) > BRIEF_MAX) problems.push(`${entry.id}: brief is ${length(entry.brief)} code points, max ${BRIEF_MAX}`)
    }
    if (entry.note !== undefined) {
      if (typeof entry.note !== 'string') problems.push(`${entry.id}: note is not a string`)
      else if (length(entry.note) > NOTE_MAX) problems.push(`${entry.id}: note is ${length(entry.note)} code points, max ${NOTE_MAX}`)
    }
  }
  return problems
}

/**
 * Fact categories required of the dsh-openspec note by the dsh-openspec-session
 * spec. English or Chinese wording both count, so a faithful rewrite in either
 * language passes while dropping a whole category fails.
 */
const OPENSPEC_CATEGORIES = {
  upstream: /upstream|上游/i,
  license: /licen[cs]e|许可/i,
  telemetry: /telemetry|遥测/i,
  credential: /credential|凭据/i,
  upgrade: /upgrade|升级/i,
  removal: /remov|移除/i,
}

function missingCategories(note) {
  return Object.entries(OPENSPEC_CATEGORIES).filter(([, pattern]) => !pattern.test(note)).map(([name]) => name)
}

const loadManifest = async () => yaml.load(await readFile(path.join(REPO, 'dsh.yaml'), 'utf8'))

test('every enabled customization has a brief ≤80 and note ≤600 code points', async () => {
  const manifest = await loadManifest()
  assert.ok(manifest.customizations.length > 0, 'manifest has customizations')
  assert.deepEqual(noteViolations(manifest), [])
})

test('oversized note is reported with id and length', () => {
  const manifest = {
    customizations: [
      { id: 'fine', enabled: true, brief: 'ok', note: 'x'.repeat(NOTE_MAX) },
      { id: 'bloated', enabled: true, brief: 'ok', note: '注'.repeat(NOTE_MAX + 1) },
      { id: 'no-brief', enabled: true, note: 'short' },
      { id: 'long-brief', enabled: true, brief: 'b'.repeat(BRIEF_MAX + 1) },
      { id: 'disabled-needs-no-brief', enabled: false },
    ],
  }
  assert.deepEqual(noteViolations(manifest), [
    `bloated: note is ${NOTE_MAX + 1} code points, max ${NOTE_MAX}`,
    'no-brief: enabled entry has no brief',
    `long-brief: brief is ${BRIEF_MAX + 1} code points, max ${BRIEF_MAX}`,
  ])
  // Code points, not UTF-16 units: an astral character counts once.
  assert.equal(length('😀'), 1)
})

test('dsh-openspec note keeps upstream/license/telemetry/credential/upgrade/removal', async () => {
  const manifest = await loadManifest()
  const entry = manifest.customizations.find((item) => item.id === 'dsh-openspec')
  assert.ok(entry, 'dsh-openspec entry exists')
  assert.deepEqual(missingCategories(entry.note ?? ''), [])

  // Fixture: a note that lost its upgrade checkpoint is reported by category.
  const withoutUpgrade = 'Upstream @fission-ai/openspec under its own license; telemetry off; no credential sent; remove by enabled:false.'
  assert.deepEqual(missingCategories(withoutUpgrade), ['upgrade'])
  const english = 'upstream, license, telemetry, credential, upgrade checkpoint, removal'
  assert.deepEqual(missingCategories(english), [])
})

/** Minimal git fixture: a repo whose first commit holds `before`, working tree holds `after`. */
async function manifestRepo(before, after) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'manifest-structure-diff-'))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'fixture')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(path.join(dir, 'dsh.yaml'), before)
  git('add', 'dsh.yaml')
  git('commit', '-q', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  await writeFile(path.join(dir, 'dsh.yaml'), after)
  return { dir, base }
}

const runDiff = (dir, base) => spawnSync(process.execPath, [SCRIPT, base], { cwd: dir, encoding: 'utf8' })

const MANIFEST = (version, note, brief) => `dshVersion: 0.2.0-rc.2
customizations:
  - id: first
    type: package
    source: local
    version: 0.1.0
    enabled: true
    brief: ${brief}
    note: ${note}
  - id: second
    type: package
    source: remote
    spec: second@1.0.0
    version: ${version}
    enabled: true
    brief: b
    note: n
`

test('structure-diff reports a changed version path and exits non-zero', async () => {
  const changed = await manifestRepo(MANIFEST('1.0.0', 'old note', 'old brief'), MANIFEST('1.0.1', 'new note', 'new brief'))
  const failed = runDiff(changed.dir, changed.base)
  assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`)
  assert.match(failed.stdout, /customizations\[1\]\.version/)
  assert.doesNotMatch(failed.stdout, /structure unchanged/)

  // Only note/brief changed: the structure is the same.
  const same = await manifestRepo(MANIFEST('1.0.0', 'old note', 'old brief'), MANIFEST('1.0.0', 'a much shorter note', 'new brief'))
  const passed = runDiff(same.dir, same.base)
  assert.equal(passed.status, 0, `${passed.stdout}${passed.stderr}`)
  assert.match(passed.stdout, /structure unchanged/)
})

test('structure-diff reports a reordered, added or removed entry', async () => {
  const extra = `${MANIFEST('1.0.0', 'n', 'b')}  - id: third\n    type: skill\n    enabled: true\n`
  const added = await manifestRepo(MANIFEST('1.0.0', 'n', 'b'), extra)
  const result = runDiff(added.dir, added.base)
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /customizations\[2\]/)
})
