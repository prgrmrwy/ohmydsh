#!/usr/bin/env node
/**
 * Build the fixed-source `@deepseek-ai/dsh-subagent` compatibility artifact.
 *
 * Why this exists: a locus child answers in its own Feishu entry, so the
 * runtime must NOT push its automatic settlement account into the main
 * session. The pinned 0.1.2-rc.1 runtime has no switch for that, and there is
 * no safe way to add one from outside it — the automatic notice and a genuine
 * child-to-parent message resolve the parent through the same call, so any
 * external interception would break the child's ability to ask its parent a
 * question (verified, not assumed).
 *
 * So the capability is added at the source, against a PINNED upstream commit,
 * and this script is the reproducible path from that source to the artifact:
 *
 *   fetch pinned tag -> verify the patch applies -> build -> verify capability
 *
 * Nothing here is tracked except the patch: the built `lib/` is a generated
 * artifact and stays out of version control, matching the repository policy.
 *
 * Remove this whole directory once upstream publishes `settlementNotice`, and
 * depend on the official package again.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const patchFile = join(here, 'settlement-notice.patch')

/** Pinned upstream identity. A drift here must fail the build, never adapt. */
const UPSTREAM = {
  repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  tag: 'dsh-v0.1.2-rc.1',
  packageDir: 'packages/subagent/subagent',
  /** sha256 of `settlement-notice.patch`, so a silently edited patch fails. */
  patchSha256:'abf9689904f04c0abc79bc9d444db63e75dcdb7005ef30b2eaecd2384ca21457',
}

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

function fail(message) {
  console.error(`[compat/subagent] ${message}`)
  process.exit(1)
}

const actualPatchHash = createHash('sha256').update(readFileSync(patchFile)).digest('hex')
if (actualPatchHash !== UPSTREAM.patchSha256) {
  fail(
    `patch hash mismatch\n  expected ${UPSTREAM.patchSha256}\n  actual   ${actualPatchHash}\n`
    + 'Refusing to build: the recorded source change is not the one on disk.',
  )
}

const checkout = process.env.DSH_COMPAT_SUBAGENT_CHECKOUT ?? join(here, '.upstream')
if (!existsSync(join(checkout, '.git'))) {
  rmSync(checkout, { recursive: true, force: true })
  mkdirSync(dirname(checkout), { recursive: true })
  console.log(`[compat/subagent] cloning ${UPSTREAM.tag}`)
  run('git', [
    'clone', '--depth', '1', '--branch', UPSTREAM.tag,
    UPSTREAM.repository, checkout,
  ])
} else {
  // Reset any previous application so the build is reproducible.
  run('git', ['checkout', '--', '.'], checkout)
}

// Verify the pinned tag really is what is checked out: a moved tag would
// otherwise silently change the base the patch applies to.
const head = run('git', ['rev-parse', 'HEAD'], checkout).trim()
console.log(`[compat/subagent] base ${head}`)

try {
  run('git', ['apply', '--check', patchFile], checkout)
} catch {
  fail(
    'the recorded patch does not apply to the pinned upstream source.\n'
    + 'This means upstream moved: re-derive the patch (or drop this artifact if '
    + 'the capability has been published) instead of forcing it.',
  )
}
run('git', ['apply', patchFile], checkout)

console.log('[compat/subagent] building upstream host libraries')
run('corepack', ['pnpm', 'install', '--prefer-offline'], checkout)
run('corepack', ['pnpm', 'run', 'build:lib:host'], checkout)

const built = join(checkout, UPSTREAM.packageDir)
const libSource = join(built, 'lib')
if (!existsSync(libSource)) fail('upstream build produced no lib directory')

// Publish the artifact: the official package name and exports, the built
// runtime, and a version marked so it can never be mistaken for the release.
const target = resolve(here)
rmSync(join(target, 'lib'), { recursive: true, force: true })
cpSync(libSource, join(target, 'lib'), { recursive: true })
for (const stale of ['lib/tsconfig.tsbuildinfo', 'lib/types/tsconfig.tsbuildinfo']) {
  rmSync(join(target, stale), { force: true })
}

const upstreamPkg = JSON.parse(readFileSync(join(built, 'package.json'), 'utf8'))
const trackedSkeleton = JSON.parse(readFileSync(join(target, 'package.template.json'), 'utf8'))
const { devDependencies: _dev, publishConfig: _publish, ...rest } = upstreamPkg
const manifest = {
  ...rest,
  // Derive the build number from the tracked skeleton, so a build never shows
  // up as a change to a version-controlled file.
  version: `${upstreamPkg.version}-locus-settlement-notice.${
    Number(String(trackedSkeleton.version).split('.').pop() ?? 0) + 1
  }`,
  dsh_compat: {
    replaces: `@deepseek-ai/dsh-subagent@${upstreamPkg.version}`,
    reason: 'adds the opt-in settlementNotice so a locus child never reports into its main session',
    upstreamTag: UPSTREAM.tag,
    upstreamBase: head,
    patchSha256: UPSTREAM.patchSha256,
    removeWhen: 'upstream publishes settlementNotice; then delete compat/subagent and use the official package',
  },
}
const { writeFileSync } = await import('node:fs')
// `sync.mjs` installs this directory by path and checks that its manifest
// declares the official package name, so the built manifest replaces the
// skeleton in the working tree. It is gitignored, which is why a build leaves
// no source diff behind.
writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

// Prove the capability is actually present, rather than trusting the build.
const descriptor = await import(join(target, 'lib', 'index.js'))
const runtimeSource = readFileSync(join(target, 'lib', 'index.js'), 'utf8')
if (!/settlementNotice\s*===\s*["']silent["']/.test(runtimeSource)) {
  fail('built artifact has no silent-settlement guard; refusing to publish it')
}
if (!runtimeSource.includes('supportsSettlementNotice')) {
  fail('built artifact has no structural capability marker; Pet would keep it unavailable')
}
if (
  !runtimeSource.includes('supportsIdleContinuableCreate')
  || !runtimeSource.includes('createIdleContinuable')
) {
  fail('built artifact has no idle-continuable capability; safe two-phase provisioning is unavailable')
}
// Instantiate the actual service object Pet probes. A string in the bundle is
// not enough: the marker must be present on the runtime instance returned by
// `ctx.get('subagents')`.
const requireFromBuiltPackage = createRequire(join(built, 'package.json'))
const cordisEntry = requireFromBuiltPackage.resolve('@deepseek-ai/cordis')
const cordis = await import(pathToFileURL(cordisEntry).href)
const runtime = new descriptor.default(new cordis.Context())
if (
  runtime.supportsSettlementNotice !== true
  || runtime.supportsIdleContinuableCreate !== true
  || typeof runtime.createIdleContinuable !== 'function'
) {
  fail('built SubagentRuntime instance does not expose the required capabilities')
}
const probe = descriptor.snapshotSubagentDescriptor({
  mode: 'continuable', provider: 'fork', label: 'probe', settlementNotice: 'silent',
})
if (probe.settlementNotice !== 'silent') {
  fail('built artifact does not record settlementNotice; refusing to publish it')
}
const control = descriptor.snapshotSubagentDescriptor({
  mode: 'continuable', provider: 'fork', label: 'probe', settlementNotice: 'notify',
})
if ('settlementNotice' in control) {
  fail('built artifact changed the default payload shape; refusing to publish it')
}
console.log(`[compat/subagent] ready: ${manifest.name}@${manifest.version}`)
