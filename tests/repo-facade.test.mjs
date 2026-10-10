// Root README facade (OpenSpec change github-facade-refresh, capability repo-facade).
//
// Every mechanical constraint on README.md / README.zh.md is a pure checker over a
// string so the negative scenarios can feed synthetic fixtures to the very same
// helpers the real files go through. Semantic equivalence of the two languages and
// the wording of the AI prompt are NOT asserted here; they are manual gates.
import test from 'node:test'
import assert from 'node:assert/strict'
import yaml from 'js-yaml'
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {
  REPO,
  anchorSequenceDiff,
  cjkRatio,
  extractLinks,
  fixtureBlock,
  h2WithoutAnchor,
  isTrackedPathOrDir,
  resolveLinkTarget,
  sectionAnchors,
  sectionBody,
  stripCode,
} from './helpers/markdown.mjs'

const REQUIRED_ANCHORS = [
  'what-it-does',
  'quick-start',
  'architecture',
  'multiple-machines',
  'your-configuration',
  'plugins',
  'contributing',
  'license',
]
const README_FILES = ['README.md', 'README.zh.md']
const COCKPIT_URL = 'https://github.com/prgrmrwy/dsh-cockpit'
const RULE_TAGS = ['[ASK-PATH]', '[VERIFY-IDEMPOTENT]', '[NO-DEPLOY-EDIT]', '[NO-SECRETS]', '[STOP-ON-FAIL-CLOSED]', '[ASK-RESTART]']
const LIFECYCLE_WORDS = {
  'README.md': ['add', 'review', 'pin', 'build', 'upgrade', 'disable', 'remove'],
  'README.zh.md': ['加入', '审查', '固定', '物化', '升级', '禁用', '移除'],
}
const SEMVER = /\d+\.\d+\.\d+/

const read = (file) => readFileSync(path.join(REPO, file), 'utf8')
const rootManifest = () => yaml.load(read('dsh.yaml'))

/** Files git would track after `git add -A` (cached + untracked-not-ignored) that still exist on disk. */
function facadeFiles() {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.split('\n').filter((file) => file && existsSync(path.join(REPO, file)))
}

// ---------------------------------------------------------------------------
// Pure checkers
// ---------------------------------------------------------------------------

/** Cross-link: the first 30 lines mention the other file as a link target. */
function linksTo(text, targetFile) {
  return text
    .split('\n')
    .slice(0, 30)
    .join('\n')
    .split(/\]\(/)
    .slice(1)
    .some((part) => part.startsWith(targetFile) || part.startsWith(`./${targetFile}`))
}

function anchorProblems(text, file) {
  const problems = []
  for (const missing of h2WithoutAnchor(text)) problems.push(`${file}:${missing.line}: heading without section anchor: ${missing.heading}`)
  const keys = sectionAnchors(text).map((anchor) => anchor.key)
  for (const key of REQUIRED_ANCHORS) if (!keys.includes(key)) problems.push(`${file}: missing section anchor "${key}"`)
  if (REQUIRED_ANCHORS.every((key) => keys.includes(key))) {
    const diff = anchorSequenceDiff(keys, REQUIRED_ANCHORS)
    if (diff) problems.push(`${file}: anchor #${diff.index + 1} is "${diff.left}", expected "${diff.right}"`)
  }
  return problems
}

/** `dsh <word>` occurrences inside fenced blocks and inline code spans. */
function dshSubcommandMentions(text) {
  const segments = []
  let fence = null
  text.split('\n').forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null
      else segments.push({ line: index + 1, code: line })
      return
    }
    if (marker) {
      fence = marker[1]
      return
    }
    for (const span of line.matchAll(/(`+)([^`\n]+?)\1/g)) segments.push({ line: index + 1, code: span[2] })
  })
  const mentions = []
  for (const { line, code } of segments) {
    for (const match of code.matchAll(/(?<![\w./~-])dsh[ \t]+([a-z][a-z-]*)/g)) mentions.push({ line, command: match[1] })
  }
  return mentions
}

/** Subcommands declared as positional `case` arms of bin/dsh's argument loop. */
function binDshSubcommands(source) {
  const start = source.indexOf('while [[ $# -gt 0 ]]; do')
  assert.ok(start > -1, 'bin/dsh argument loop not found')
  const end = source.indexOf('\nesac', start)
  const commands = new Set()
  for (const line of source.slice(start, end).split('\n')) {
    const arm = line.match(/^\s{4}([a-z][a-z-]*(?:\|[a-z][a-z-]*)*)\)/)
    if (arm) for (const name of arm[1].split('|')) commands.add(name)
  }
  return commands
}

