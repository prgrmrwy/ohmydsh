// Repository documentation governance (OpenSpec change github-facade-refresh,
// capability repo-docs-governance). Negative scenarios feed fixtures to pure
// helpers or checks so they never mutate the working tree.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  REPO,
  beforeFirstH2,
  blankFencedBlocks,
  cjkRatio,
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

// ---------------------------------------------------------------------------
// README bilingual pairs, package tiers and screenshot registry (group 8)
// ---------------------------------------------------------------------------

const EN_CJK_MAX = 0.05
const ZH_CJK_MIN = 0.2
const PAIR_LINK_LINES = 15
const MAX_BITMAP_BYTES = 400 * 1024
const BITMAP = /\.(png|jpe?g|webp|gif)$/i
const TIER_BITMAP = /\.(png|jpe?g|webp)$/i
const readOptional = (file) => (existsSync(path.join(REPO, file)) ? readFileSync(path.join(REPO, file), 'utf8') : null)

/** True when `text` links to `target` (repo-relative) within its first `PAIR_LINK_LINES` lines. */
function linksWithinHead(file, text, target) {
  return extractLinks(text).some((link) => link.line <= PAIR_LINK_LINES && resolveLinkTarget(file, link.target) === target)
}

/** README pairing problems: missing zh twin, missing mutual link, wrong language ratio. */
function readmePairViolations(files, readFile) {
  const problems = []
  const readmes = files.filter((file) => /(^|\/)README\.md$/.test(file) && !file.startsWith('openspec/') && !file.includes('node_modules/'))
  for (const en of readmes) {
    const dir = path.posix.dirname(en)
    const zh = dir === '.' ? 'README.zh.md' : `${dir}/README.zh.md`
    if (!files.includes(zh)) {
      problems.push(`${dir}: missing tracked README.zh.md next to ${en}`)
      continue
    }
    const enText = readFile(en) ?? ''
    const zhText = readFile(zh) ?? ''
    if (!linksWithinHead(en, enText, zh)) problems.push(`${en}: does not link ${zh} within the first ${PAIR_LINK_LINES} lines`)
    if (!linksWithinHead(zh, zhText, en)) problems.push(`${zh}: does not link ${en} within the first ${PAIR_LINK_LINES} lines`)
    const enRatio = cjkRatio(enText)
    if (!(enRatio < EN_CJK_MAX)) problems.push(`${en}: CJK ratio ${enRatio.toFixed(3)} must be below ${EN_CJK_MAX}`)
    const zhRatio = cjkRatio(zhText)
    if (!(zhRatio > ZH_CJK_MIN)) problems.push(`${zh}: CJK ratio ${zhRatio.toFixed(3)} must be above ${ZH_CJK_MIN}`)
  }
  return problems
}

test('every tracked README.md has a cross-linked README.zh.md within language thresholds', () => {
  assert.deepEqual(readmePairViolations(trackedFiles(), readOptional), [])
})

test('README without zh pair is reported', () => {
  const files = ['README.md', 'README.zh.md', 'packages/new-plugin/README.md', 'openspec/changes/archive/x/README.md']
  const texts = {
    'README.md': '[中文](README.zh.md)\nThis README is written in English and explains what the repository does.',
    'README.zh.md': '[English](README.md)\n这是中文说明,覆盖全部内容。',
  }
  const problems = readmePairViolations(files, (file) => texts[file] ?? '')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /packages\/new-plugin: missing tracked README\.zh\.md/)
})

test('a pair that does not link each other within 15 lines is reported', () => {
  const filler = `${'line\n'.repeat(20)}`
  const texts = {
    'README.md': `${filler}[zh](README.zh.md)\nThis README is written in English.`,
    'README.zh.md': '[en](README.md)\n这是中文说明,覆盖全部内容。',
  }
  const problems = readmePairViolations(['README.md', 'README.zh.md'], (file) => texts[file])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /README\.md: does not link README\.zh\.md within the first 15 lines/)
})

