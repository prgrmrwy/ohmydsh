#!/usr/bin/env node
// One-off migration acceptance check for the old notes directory -> OpenSpec/package
// relocation (OpenSpec change github-facade-refresh, design D4).
//
//   node scripts/maintenance/notes-migration-diff.mjs <base-ref> [--root <dir>] [--disposition <file>]
//
// For every `move` row of notes-disposition.json it takes the source file as it
// was at <base-ref>, applies the same redaction (automatic rules, then the
// registered manual items) and the same path normalisation (relative links and
// bare mentions of an old note path are resolved to the migrated location),
// and compares the result line by line with the migrated target minus its
// one-line attribution header. Any residual difference is reported and the
// command exits non-zero, so the only edits a `move` file can carry are the
// registered ones. External URLs are compared byte for byte.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO = path.resolve(HERE, '..', '..')
const CHANGE = 'github-facade-refresh'

/** Apply the automatic redaction rules (JS regex source + replacement) to `text`. */
export function applyAutoRedaction(text, rules) {
  let out = text
  for (const rule of rules) out = out.replace(new RegExp(rule.pattern, 'g'), rule.replace)
  return out
}

/** Apply registered manual `{ find, replace }` items (literal, all occurrences). */
export function applyManualRedactions(text, items) {
  let out = text
  for (const item of items ?? []) out = out.split(item.find).join(item.replace)
  return out
}

function isExternal(target) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('//') || target.startsWith('#')
}

/**
 * Resolve link / path mentions to canonical repo paths so that a relative link
 * in the old location and its rewritten twin in the new location compare equal.
 * `notesMap` maps old note paths to their migrated targets.
 */
export function canonicalizePaths(text, fromFile, notesMap) {
  const resolve = (target) => {
    if (isExternal(target)) return null
    const [pathPart, ...rest] = target.split('#')
    const anchor = rest.length ? `#${rest.join('#')}` : ''
    if (pathPart === '') return null
    const joined = pathPart.startsWith('/') ? pathPart.slice(1) : path.posix.join(path.posix.dirname(fromFile), pathPart)
    const normalized = path.posix.normalize(joined)
    return `${notesMap.get(normalized) ?? normalized}${anchor}`
  }
  let out = text.replace(/\]\(\s*(<[^>]*>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/g, (whole, raw, tail) => {
    const bracketed = raw.startsWith('<')
    const resolved = resolve(bracketed ? raw.slice(1, -1) : raw)
    if (resolved === null) return whole
    return `](${bracketed ? `<${resolved}>` : resolved}${tail})`
  })
  // Bare mentions of an old note path inside prose or code spans.
  out = out.replace(/docs\/notes\/[A-Za-z0-9._-]+\.md/g, (match) => notesMap.get(match) ?? match)
  return out
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout
}

function locateDisposition(root) {
  const live = path.join(root, 'openspec/changes', CHANGE, 'notes-disposition.json')
  if (existsSync(live)) return live
  const archive = path.join(root, 'openspec/changes/archive')
  if (existsSync(archive)) {
    const hit = readdirSync(archive).find((name) => name.endsWith(`-${CHANGE}`))
    if (hit) return path.join(archive, hit, 'notes-disposition.json')
  }
  throw new Error(`cannot find notes-disposition.json for change ${CHANGE}`)
}

function unifiedDiff(a, b) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notes-diff-'))
  try {
    writeFileSync(path.join(dir, 'expected'), a)
    writeFileSync(path.join(dir, 'actual'), b)
    const result = spawnSync('diff', ['-u', '--label', 'expected(source+redaction)', '--label', 'actual(target)', 'expected', 'actual'], { cwd: dir, encoding: 'utf8' })
    return result.stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Run the comparison; returns `{ ok, lines }`. */
export function runDiff({ base, root, dispositionFile }) {
  const disposition = JSON.parse(readFileSync(dispositionFile ?? locateDisposition(root), 'utf8'))
  const rows = disposition.files
  const notesMap = new Map(rows.filter((row) => row.target && row.action !== 'backlog').map((row) => [row.source, row.target]))
  const lines = []
  let ok = true
  let manualApplied = 0
  let compared = 0
  for (const row of rows.filter((entry) => entry.action === 'move')) {
    compared += 1
    const source = git(root, ['show', `${base}:${row.source}`])
    const targetPath = path.join(root, row.target)
    if (!existsSync(targetPath)) {
      ok = false
      lines.push(`FAIL #${row.n} ${row.source}: target missing: ${row.target}`)
      continue
    }
    const [header, ...bodyLines] = readFileSync(targetPath, 'utf8').split('\n')
    const expectedHeader = `> Migrated from ${row.source}.`
    if (header !== expectedHeader) {
      ok = false
      lines.push(`FAIL #${row.n} ${row.target}: first line must be ${JSON.stringify(expectedHeader)}, got ${JSON.stringify(header)}`)
    }
    for (const item of row.manualRedactions ?? []) {
      const redactedFirst = applyAutoRedaction(source, disposition.redactionRules)
      if (!redactedFirst.includes(item.find)) {
        ok = false
        lines.push(`FAIL #${row.n} ${row.source}: registered manual item not found in source: ${JSON.stringify(item.find)}`)
      } else manualApplied += redactedFirst.split(item.find).length - 1
    }
    let expected = applyAutoRedaction(source, disposition.redactionRules)
    expected = applyManualRedactions(expected, row.manualRedactions)
    expected = canonicalizePaths(expected, row.source, notesMap)
    const actual = canonicalizePaths(bodyLines.join('\n'), row.target, notesMap)
    if (expected !== actual) {
      ok = false
      lines.push(`FAIL #${row.n} ${row.source} -> ${row.target}: unregistered differences`)
      lines.push(unifiedDiff(expected, actual).trimEnd())
    } else {
      lines.push(`ok   #${row.n} ${row.source} -> ${row.target}`)
    }
  }
  lines.push(`${ok ? 'only registered manual redactions differ' : 'unregistered differences found'}: ${manualApplied} registered manual occurrence(s) across ${compared} move file(s)`)
  return { ok, lines }
}

function main(argv) {
  const args = argv.slice(2)
  const positional = []
  let root = DEFAULT_REPO
  let dispositionFile = null
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') root = path.resolve(args[(i += 1)])
    else if (args[i] === '--disposition') dispositionFile = path.resolve(args[(i += 1)])
    else positional.push(args[i])
  }
  if (positional.length !== 1) {
    console.error('usage: notes-migration-diff.mjs <base-ref> [--root <dir>] [--disposition <file>]')
    process.exitCode = 2
    return
  }
  let result
  try {
    result = runDiff({ base: positional[0], root, dispositionFile })
  } catch (error) {
    console.error(`[notes-migration-diff] ${error.message}`)
    process.exitCode = 2
    return
  }
  for (const line of result.lines) console.log(line)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv)