function unknownSubcommands(text, known) {
  return [...new Set(dshSubcommandMentions(text).filter(({ command }) => !known.has(command)).map(({ command }) => command))]
}

function promptProblems(text, file) {
  const block = fixtureBlock(text, 'agent-install-prompt')
  if (!block) return [`${file}: agent-install-prompt fixture block not found`]
  const problems = []
  const rules = block.content.split('\n').filter((line) => /^\s*\d+[.)]\s/.test(line))
  for (const tag of RULE_TAGS) {
    if (!rules.some((line) => new RegExp(`^\\s*\\d+[.)]\\s+${tag.replace(/[[\]]/g, '\\$&')}`).test(line))) {
      problems.push(`${file}: agent-install-prompt is missing rule tag ${tag}`)
    }
  }
  for (const line of rules) {
    if (!RULE_TAGS.some((tag) => new RegExp(`^\\s*\\d+[.)]\\s+${tag.replace(/[[\]]/g, '\\$&')}`).test(line))) {
      problems.push(`${file}: rule line does not start with a known tag: ${line.trim()}`)
    }
  }
  return problems
}

function multipleMachinesProblems(body, lang) {
  const problems = []
  const lines = body.split('\n').filter((line) => line.trim() !== '')
  if (lines.length > 8) problems.push(`multiple-machines has ${lines.length} non-empty lines (max 8)`)
  if (!extractLinks(body).some(({ target }) => target.replace(/\/$/, '') === COCKPIT_URL)) problems.push(`multiple-machines does not link ${COCKPIT_URL}`)
  const required = lang === 'zh' ? ['clone', 'dsh build', '不分发'] : ['clone', 'dsh build', 'does not distribute']
  for (const needle of required) if (!body.includes(needle)) problems.push(`multiple-machines does not contain "${needle}"`)
  return problems
}

/** Enabled entries from a parsed manifest as `{ id, kind, spec }`. */
function enabledEntries(manifest) {
  const entries = []
  for (const resource of manifest.thirdPartyResources ?? []) {
    if (resource.enabled !== false) entries.push({ id: resource.id, kind: 'resource' })
  }
  for (const item of manifest.customizations ?? []) {
    if (item.enabled === false) continue
    let kind = item.type
    if (item.type === 'package') kind = item.source === 'local' ? 'local' : 'remote'
    entries.push({ id: item.id, kind, spec: item.spec })
  }
  return entries
}

/** Markdown links `[text](target)` per line of a section body (inline code and fences ignored). */
function indexLinks(body) {
  const links = []
  stripCode(body)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g)) {
        links.push({ line: index + 1, text: match[1], target: match[2], after: line.slice(match.index + match[0].length) })
      }
    })
  return links
}

function unlistedIds(entries, body) {
  const texts = new Set(indexLinks(body).map((link) => link.text))
  return entries.filter((entry) => !texts.has(entry.id)).map((entry) => entry.id)
}

function semverLines(body) {
  return body
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => SEMVER.test(text))
}

function expectedTarget(entry) {
  switch (entry.kind) {
    case 'local':
      return { type: 'path', value: `packages/${entry.id}/README.md` }
    case 'skill':
      return { type: 'path', value: `skills/${entry.id}/SKILL.md` }
    case 'preset':
      return { type: 'path', value: `presets/${entry.id}` }
    case 'patch':
      return { type: 'path', value: `patches/${entry.id}.yml` }
    default: {
      const release = typeof entry.spec === 'string' && entry.spec.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\//)
      if (release) return { type: 'exact', value: `https://github.com/${release[1]}/${release[2]}` }
      return { type: 'https' }
    }
  }
}