test('cjk ratio helper flags a Chinese README.md', () => {
  const texts = {
    'README.md': '[中文](README.zh.md)\n这个包为使用者解决了什么问题,请阅读下面的说明文字。\n',
    'README.zh.md': '[English](README.md)\n这个包为使用者解决了什么问题,请阅读下面的说明文字。\n',
  }
  const problems = readmePairViolations(['README.md', 'README.zh.md'], (file) => texts[file])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^README\.md: CJK ratio 0\.\d+ must be below 0\.05$/)
  // code, inline code and link targets never count toward the ratio
  assert.equal(cjkRatio('Plain text.\n```\n中文代码块中文代码块\n```\nsee `中文` [x](中文.md)'), 0)
})

/** Whether the paragraph right after a `<!-- problem -->` line has at least 40 non-whitespace code points. */
function problemParagraphLength(head) {
  const lines = head.split('\n')
  const at = lines.findIndex((line) => /^\s*<!--\s*problem\s*-->\s*$/.test(line))
  if (at === -1) return null
  let start = at + 1
  while (start < lines.length && lines[start].trim() === '') start += 1
  const paragraph = []
  for (let i = start; i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i]); i += 1) paragraph.push(lines[i])
  return [...paragraph.join('')].filter((char) => !/\s/u.test(char)).length
}

/** `## ` headings immediately followed by a `<!-- section: removal -->` anchor. */
function hasRemovalSection(text) {
  const lines = blankFencedBlocks(text).split('\n')
  return lines.some((line, index) => {
    if (!/^##\s+\S/.test(line)) return false
    let next = index + 1
    while (next < lines.length && lines[next].trim() === '') next += 1
    return next < lines.length && /^\s*<!--\s*section:\s*removal\s*-->\s*$/.test(lines[next])
  })
}

/**
 * Presentation problems of one package README pair.
 * `exists(file)` reports whether a repo-relative file is present.
 */
function packageReadmeViolations({ id, tier, texts, exists }) {
  const problems = []
  if (!['A', 'B', 'C'].includes(tier)) {
    problems.push(`packages/${id}/package.json: declare ohmydsh.docTier as "A", "B" or "C" (got ${JSON.stringify(tier ?? null)})`)
    return problems
  }
  for (const name of ['README.md', 'README.zh.md']) {
    const file = `packages/${id}/${name}`
    const text = texts[name]
    if (text == null) {
      problems.push(`${file}: missing`)
      continue
    }
    const head = beforeFirstH2(text)
    const length = problemParagraphLength(head)
    if (length === null) problems.push(`${file}: no <!-- problem --> line before the first "## " heading`)
    else if (length < 40) problems.push(`${file}: problem paragraph has ${length} non-whitespace code points, need at least 40`)
    if (tier === 'A' || tier === 'B') {
      const docsDir = `packages/${id}/docs/`
      const bitmaps = extractLinks(head)
        .map((link) => resolveLinkTarget(file, link.target))
        .filter((target) => target && target.startsWith(docsDir) && TIER_BITMAP.test(target))
      if (bitmaps.length === 0) problems.push(`${file}: missing qualifying bitmap: tier ${tier} needs a png/jpg/jpeg/webp image under ${docsDir} above the first "## " heading`)
      else for (const bitmap of bitmaps) if (!exists(bitmap)) problems.push(`${file}: screenshot ${bitmap} does not exist`)
    } else if (!hasRemovalSection(text)) {
      problems.push(`${file}: tier C needs a "## " heading immediately followed by <!-- section: removal -->`)
    }
  }
  return problems
}

/** Tracked packages as `{ id, tier }`, tier read from `ohmydsh.docTier`. */
function trackedPackages(files, readFile) {
  return files
    .map((file) => file.match(/^packages\/([^/]+)\/package\.json$/))
    .filter(Boolean)
    .map(([file, id]) => ({ id, tier: JSON.parse(readFile(file)).ohmydsh?.docTier }))
}

test('package READMEs satisfy their docTier presentation rules', () => {
  const files = trackedFiles()
  const exists = (file) => existsSync(path.join(REPO, file))
  const packages = trackedPackages(files, read)
  assert.ok(packages.length >= 12, `expected the twelve packages, found ${packages.length}`)
  const problems = packages.flatMap(({ id, tier }) =>
    packageReadmeViolations({
      id,
      tier,
      texts: { 'README.md': readOptional(`packages/${id}/README.md`), 'README.zh.md': readOptional(`packages/${id}/README.zh.md`) },
      exists,
    }),
  )
  assert.deepEqual(problems, [])
})

test('package tiers match the design (D6)', () => {
  const tiers = Object.fromEntries(trackedPackages(trackedFiles(), read).map(({ id, tier }) => [id, tier]))
  assert.deepEqual(tiers, {
    'cockpit-memex-browse-shim': 'C',
    'cockpit-worktree-open-shim': 'C',
    'dsh-memex': 'A',
    'dsh-openspec': 'A',
    'dsh-pet': 'A',
    'home-network-model-guard': 'B',
    'session-links': 'B',
    'session-title-copy': 'B',
    'sidebar-session-provider-icon': 'B',
    'subscriptions-sandbox-shim': 'C',
    'system-clock': 'B',
    'worktree-session': 'A',
  })
})

test('package without ohmydsh.docTier is reported', () => {
  const files = ['packages/new-plugin/package.json']
  const packages = trackedPackages(files, () => JSON.stringify({ name: 'new-plugin', version: '1.0.0' }))
  assert.deepEqual(packages, [{ id: 'new-plugin', tier: undefined }])
  const problems = packageReadmeViolations({ ...packages[0], texts: {}, exists: () => true })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /packages\/new-plugin\/package\.json: declare ohmydsh\.docTier/)
  const invalid = packageReadmeViolations({ id: 'x', tier: 'D', texts: {}, exists: () => true })
  assert.match(invalid[0], /got "D"/)
})

