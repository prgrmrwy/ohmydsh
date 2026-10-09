// Repository documentation governance (OpenSpec change github-facade-refresh,
// capability repo-docs-governance). Negative scenarios feed fixtures to pure
// helpers or checks so they never mutate the working tree.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  REPO,
  extractLinks,
  firstH1,
  indexEntry,
  isTrackedPathOrDir,
  resolveLinkTarget,
  trackedFiles,
} from './helpers/markdown.mjs'
import { applyAutoRedaction, applyManualRedactions } from '../scripts/maintenance/notes-migration-diff.mjs'

const ENTRY_DOCS = ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md']
const read = (file) => readFileSync(path.join(REPO, file), 'utf8')
const isMarkdown = (file) => file.endsWith('.md')

/** docs/architecture files not linked from any entry document. */
function unlinkedArchitectureDocs(files, readFile) {
  const linked = new Set()
  for (const entry of ENTRY_DOCS) {
    if (!files.includes(entry)) continue
    for (const link of extractLinks(readFile(entry))) {
      const target = resolveLinkTarget(entry, link.target)
      if (target) linked.add(target)
    }
  }
  return files.filter((file) => file.startsWith('docs/architecture/') && !linked.has(file))
}

/** docs/assets files neither referenced by tracked markdown nor an editable source of a referenced svg. */
function orphanAssets(files, readFile) {
  const referenced = new Set()
  for (const file of files.filter(isMarkdown)) {
    for (const link of extractLinks(readFile(file))) {
      const target = resolveLinkTarget(file, link.target)
      if (target) referenced.add(target)
    }
  }
  return files.filter((file) => {
    if (!file.startsWith('docs/assets/') || referenced.has(file)) return false
    const sibling = file.match(/^(docs\/assets\/.+)\.json$/)
    return !(sibling && referenced.has(`${sibling[1]}.dual.svg`))
  })
}

/** Violations for the AGENTS.md entry contract, given index entries (or null). */
function agentEntryViolations({ agents, claude, tracked }) {
  const problems = []
  if (!agents) problems.push('AGENTS.md is not tracked')
  else {
    if (agents.mode !== '120000') problems.push(`AGENTS.md mode is ${agents.mode}, expected 120000`)
    if (agents.blob !== 'CLAUDE.md') problems.push(`AGENTS.md link target is ${JSON.stringify(agents.blob)}, expected "CLAUDE.md"`)
  }
  if (!claude) problems.push('CLAUDE.md is not tracked')
  else if (claude.mode !== '100644') problems.push(`CLAUDE.md mode is ${claude.mode}, expected 100644`)
  for (const file of tracked) {
    if (/^(claude|agents)\.md$/i.test(file) && file !== 'CLAUDE.md' && file !== 'AGENTS.md') {
      problems.push(`${file}: case-variant agent entry file must not be tracked`)
    }
  }
  return problems
}

test('AGENTS.md is a symlink whose blob is exactly CLAUDE.md', () => {
  const problems = agentEntryViolations({
    agents: indexEntry('AGENTS.md'),
    claude: indexEntry('CLAUDE.md'),
    tracked: trackedFiles(),
  })
  assert.deepEqual(problems, [])
})

