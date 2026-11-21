#!/usr/bin/env node
// Prepare a release of one mirrored package: bump its version and turn its CHANGELOG's
// `## Unreleased` section into `## <version> — <date>`.
//
//   node scripts/release-package.mjs --dir packages/<dir> --bump patch|minor|major [--date YYYY-MM-DD]
//
// Changes are written to the working tree only; the caller commits them. When there is no
// non-empty Unreleased section, entries are generated from the subjects of the package's
// commits since its version last changed. With neither, the release is refused: nothing new.
// Prints the new version.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const fail = message => { console.error(message); process.exit(1) }
const git = argv => {
  const result = spawnSync('git', argv, { encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${argv.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

export function nextVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`cannot bump non-release version ${version}`)
  const [major, minor, patch] = match.slice(1).map(Number)
  return kind === 'major' ? `${major + 1}.0.0` : kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}

/** Returns the changelog with Unreleased renamed, or undefined when it has no non-empty Unreleased section. */
export function promoteUnreleased(changelog, version, day) {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => /^## Unreleased\s*$/i.test(line))
  if (start < 0) return undefined
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  if (!lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()) return undefined
  lines[start] = `## ${version} — ${day}`
  return lines.join('\n')
}

/** Inserts a generated section before the first version heading (or at the end). */
export function insertSection(changelog, version, day, entries) {
  const lines = changelog.split('\n')
  const first = lines.findIndex(line => line.startsWith('## '))
  const section = [`## ${version} — ${day}`, '', ...entries.map(entry => `- ${entry}`), '']
  lines.splice(first < 0 ? lines.length : first, 0, ...section)
  return lines.join('\n')
}

/** Sets `version:` of the manifest entry `- id: <id>`; returns the manifest unchanged when the entry or its version is absent. */
export function setManifestVersion(manifest, id, version) {
  const lines = manifest.split('\n')
  const start = lines.findIndex(line => new RegExp(`^\\s*-\\s+id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(line))
  if (start < 0) return manifest
  for (let i = start + 1; i < lines.length && !/^\s*-\s+id:/.test(lines[i]) && !/^\S/.test(lines[i]); i++) {
    if (/^\s+version:\s*/.test(lines[i])) { lines[i] = lines[i].replace(/(version:\s*)\S+/, `$1${version}`); return lines.join('\n') }
  }
  return manifest
}

function main() {
  const dir = option('--dir'), bump = option('--bump')
  const date = option('--date') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  if (!dir || !['patch', 'minor', 'major'].includes(bump) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail('usage: release-package.mjs --dir packages/<dir> --bump patch|minor|major [--date YYYY-MM-DD]')
  }
  const manifestFile = path.join(dir, 'package.json'), changelogFile = path.join(dir, 'CHANGELOG.md')
  const manifestText = readFileSync(manifestFile, 'utf8')
  const current = JSON.parse(manifestText).version
  const version = nextVersion(current, bump)
  const changelog = readFileSync(changelogFile, 'utf8')
  let updated = promoteUnreleased(changelog, version, date)
  if (updated === undefined) {
    const since = git(['log', '-1', '--format=%H', '-G', '"version"', '--', manifestFile])
    const subjects = git(['log', '--no-merges', '--format=%s', ...since ? [`${since}..HEAD`] : [], '--', dir])
      .split('\n').filter(subject => subject && !/^chore\(mirror\)/.test(subject))
    if (!subjects.length) fail(`${dir}: nothing to release since ${current} (no Unreleased entries and no package commits)`)
    updated = insertSection(changelog, version, date, subjects.reverse())
  }
  writeFileSync(manifestFile, manifestText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`))
  writeFileSync(changelogFile, updated)
  // Keep the root manifest's pin of a local package equal to its real version, or every sync sees drift.
  const name = JSON.parse(manifestText).name
  const manifestPath = 'dsh.yaml'
  try {
    const text = readFileSync(manifestPath, 'utf8')
    const next = setManifestVersion(text, name, version)
    if (next !== text) writeFileSync(manifestPath, next)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  console.log(version)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