const PROBLEM = 'This plugin saves you from retyping the same long path every time you reopen a session.'
const fixtureReadme = (head) => `# pkg\n\n${head}\n\n## Usage\n`

test('A/B tier with only an SVG above first h2 is reported', () => {
  const svgOnly = fixtureReadme(`<!-- problem -->\n${PROBLEM}\n\n![diagram](docs/flow.svg)`)
  const texts = { 'README.md': svgOnly, 'README.zh.md': svgOnly }
  const problems = packageReadmeViolations({ id: 'p', tier: 'B', texts, exists: () => true })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /packages\/p\/README\.md: missing qualifying bitmap: tier B needs a png\/jpg\/jpeg\/webp image under packages\/p\/docs\/ above the first "## " heading/)

  const shot = fixtureReadme(`<!-- problem -->\n${PROBLEM}\n\n![shot](docs/shot.png)`)
  const ok = { 'README.md': shot, 'README.zh.md': shot }
  assert.deepEqual(packageReadmeViolations({ id: 'p', tier: 'A', texts: ok, exists: () => true }), [])
  const missing = packageReadmeViolations({ id: 'p', tier: 'A', texts: ok, exists: () => false })
  assert.equal(missing.length, 2)
  assert.match(missing[0], /packages\/p\/docs\/shot\.png does not exist/)

  const below = fixtureReadme(`<!-- problem -->\n${PROBLEM}\n\n## Usage\n![shot](docs/shot.png)`).replace('# pkg\n\n', '# pkg\n\n')
  assert.equal(packageReadmeViolations({ id: 'p', tier: 'B', texts: { 'README.md': below, 'README.zh.md': below }, exists: () => true }).length, 2)
})