test('wrong-case symlink target is reported', () => {
  const problems = agentEntryViolations({
    agents: { mode: '120000', blob: 'claude.md' },
    claude: { mode: '100644', blob: '' },
    tracked: ['AGENTS.md', 'CLAUDE.md'],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /link target is "claude\.md"/)
})

test('tracked docs live only in adr/architecture/assets and architecture docs are linked from entry docs', () => {
  const files = trackedFiles()
  const outside = files.filter((file) => file.startsWith('docs/') && !/^docs\/(adr|architecture|assets)\//.test(file))
  assert.deepEqual(outside, [], 'tracked docs outside the whitelist')
  assert.deepEqual(unlinkedArchitectureDocs(files, read), [], 'docs/architecture files not linked from README/CLAUDE/CONTRIBUTING')
})

test('unlinked architecture doc is reported (fixture)', () => {
  const files = ['README.md', 'docs/architecture/a.md', 'docs/architecture/b.md']
  const texts = { 'README.md': 'See [a](docs/architecture/a.md#top).' }
  assert.deepEqual(unlinkedArchitectureDocs(files, (file) => texts[file]), ['docs/architecture/b.md'])
})

test('docs/assets has no orphan files', () => {
  assert.deepEqual(orphanAssets(trackedFiles(), read), [])
})

test('orphan docs asset is reported while an svg source twin is accepted (fixture)', () => {
  const files = ['README.md', 'docs/assets/x.dual.svg', 'docs/assets/x.json', 'docs/assets/lonely.png']
  const texts = { 'README.md': '<img src="docs/assets/x.dual.svg">' }
  assert.deepEqual(orphanAssets(files, (file) => texts[file]), ['docs/assets/lonely.png'])
})

// ---------------------------------------------------------------------------
// notes-directory migration (group 4)
// ---------------------------------------------------------------------------

const OLD_NOTES_DIR = ['docs', 'notes'].join('/') // spelled in pieces so this file never mentions the old path
const CHANGE = 'github-facade-refresh'

function changeDir() {
  const live = path.join(REPO, 'openspec/changes', CHANGE)
  if (existsSync(live)) return live
  const archive = path.join(REPO, 'openspec/changes/archive')
  const hit = existsSync(archive) ? readdirSync(archive).find((name) => name.endsWith(`-${CHANGE}`)) : null
  assert.ok(hit, `change ${CHANGE} not found in openspec/changes or its archive`)
  return path.join(archive, hit)
}

const disposition = () => JSON.parse(readFileSync(path.join(changeDir(), 'notes-disposition.json'), 'utf8'))

const ACTION_BY_LABEL = { 移动: 'move', 移动并改写: 'move-rewrite', 删除: 'delete', '转 BACKLOG': 'backlog' }

/** Rows of the human-readable disposition table in design.md D4. */
function designTableRows(designText) {
  const rows = []
  for (const line of designText.split('\n')) {
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== 5 || !/^\d+$/.test(cells[0])) continue
    const tick = (cell) => (cell.match(/`([^`]+)`/) ?? [])[1] ?? null
    rows.push({
      n: Number(cells[0]),
      source: tick(cells[1]) ? `${OLD_NOTES_DIR}/${tick(cells[1])}` : null,
      action: ACTION_BY_LABEL[cells[2]],
      target: cells[3] === '—' ? null : tick(cells[3]),
      reason: cells[4],
    })
  }
  return rows
}

/** Compare disposition rows with design-table rows; returns human-readable differences. */
function dispositionDifferences(files, tableRows) {
  const problems = []
  if (files.length !== tableRows.length) problems.push(`row count ${files.length} != design table ${tableRows.length}`)
  for (const row of files) {
    const table = tableRows.find((entry) => entry.n === row.n)
    if (!table) {
      problems.push(`#${row.n}: missing from design table`)
      continue
    }
    for (const field of ['source', 'action', 'target', 'reason']) {
      if (row[field] !== table[field]) problems.push(`#${row.n}: ${field} ${JSON.stringify(row[field])} != design ${JSON.stringify(table[field])}`)
    }
  }
  return problems
}

test('notes migration matches notes-disposition.json and design table', () => {
  const { files } = disposition()
  const tracked = trackedFiles()
  assert.equal(files.length, 25)
  assert.deepEqual(dispositionDifferences(files, designTableRows(readFileSync(path.join(changeDir(), 'design.md'), 'utf8'))), [])
  assert.deepEqual(tracked.filter((file) => file.startsWith(`${OLD_NOTES_DIR}/`)), [], 'old notes directory must be empty')
  for (const row of files) {
    assert.ok(!tracked.includes(row.source), `${row.source} must no longer be tracked`)
    if (row.action === 'move' || row.action === 'move-rewrite') {
      assert.ok(tracked.includes(row.target), `${row.target} must be tracked`)
    }
    if (row.action === 'move') {
      const first = readFileSync(path.join(REPO, row.target), 'utf8').split('\n')[0]
      assert.equal(first, `> Migrated from ${row.source}.`, `${row.target} first line`)
    }
    if (row.action === 'backlog') assert.ok(tracked.includes(row.target))
  }
})

test('disposition/design comparison reports a diverging row (fixture)', () => {
  const rows = [{ n: 1, source: 'a.md', action: 'move', target: 'x/a.md', reason: 'r' }]
  const table = [{ n: 1, source: 'a.md', action: 'move', target: 'y/a.md', reason: 'r' }]
  const problems = dispositionDifferences(rows, table)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /target "x\/a\.md" != design "y\/a\.md"/)
})

/** Lines starting with the attribution marker are the only allowed mention of the old directory. */
const ATTRIBUTION = /^> Migrated from docs\/notes\/\S+\.$/

