import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A package under `packages/<id>/` is an independent unit: ohmydsh is the
// source of truth, and mirror-published packages are synced verbatim into
// their standalone repository. A package may therefore reference repository
// material only through absolute URLs, never through a relative path that
// escapes its own directory. The repository root is free to reference a
// package; the dependency never points the other way.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED = /\/(node_modules|\.upstream|\.storage-upstream|lib)\//
const PACKAGES_INDEX = /^packages\/README(\.zh)?\.md$/
const SOURCE_FILE = /\.(ts|tsx|js|mjs|cjs)$/

const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const packageFiles = tracked.filter((file) => file.startsWith('packages/') && !GENERATED.test(file) && !PACKAGES_INDEX.test(file))
const packageIds = [...new Set(packageFiles.map((file) => file.split('/')[1]))]

function resolveTarget(file, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), target))
}

function escapesPackage(file, target) {
  const pkgRoot = file.split('/').slice(0, 2).join('/')
  const resolved = resolveTarget(file, target)
  return resolved !== pkgRoot && !resolved.startsWith(`${pkgRoot}/`)
}

test('package documentation references repository material only through absolute URLs', () => {
  const violations = []
  for (const file of packageFiles.filter((name) => name.endsWith('.md'))) {
    const text = readFileSync(path.join(REPO, file), 'utf8')
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const [targetPath] = target.split('#')
      if (!targetPath) continue
      if (escapesPackage(file, targetPath)) violations.push(`${file}: ${target} escapes the package; use an absolute ohmydsh URL`)
    }
  }
  assert.deepEqual(violations, [])
})

function mirrorPublishedPackages() {
  return packageIds.filter((id) => {
    const manifest = JSON.parse(readFileSync(path.join(REPO, 'packages', id, 'package.json'), 'utf8'))
    return Boolean(manifest.repository)
  })
}

test('mirror-published packages are buildable and testable from their own directory', () => {
  const packages = mirrorPublishedPackages()
  assert.ok(packages.length > 0, 'expected at least one package that declares a standalone repository')
  const violations = []
  for (const id of packages) {
    for (const file of packageFiles) {
      if (!file.startsWith(`packages/${id}/`) || !SOURCE_FILE.test(file)) continue
      const text = readFileSync(path.join(REPO, file), 'utf8')
      const specifiers = [
        ...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g),
        ...text.matchAll(/new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g),
      ].map((match) => match[1])
      for (const specifier of specifiers) {
        if (escapesPackage(file, specifier)) violations.push(`${file}: ${specifier} escapes the package`)
      }
    }
  }
  assert.deepEqual(violations, [])
})