test('problem paragraph rules and C-tier removal section are enforced (fixture)', () => {
  const short = '# pkg\n\n<!-- problem -->\nToo short.\n\n## Removal\n<!-- section: removal -->\n'
  const none = '# pkg\n\nNo marker here at all, only prose that is long enough to be a paragraph.\n\n## Removal\n<!-- section: removal -->\n'
  const noRemoval = `# pkg\n\n<!-- problem -->\n${PROBLEM}\n\n## Usage\n`
  const good = `# pkg\n\n<!-- problem -->\n${PROBLEM}\n\n## Removal\n<!-- section: removal -->\nRemove it when upstream ships the fix.\n`
  const run = (text) => packageReadmeViolations({ id: 'c', tier: 'C', texts: { 'README.md': text, 'README.zh.md': text }, exists: () => true })
  assert.match(run(short)[0], /problem paragraph has \d+ non-whitespace code points, need at least 40/)
  assert.match(run(none)[0], /no <!-- problem --> line/)
  assert.match(run(noRemoval)[0], /tier C needs a "## " heading immediately followed by <!-- section: removal -->/)
  assert.deepEqual(run(good), [])
  assert.equal(problemParagraphLength(`<!-- problem -->\n\n${'中'.repeat(40)}`), 40)
})

const REGISTRY_COLUMNS = ['file', 'kind', 'source', 'date', 'reviewer', 'verdict', 'note']
const KINDS = ['screenshot', 'illustration']
/** Hard-coded on purpose: widening it is a spec revision (design D6), not an execution-time edit. */
const ILLUSTRATION_PACKAGES = ['worktree-session', 'dsh-openspec', 'sidebar-session-provider-icon', 'session-title-copy', 'session-links']
const ILLUSTRATION_REASON_PHRASE = 'isolated instance has no model credentials'
const PLACEHOLDER = /^[-–—]*$/

/** Bitmap files embedded by README files and the registry problems of each. */
function screenshotViolations(files, readFile, sizeOf) {
  const problems = []
  const seen = new Set()
  for (const readme of files.filter((file) => /(^|\/)README(\.zh)?\.md$/.test(file) && !file.startsWith('openspec/'))) {
    for (const link of extractLinks(readFile(readme) ?? '')) {
      const target = resolveLinkTarget(readme, link.target)
      if (!target || !BITMAP.test(target) || seen.has(target)) continue
      seen.add(target)
      const size = sizeOf(target)
      if (size === null) problems.push(`${target}: referenced by ${readme}:${link.line} but not found`)
      else if (size > MAX_BITMAP_BYTES) problems.push(`${target}: ${size} bytes exceeds ${MAX_BITMAP_BYTES}`)
      const dir = path.posix.dirname(target)
      const registry = path.posix.join(dir, 'SCREENSHOTS.md')
      const text = files.includes(registry) ? readFile(registry) : null
      if (text === null) {
        problems.push(`${target}: no ${registry} next to the image`)
        continue
      }
      const name = path.posix.basename(target)
      const row = text.split('\n').map(tableCells).find((cells) => cells && cells.length >= 1 && cellFile(cells[0]) === name)
      if (!row) {
        problems.push(`${target}: not registered in ${registry}`)
        continue
      }
      if (row.length !== REGISTRY_COLUMNS.length) {
        problems.push(`${target}: registry row in ${registry} has ${row.length} cells, need ${REGISTRY_COLUMNS.length} (${REGISTRY_COLUMNS.join(', ')})`)
        continue
      }
      const empty = REGISTRY_COLUMNS.slice(0, 6).filter((_, index) => row[index] === '')
      if (empty.length > 0) {
        problems.push(`${target}: registry row in ${registry} has an empty cell (${empty.join(', ')})`)
        continue
      }
      const [, kind, , , , , note] = row
      if (!KINDS.includes(kind)) {
        problems.push(`${target}: kind "${kind}" in ${registry} must be "screenshot" or "illustration"`)
        continue
      }
      if (kind === 'screenshot') {
        if (note.includes(ILLUSTRATION_REASON_PHRASE)) problems.push(`${target}: screenshot note in ${registry} must not contain "${ILLUSTRATION_REASON_PHRASE}"`)
        continue
      }
      const owner = dir.match(/^packages\/([^/]+)\/docs(?:\/|$)/)?.[1]
      if (!owner || !ILLUSTRATION_PACKAGES.includes(owner)) {
        problems.push(`${target}: illustration is not allowed for package ${owner ?? dir} (allowed: ${ILLUSTRATION_PACKAGES.join(', ')})`)
      }
      if (PLACEHOLDER.test(note) || !note.includes(ILLUSTRATION_REASON_PHRASE)) {
        problems.push(`${target}: illustration note in ${registry} must contain "${ILLUSTRATION_REASON_PHRASE}"`)
      }
      const stem = name.replace(/\.[^.]+$/, '')
      if (!['json', 'svg'].some((extension) => files.includes(path.posix.join(dir, `${stem}.${extension}`)))) {
        problems.push(`${target}: illustration has no same-name ${stem}.json or ${stem}.svg source in ${dir}/`)
      }
    }
  }
  return problems
}