/** h1 titles that occur as level-one headings in more than one tracked markdown file, or not at their target. */
function h1Problems(rows, readFile, tracked) {
  const problems = []
  const markdown = tracked.filter((file) => file.endsWith('.md'))
  for (const row of rows.filter((entry) => entry.action === 'move')) {
    const holders = markdown.filter((file) => firstH1(readFile(file) ?? '') === row.h1)
    if (holders.length !== 1 || holders[0] !== row.target) {
      problems.push(`${JSON.stringify(row.h1)} found in ${JSON.stringify(holders)}, expected only ${row.target}`)
    }
  }
  return problems
}

test('each migrated note h1 appears exactly once at its target', () => {
  const { files } = disposition()
  for (const row of files.filter((entry) => entry.action === 'move')) assert.ok(row.h1, `#${row.n} needs a recorded h1`)
  assert.deepEqual(h1Problems(files, (file) => (existsSync(path.join(REPO, file)) ? readFileSync(path.join(REPO, file), 'utf8') : null), trackedFiles()), [])
})

test('a duplicated note title is reported (fixture)', () => {
  const rows = [{ n: 1, action: 'move', h1: 'Title', target: 'a/x.md' }]
  const texts = { 'a/x.md': '# Title\n', 'b/copy.md': '# Title\n' }
  const problems = h1Problems(rows, (file) => texts[file], Object.keys(texts))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /b\/copy\.md/)
})

/** Auto-rule and registered-item hits in `text`, as `file:line: label`. */
function redactionHits(file, text, rules, manual) {
  const hits = []
  text.split('\n').forEach((line, index) => {
    for (const rule of rules) {
      if (new RegExp(rule.pattern).test(line)) hits.push(`${file}:${index + 1}: ${rule.category}`)
    }
    for (const item of manual) {
      if (line.includes(item.find)) hits.push(`${file}:${index + 1}: manual ${JSON.stringify(item.find)}`)
    }
  })
  return hits
}