function indexProblems(entries, body, files, file) {
  const problems = []
  const links = indexLinks(body)
  for (const entry of entries) {
    const matches = links.filter((link) => link.text === entry.id)
    if (matches.length === 0) {
      problems.push(`${file}: ${entry.id} is not listed`)
      continue
    }
    if (matches.length > 1) problems.push(`${file}: ${entry.id} is listed ${matches.length} times`)
    const link = matches[0]
    const expected = expectedTarget(entry)
    if (expected.type === 'path') {
      const resolved = resolveLinkTarget('README.md', link.target)
      if (resolved !== expected.value) problems.push(`${file}: ${entry.id} links ${link.target}, expected ${expected.value}`)
      else if (!isTrackedPathOrDir(files, resolved)) problems.push(`${file}: ${entry.id} links untracked path ${resolved}`)
    } else if (expected.type === 'exact') {
      if (link.target !== expected.value) problems.push(`${file}: ${entry.id} links ${link.target}, expected exactly ${expected.value}`)
    } else if (!link.target.startsWith('https://')) {
      problems.push(`${file}: ${entry.id} links ${link.target}, expected an https:// URL`)
    }
    const capability = (link.after.match(/[\p{L}\p{N}]/gu) ?? []).length
    if (capability < 8) problems.push(`${file}: ${entry.id} has no capability sentence (${capability} letters after the link, need ≥ 8)`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// repo-facade: bilingual pair + anchors
// ---------------------------------------------------------------------------

test('root README pair is tracked, cross-linked, and anchor sequences match', () => {
  const files = facadeFiles()
  assert.ok(files.includes('README.md'), 'README.md is not tracked')
  assert.ok(files.includes('README.zh.md'), 'README.zh.md is not tracked')
  assert.ok(!files.includes('README.en.md'), 'README.en.md must not be tracked')

  const en = read('README.md')
  const zh = read('README.zh.md')
  assert.ok(linksTo(en, 'README.zh.md'), 'README.md does not link README.zh.md within its first 30 lines')
  assert.ok(linksTo(zh, 'README.md'), 'README.zh.md does not link README.md within its first 30 lines')

  const enKeys = sectionAnchors(en).map((anchor) => anchor.key)
  const zhKeys = sectionAnchors(zh).map((anchor) => anchor.key)
  const diff = anchorSequenceDiff(enKeys, zhKeys)
  assert.equal(diff, null, `anchor sequences differ: ${JSON.stringify(diff)}`)

  assert.ok(cjkRatio(en) < 0.05, `README.md CJK ratio ${cjkRatio(en).toFixed(3)} should be < 0.05`)
  assert.ok(cjkRatio(zh) > 0.2, `README.zh.md CJK ratio ${cjkRatio(zh).toFixed(3)} should be > 0.20`)
})

test('anchor sequence mismatch reports first differing position', () => {
  const en = ['## A', '<!-- section: a -->', '## FAQ', '<!-- section: faq -->', '## B', '<!-- section: b -->'].join('\n')
  const zh = ['## A', '<!-- section: a -->', '## B', '<!-- section: b -->'].join('\n')
  const diff = anchorSequenceDiff(sectionAnchors(en).map((a) => a.key), sectionAnchors(zh).map((a) => a.key))
  assert.deepEqual(diff, { index: 1, left: 'faq', right: 'b' })
})

test('h2 without section anchor is reported with its line', () => {
  const text = ['# T', '', '## One', '<!-- section: one -->', 'body', '', '## Two', 'body without anchor', '```', '## fenced is ignored', '```'].join('\n')
  assert.deepEqual(h2WithoutAnchor(text), [{ line: 7, heading: '## Two' }])
  assert.ok(anchorProblems(text, 'README.zh.md').some((problem) => problem.startsWith('README.zh.md:7:')))
})

test('both READMEs have exactly the eight anchors in order with diagrams and lifecycle vocabulary', () => {
  for (const file of README_FILES) {
    const text = read(file)
    assert.deepEqual(sectionAnchors(text).map((anchor) => anchor.key), REQUIRED_ANCHORS, `${file}: anchor sequence`)
    assert.deepEqual(h2WithoutAnchor(text), [], `${file}: every ## heading needs an anchor`)

    const architecture = sectionBody(text, 'architecture')
    const targets = extractLinks(architecture).map(({ target }) => resolveLinkTarget('README.md', target))
    for (const svg of ['docs/assets/ohmydsh-architecture.dual.svg', 'docs/assets/ohmydsh-lifecycle.dual.svg']) {
      assert.ok(targets.includes(svg), `${file}: architecture section does not embed ${svg}`)
      assert.ok(existsSync(path.join(REPO, svg)), `${file}: ${svg} does not exist`)
    }

    const what = sectionBody(text, 'what-it-does')
    assert.ok(what.includes('dsh.yaml'), `${file}: what-it-does lacks dsh.yaml`)
    assert.ok(what.includes('~/.dsh'), `${file}: what-it-does lacks ~/.dsh`)
    for (const word of LIFECYCLE_WORDS[file]) {
      const present = file === 'README.md' ? new RegExp(`\\b${word}\\b`, 'i').test(what) : what.includes(word)
      assert.ok(present, `${file}: what-it-does lacks lifecycle verb "${word}"`)
    }
  }
})

test('missing required anchor is named', () => {
  const keys = REQUIRED_ANCHORS.filter((key) => key !== 'multiple-machines')
  const text = keys.flatMap((key) => [`## ${key}`, `<!-- section: ${key} -->`, 'body']).join('\n')
  const problems = anchorProblems(text, 'README.md')
  assert.ok(problems.some((problem) => problem.includes('missing section anchor "multiple-machines"')), problems.join('\n'))
})

// ---------------------------------------------------------------------------
// repo-facade: Quick Start
// ---------------------------------------------------------------------------

function parseMinimalManifest(file) {
  const block = fixtureBlock(read(file), 'minimal-manifest')
  assert.ok(block, `${file}: minimal-manifest fixture block not found`)
  assert.equal(block.info, 'yaml', `${file}: minimal-manifest fence must be a yaml block`)
  return { block, manifest: yaml.load(block.content) }
}

/** Black-box sync fixture: temp repo + temp DSH_HOME + fake DSH_BIN (see tests/sync-profile-scaffold.test.mjs). */
async function syncFixture(manifestText) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-facade-minimal-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(path.join(REPO, 'scripts', 'sync.mjs')))
  for (const lib of ['dsh-cli', 'dsh-host-runtime', 'manifest-overlay', 'env-local', 'profile-lock', 'legacy-settings']) {
    await writeFile(path.join(repo, 'scripts', 'lib', `${lib}.mjs`), await readFile(path.join(REPO, 'scripts', 'lib', `${lib}.mjs`)))
  }
  await mkdir(path.join(repo, 'node_modules'), { recursive: true })
  // sync hard-depends on js-yaml and, when it rewrites the profile patch, on yaml.
  for (const dep of ['js-yaml', 'yaml']) await symlink(path.join(REPO, 'node_modules', dep), path.join(repo, 'node_modules', dep), 'dir')
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, type: 'module' }))
  await writeFile(path.join(repo, 'dsh.yaml'), manifestText)

  const actions = path.join(root, 'actions.log')
  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