/** Cells of a markdown table row, or null for non-rows. */
function tableCells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim())
}

const cellFile = (cell) => cell.replace(/`/g, '').replace(/^\[([^\]]*)\]\(.*\)$/, '$1').trim()

const REGISTRY_HEADER = ['| file | kind | source | date | reviewer | verdict | note |', '|---|---|---|---|---|---|---|']
const ILLUSTRATION_REASON = 'isolated instance has no model credentials'
const registry = (...rows) => [...REGISTRY_HEADER, ...rows].join('\n')

/** Run the checker on one package whose README embeds `docs/<image>` and whose registry is `rows`. */
function registryProblems({ id = 'worktree-session', image = 'overview.png', rows, extraFiles = [], size = 100 }) {
  const dir = `packages/${id}/docs`
  const files = [`packages/${id}/README.md`, `${dir}/SCREENSHOTS.md`, ...extraFiles]
  const texts = { [`packages/${id}/README.md`]: `![x](docs/${image})\n`, [`${dir}/SCREENSHOTS.md`]: registry(...rows) }
  return screenshotViolations(files, (file) => texts[file] ?? null, () => size)
}

test('every README bitmap is registered in SCREENSHOTS.md with kind, and under 400 KiB; illustration rows have a note and a committed source', () => {
  const sizeOf = (file) => (existsSync(path.join(REPO, file)) ? statSync(path.join(REPO, file)).size : null)
  assert.deepEqual(screenshotViolations(trackedFiles(), readOptional, sizeOf), [])
})

test('unregistered bitmap is reported', () => {
  const files = ['packages/p/README.md', 'packages/p/docs/SCREENSHOTS.md', 'packages/q/README.md']
  const texts = {
    'packages/p/README.md': '![a](docs/a.png)\n![b](docs/b.png)\n![c](docs/c.webp)\n![d](docs/d.png)\n',
    'packages/p/docs/SCREENSHOTS.md': registry(
      '| `a.png` | screenshot | synthetic home | 2026-10-01 | lead | pass | - |',
      '| `c.webp` | screenshot | synthetic home | 2026-10-01 | | pass | - |',
      '| `d.png` | screenshot | synthetic home | 2026-10-01 | lead | pass |',
    ),
    'packages/q/README.md': '![z](docs/z.jpg)\n',
  }
  const sizes = { 'packages/p/docs/a.png': 100, 'packages/p/docs/b.png': 100, 'packages/p/docs/c.webp': 500 * 1024, 'packages/p/docs/d.png': 100, 'packages/q/docs/z.jpg': 10 }
  const problems = screenshotViolations(files, (file) => texts[file] ?? null, (file) => sizes[file] ?? null)
  assert.deepEqual(problems, [
    'packages/p/docs/b.png: not registered in packages/p/docs/SCREENSHOTS.md',
    `packages/p/docs/c.webp: ${500 * 1024} bytes exceeds ${MAX_BITMAP_BYTES}`,
    'packages/p/docs/c.webp: registry row in packages/p/docs/SCREENSHOTS.md has an empty cell (reviewer)',
    'packages/p/docs/d.png: registry row in packages/p/docs/SCREENSHOTS.md has 6 cells, need 7 (file, kind, source, date, reviewer, verdict, note)',
    'packages/q/docs/z.jpg: no packages/q/docs/SCREENSHOTS.md next to the image',
  ])
})

test('illustration allowlist, reason phrase, source file and kind values are enforced', () => {
  const illustration = (note = ILLUSTRATION_REASON) => `| overview.png | illustration | rasterized from overview.json | 2026-10-09 | lead | pending | ${note} |`
  const screenshot = (note = '-') => `| overview.png | screenshot | isolated DSH_HOME instance | 2026-10-09 | lead | pass | ${note} |`
  const source = (id) => [`packages/${id}/docs/overview.json`]

  // positive: allowlisted package, kind=illustration, exact phrase, same-name source present
  assert.deepEqual(registryProblems({ rows: [illustration()], extraFiles: source('worktree-session') }), [])
  assert.deepEqual(registryProblems({ rows: [illustration(`no live session: ${ILLUSTRATION_REASON}.`)], extraFiles: ['packages/worktree-session/docs/overview.svg'] }), [])
  // every allowlisted package passes; a screenshot with `-` or free text note passes anywhere
  for (const id of ['worktree-session', 'dsh-openspec', 'sidebar-session-provider-icon', 'session-title-copy', 'session-links']) {
    assert.deepEqual(registryProblems({ id, rows: [illustration()], extraFiles: source(id) }), [], id)
  }
  assert.deepEqual(registryProblems({ id: 'dsh-pet', rows: [screenshot()] }), [])
  assert.deepEqual(registryProblems({ id: 'dsh-pet', rows: [screenshot('Pet settings, general tab')] }), [])

  // unknown kind
  assert.deepEqual(registryProblems({ rows: [illustration().replace('| illustration |', '| diagram |')], extraFiles: source('worktree-session') }), [
    'packages/worktree-session/docs/overview.png: kind "diagram" in packages/worktree-session/docs/SCREENSHOTS.md must be "screenshot" or "illustration"',
  ])
  // illustration in a package that must use screenshots
  assert.deepEqual(registryProblems({ id: 'dsh-pet', rows: [illustration()], extraFiles: source('dsh-pet') }), [
    'packages/dsh-pet/docs/overview.png: illustration is not allowed for package dsh-pet (allowed: worktree-session, dsh-openspec, sidebar-session-provider-icon, session-title-copy, session-links)',
  ])
  // allowlisted package with the wrong reason
  assert.deepEqual(registryProblems({ rows: [illustration('unavailable')], extraFiles: source('worktree-session') }), [
    `packages/worktree-session/docs/overview.png: illustration note in packages/worktree-session/docs/SCREENSHOTS.md must contain "${ILLUSTRATION_REASON}"`,
  ])
  // illustration without a placeholder-free note
  assert.deepEqual(registryProblems({ rows: [illustration('-')], extraFiles: source('worktree-session') }), [
    `packages/worktree-session/docs/overview.png: illustration note in packages/worktree-session/docs/SCREENSHOTS.md must contain "${ILLUSTRATION_REASON}"`,
  ])
  // allowlisted illustration whose same-name .json/.svg source is not committed (a different basename does not count)
  assert.deepEqual(registryProblems({ rows: [illustration()] }), [
    'packages/worktree-session/docs/overview.png: illustration has no same-name overview.json or overview.svg source in packages/worktree-session/docs/',
  ])
  assert.equal(registryProblems({ rows: [illustration()], extraFiles: ['packages/worktree-session/docs/other.json', 'packages/other/docs/overview.json'] }).length, 1)
  // a screenshot row may not borrow the illustration reason
  assert.deepEqual(registryProblems({ id: 'dsh-pet', rows: [screenshot(ILLUSTRATION_REASON)] }), [
    `packages/dsh-pet/docs/overview.png: screenshot note in packages/dsh-pet/docs/SCREENSHOTS.md must not contain "${ILLUSTRATION_REASON}"`,
  ])
})