/** Text of the two defect entries appended to BACKLOG.md for the `backlog` rows. */
function backlogEntries(text) {
  const blocks = text.split(/^(?=### \[)/m).filter((block) => /^### \[D\d+\]/.test(block))
  return blocks.filter((block) => /sync|ws clean|Worktree Session/.test(block.split('\n')[0]) && /migrated|迁自|docs\/notes/.test(block)).join('\n')
}

test('migrated targets contain no redaction-rule matches or registered manual items', () => {
  const { files, redactionRules } = disposition()
  const manual = files.flatMap((row) => row.manualRedactions ?? [])
  const hits = []
  for (const row of files.filter((entry) => entry.action === 'move' || entry.action === 'move-rewrite')) {
    hits.push(...redactionHits(row.target, readFileSync(path.join(REPO, row.target), 'utf8'), redactionRules, manual))
  }
  const backlog = readFileSync(path.join(REPO, 'BACKLOG.md'), 'utf8')
  for (const row of files.filter((entry) => entry.action === 'backlog')) {
    assert.ok(row.backlogId, `#${row.n} needs backlogId`)
    const block = backlog.split(/^(?=### \[)/m).find((entry) => entry.startsWith(`### [${row.backlogId}]`))
    assert.ok(block, `BACKLOG.md has no entry ${row.backlogId}`)
    hits.push(...redactionHits(`BACKLOG.md#${row.backlogId}`, block, redactionRules, manual))
  }
  assert.deepEqual(hits, [])
})

test('redaction scan reports file, line and rule category (fixture)', () => {
  const rules = [{ category: 'lark-user-id', pattern: 'ou_[0-9a-f]{16,}' }]
  const hits = redactionHits('t.md', 'ok\nsee ou_0123456789abcdef0123 and 张勇', rules, [{ find: '张勇' }])
  assert.deepEqual(hits, ['t.md:2: lark-user-id', 't.md:2: manual "张勇"'])
})

test('auto and manual redaction helpers replace every occurrence', () => {
  const rules = [
    { pattern: 'ou_[0-9a-f]{16,}', replace: 'ou_<redacted>' },
    { pattern: '/(Users|home)/[A-Za-z0-9._-]+/', replace: '~/' },
  ]
  const out = applyAutoRedaction('/Users/x/a ou_0123456789abcdef0123 ou_0123456789abcdef0123', rules)
  assert.equal(out, '~/a ou_<redacted> ou_<redacted>')
  assert.equal(applyManualRedactions('张勇 and 张勇', [{ find: '张勇', replace: '<member>' }]), '<member> and <member>')
})

async function diffFixture({ targetBody, manual }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notes-diff-'))
  const run = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  run('init', '-q')
  run('config', 'user.email', 't@example.com')
  run('config', 'user.name', 't')
  await mkdir(path.join(root, 'old-notes'), { recursive: true })
  await writeFile(path.join(root, 'old-notes/a.md'), '# Title\n\nline one 张勇\nline two\n')
  run('add', '.')
  run('commit', '-q', '-m', 'base')
  const base = run('rev-parse', 'HEAD')
  await mkdir(path.join(root, 'archive'), { recursive: true })
  await writeFile(path.join(root, 'archive/a.md'), targetBody)
  const dispositionFile = path.join(root, 'disposition.json')
  await writeFile(
    dispositionFile,
    JSON.stringify({
      redactionRules: [],
      files: [{ n: 1, source: 'old-notes/a.md', action: 'move', target: 'archive/a.md', manualRedactions: manual }],
    }),
  )
  const result = spawnSync(process.execPath, [path.join(REPO, 'scripts/maintenance/notes-migration-diff.mjs'), base, '--root', root, '--disposition', dispositionFile], { encoding: 'utf8' })
  return result
}

test('notes-migration-diff flags an unregistered body edit', async () => {
  const bad = await diffFixture({
    targetBody: '> Migrated from old-notes/a.md.\n# Title\n\nline one <member>\nline TWO changed\n',
    manual: [{ find: '张勇', replace: '<member>' }],
  })
  assert.notEqual(bad.status, 0)
  assert.match(bad.stdout + bad.stderr, /line TWO changed/)
  const good = await diffFixture({
    targetBody: '> Migrated from old-notes/a.md.\n# Title\n\nline one <member>\nline two\n',
    manual: [{ find: '张勇', replace: '<member>' }],
  })
  assert.equal(good.status, 0, good.stdout + good.stderr)
  assert.match(good.stdout, /registered manual/)
})

// ---------------------------------------------------------------------------
// stale references (group 5)
// ---------------------------------------------------------------------------

/** Broken relative links in markdown files as `file:line: target`. */
function brokenLinks(markdownFiles, readFile, tracked) {
  const broken = []
  for (const file of markdownFiles) {
    for (const link of extractLinks(readFile(file))) {
      const target = resolveLinkTarget(file, link.target)
      if (target === null) continue
      if (!isTrackedPathOrDir(tracked, target)) broken.push(`${file}:${link.line}: ${link.target}`)
    }
  }
  return broken
}

test('every repo-relative markdown link resolves to a tracked path', () => {
  const tracked = trackedFiles()
  const markdown = tracked.filter((file) => file.endsWith('.md') && !file.startsWith('openspec/changes/archive/'))
  assert.deepEqual(brokenLinks(markdown, (file) => readFileSync(path.join(REPO, file), 'utf8'), tracked), [])
})

test('broken relative link is reported with file, line, target', () => {
  const texts = { 'README.md': 'intro\nsee [x](docs/gone.md#top) and [ok](docs/here.md)\n', 'docs/here.md': '' }
  const broken = brokenLinks(['README.md'], (file) => texts[file], Object.keys(texts))
  assert.deepEqual(broken, ['README.md:2: docs/gone.md#top'])
})

const LOCAL_EXEMPT = (file) => file.startsWith('openspec/changes/archive/') || file.startsWith(`openspec/changes/${CHANGE}/`)

/** Tracked text files outside the exempt areas that still mention the old notes directory. */
function staleMentions(files, readFile) {
  const hits = []
  for (const file of files) {
    if (LOCAL_EXEMPT(file)) continue
    const text = readFile(file)
    if (text === null || text.includes('\0')) continue
    text.split('\n').forEach((line, index) => {
      if (line.includes(`${OLD_NOTES_DIR}/`) && !ATTRIBUTION.test(line)) hits.push(`${file}:${index + 1}`)
    })
  }
  return hits
}

test('no tracked text file outside archive mentions the old notes directory', () => {
  const read = (file) => (existsSync(path.join(REPO, file)) ? readFileSync(path.join(REPO, file)).toString('utf8') : null)
  assert.deepEqual(staleMentions(trackedFiles(), read), [])
})

test('stale mention scan flags source comments but accepts the attribution line (fixture)', () => {
  const texts = {
    'src/a.ts': `// see ${OLD_NOTES_DIR}/x.md\n`,
    'packages/p/docs/moved.md': `> Migrated from ${OLD_NOTES_DIR}/x.md.\n# T\n`,
    'openspec/changes/archive/old/tasks.md': `${OLD_NOTES_DIR}/y.md\n`,
  }
  assert.deepEqual(staleMentions(Object.keys(texts), (file) => texts[file]), ['src/a.ts:1'])
})
