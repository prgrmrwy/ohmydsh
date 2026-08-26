#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { trackedFiles } from './check-tracked-artifacts.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = 'openspec/changes/federated-dsh-control-plane/checking'
const FIXTURE_PATH = /^openspec\/changes\/federated-dsh-control-plane\/checking\/(?:protocol|ui-fixtures|compatibility)\//
const TEXT = /\.(?:json|md|txt|ya?ml)$/i
const forbidden = [
  { name: 'private key material', pattern: /-----BEGIN (?:OPENSSH|RSA|EC|DSA|PRIVATE) PRIVATE KEY-----/i },
  { name: 'provider/API token', pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,})\b/ },
  { name: 'bearer credential', pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+\/-]{12,}/i },
  { name: 'home path', pattern: /\/(?:Users|home)\/(?!fixture(?:\/|[-_]))[A-Za-z0-9._-]+\// },
  { name: 'DSH home path', pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\/\.dsh\// },
  { name: 'raw screenshot reference', pattern: /\.(?:png|jpe?g|webp|gif)\b/i },
]

export function federationFixtureContentViolations(file, content) {
  const violations = []
  if (/ui-fixtures\/.*\.json$/.test(file)) {
    try {
      const fixture = JSON.parse(content)
      if (fixture.classification !== 'synthetic-secret-free' || fixture.generatedFromRealUserData !== false) {
        violations.push(`${file}: UI fixture must declare synthetic-secret-free and generatedFromRealUserData=false`)
      }
    } catch {
      violations.push(`${file}: invalid JSON fixture`)
    }
  }
  for (const rule of forbidden) if (rule.pattern.test(content)) violations.push(`${file}: contains ${rule.name}`)
  if (content.length > 256_000) violations.push(`${file}: fixture exceeds 256 KiB summarized-evidence limit`)
  return violations
}

export async function federationFixtureViolations(files = trackedFiles(REPO)) {
  const violations = []
  for (const file of files.map(value => value.split(path.sep).join('/'))) {
    if (!FIXTURE_PATH.test(file) || !TEXT.test(file)) continue
    const content = await readFile(path.join(REPO, file), 'utf8')
    violations.push(...federationFixtureContentViolations(file, content))
  }
  return violations
}

async function main() {
  const violations = await federationFixtureViolations()
  if (violations.length > 0) {
    console.error(`[federation-fixtures] ${violations.length} violation(s) under ${ROOT}:`)
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exitCode = 1
    return
  }
  console.log('[federation-fixtures] tracked protocol/UI fixtures are synthetic and secret-free')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