printf '%s\\n' "$*" >> "${actions}"
if [[ "\${3:-}" == "--dump-default-config" ]]; then
  mkdir -p "$profile"
  if [[ ! -f "$profile/package.json" ]]; then
    printf '{"name":"dsh-profile-web","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}' > "$profile/package.json"
  fi
  if [[ ! -f "$profile/cordis.patch.yml" ]]; then
    printf '# Your patch layer for this dsh profile\\n[]\\n' > "$profile/cordis.patch.yml"
  fi
  echo "[]"
  exit 0
fi
if [[ "\${4:-}" == "add" ]]; then
  echo "unexpected plugin add: $*" >&2
  exit 1
fi
`)
  await chmod(fake, 0o755)
  const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake, DSH_LOCAL_MANIFEST: path.join(root, 'no-overlay.yaml') },
  })
  return { run, actions }
}

test('minimal-manifest fixture has exact shape and black-box sync accepts it with no installs', async () => {
  for (const file of README_FILES) {
    const { block, manifest } = parseMinimalManifest(file)
    assert.deepEqual(Object.keys(manifest).sort(), ['autoUpdate', 'customizations', 'dshVersion'], `${file}: top-level keys`)
    assert.deepEqual(manifest.autoUpdate, { enabled: false }, `${file}: autoUpdate`)
    assert.deepEqual(manifest.customizations, [], `${file}: customizations`)
    assert.equal(manifest.dshVersion, rootManifest().dshVersion, `${file}: dshVersion`)

    const fx = await syncFixture(`${block.content}\n`)
    const result = fx.run()
    assert.equal(result.status, 0, `${file}: sync exited ${result.status}\n${result.stdout}\n${result.stderr}`)
    assert.doesNotMatch(result.stdout, /\binstall\b/, `${file}: sync reported install actions:\n${result.stdout}`)
    const log = existsSync(fx.actions) ? readFileSync(fx.actions, 'utf8') : ''
    assert.doesNotMatch(log, /\badd\b/, `${file}: fake CLI saw a plugin add:\n${log}`)
  }
})

test('minimal-manifest dshVersion equals root dsh.yaml dshVersion', () => {
  const root = rootManifest().dshVersion
  for (const file of README_FILES) {
    const { manifest } = parseMinimalManifest(file)
    assert.equal(manifest.dshVersion, root, `${file}: README dshVersion ${manifest.dshVersion} != root dsh.yaml dshVersion ${root}`)
  }
})

test('agent-install-prompt contains all six rule tags in both READMEs', () => {
  for (const file of README_FILES) assert.deepEqual(promptProblems(read(file), file), [])

  const synthetic = ['<!-- fixture: agent-install-prompt -->', '```text', ...RULE_TAGS.filter((tag) => tag !== '[NO-SECRETS]').map((tag, i) => `${i + 1}. ${tag} rule`), '```'].join('\n')
  assert.deepEqual(promptProblems(synthetic, 'README.zh.md'), ['README.zh.md: agent-install-prompt is missing rule tag [NO-SECRETS]'])
})

test('every dsh subcommand mentioned in READMEs exists in bin/dsh case arms', () => {
  const known = binDshSubcommands(readFileSync(path.join(REPO, 'bin', 'dsh'), 'utf8'))
  for (const command of ['build', 'stop', 'restart', 'reset', 'history', 'plugin-update', 'doctor']) {
    assert.ok(known.has(command), `bin/dsh no longer declares ${command}`)
  }
  for (const file of README_FILES) {
    assert.deepEqual(unknownSubcommands(read(file), known), [], `${file} references subcommands not in bin/dsh`)
  }
  assert.deepEqual(unknownSubcommands('Run `dsh init` first.\n```bash\ndsh build && dsh\n```', known), ['init'])
})

// ---------------------------------------------------------------------------
// repo-facade: multiple machines
// ---------------------------------------------------------------------------

test('multiple-machines is at most 8 lines, links dsh-cockpit, states per-machine build', () => {
  assert.deepEqual(multipleMachinesProblems(sectionBody(read('README.md'), 'multiple-machines'), 'en'), [])
  assert.deepEqual(multipleMachinesProblems(sectionBody(read('README.zh.md'), 'multiple-machines'), 'zh'), [])
})

test('multiple-machines over 8 lines reports the count', () => {
  const body = ['Each machine runs a clone and `dsh build`; cockpit does not distribute.', `[cockpit](${COCKPIT_URL})`, ...Array.from({ length: 8 }, (_, i) => `extra ${i}`)].join('\n')
  assert.deepEqual(multipleMachinesProblems(body, 'en'), ['multiple-machines has 10 non-empty lines (max 8)'])
})

// ---------------------------------------------------------------------------
// repo-facade: plugin index
// ---------------------------------------------------------------------------

test('plugin index covers every enabled customization and resource with valid links and descriptions', () => {
  const entries = enabledEntries(rootManifest())
  assert.ok(entries.length > 20, 'manifest parsing returned suspiciously few entries')
  const files = facadeFiles()
  for (const file of README_FILES) {
    const body = sectionBody(read(file), 'plugins')
    assert.ok(body, `${file}: plugins section missing`)
    assert.deepEqual(indexProblems(entries, body, files, file), [])
  }
})

test('unlisted enabled id is reported', () => {
  const manifest = {
    thirdPartyResources: [{ id: 'res-a', enabled: true }],
    customizations: [
      { id: 'pkg-a', type: 'package', source: 'local', enabled: true },
      { id: 'pkg-b', type: 'package', source: 'remote', spec: 'pkg-b@1.0.0', enabled: true },
      { id: 'off', type: 'package', source: 'remote', enabled: false },
    ],
  }
  const body = '- [pkg-a](packages/pkg-a/README.md) — does something useful\n- [res-a](https://example.com/a) — a resource entry\n'
  assert.deepEqual(unlistedIds(enabledEntries(manifest), body), ['pkg-b'])
  const problems = indexProblems(enabledEntries(manifest), body, ['packages/pkg-a/README.md'], 'README.md')
  assert.deepEqual(problems, ['README.md: pkg-b is not listed'])
})

test('semver in plugin index is reported with its line', () => {
  const body = ['- [a](https://example.com/a) — fine description here', '- [b](https://example.com/b) — pinned at 0.9.7 for now'].join('\n')
  assert.deepEqual(semverLines(body), [{ line: 2, text: '- [b](https://example.com/b) — pinned at 0.9.7 for now' }])
  for (const file of README_FILES) {
    const real = semverLines(sectionBody(read(file), 'plugins'))
    assert.deepEqual(real, [], `${file}: semver numbers in plugins section`)
  }
})
