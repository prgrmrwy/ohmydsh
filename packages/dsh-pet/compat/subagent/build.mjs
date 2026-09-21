#!/usr/bin/env node
/**
 * Build the fixed-source `@deepseek-ai/dsh-subagent` compatibility artifact.
 *
 * Why this exists: Pet's locus children need narrow Host-owned continuable
 * runtime seams that the pinned 0.1.5-rc.2 package does not expose: silent
 * settlement, idle creation, independent-v1 context with a saved preset, and
 * continuation-owned child Session access. The settlement notice and a genuine
 * child-to-parent message resolve the parent through the same call, so external
 * interception would break child questions (verified, not assumed).
 *
 * These capabilities are added at source against a PINNED upstream commit, and
 * this script is the reproducible path from that source to the artifact:
 *
 *   fetch pinned tag -> verify the patch applies -> build -> verify capabilities
 *
 * Nothing here is tracked except the patch: the built `lib/` is a generated
 * artifact and stays out of version control, matching the repository policy.
 *
 * Remove this whole directory only once upstream publishes every compatibility
 * capability recorded by this patch, then depend on the official package again.
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const requireHere = createRequire(import.meta.url)
const compatBuildLock = requireHere('./compat-build-lock.cjs').acquireCompatBuildLock()
const { runCompatCommand } = requireHere('./compat-run.cjs')
process.once('exit', () => compatBuildLock.release())
const patchFile = join(here, 'settlement-notice.patch')

/** Pinned upstream identity. A drift here must fail the build, never adapt. */
const UPSTREAM = {
  repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  tag: 'dsh-v0.1.5-rc.2',
  packageDir: 'packages/subagent/subagent',
  /** Reviewed commit behind dsh-v0.1.5-rc.2; a moved tag/local checkout fails. */
  commit: 'fb2c4b9e698e30edb738bca4cf0618587db7d203',
  /** sha256 of `settlement-notice.patch`, so a silently edited patch fails. */
  patchSha256: '68f9531ad03ae0a1c6a9cebc3884f04ee2b1dca1cad542f0a832246fa978e8a0',
}

const run = (command, args, cwd = here, options) => runCompatCommand(command, args, cwd, options)
const capture = (command, args, cwd = here) => runCompatCommand(command, args, cwd, { capture: true })

function fail(message) {
  console.error(`[compat/subagent] ${message}`)
  process.exit(1)
}

function assertSupportedNode() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 19)) {
    fail(`Node ${process.versions.node} is unsupported; reviewed DSH source requires Node ^22.19.0 or >=24.0.0`)
  }
}

assertSupportedNode()
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
}
// Reset both an existing checkout and a freshly cloned/movable tag to the exact
// reviewed commit. The commit must already be present in the shallow clone.
run('git', ['checkout', '--detach', UPSTREAM.commit], checkout)
run('git', ['checkout', '--', '.'], checkout)
const head = capture('git', ['rev-parse', 'HEAD'], checkout).trim()
if (head !== UPSTREAM.commit) fail(`reviewed upstream commit mismatch: ${head}`)
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

// Semantic gate BEFORE publishing: the reviewed proofs must pass on the
// patched target source. A build that only typechecks can still have lost the
// exact behaviors Pet depends on, so a failure here must stop publication.
console.log('[compat/subagent] proving reviewed seams on the patched source')
run('corepack', ['pnpm@11.7.0', 'install', '--prefer-offline'], checkout, { env: { CI: 'true' } })
run(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'native/system/scripts/build.ts', '--host-addon-only'], checkout)
run(process.execPath, [
  './node_modules/vitest/vitest.mjs', 'run',
  'packages/core/agent-loop/tests/inbox.spec.ts',
  'packages/subagent/subagent/tests/continuation.spec.ts',
  '--reporter=dot',
], checkout, { env: { CI: 'true' } })

console.log('[compat/subagent] building upstream host libraries')
run('corepack', ['pnpm@11.7.0', 'install', '--prefer-offline'], checkout, { env: { CI: 'true' } })
run(process.execPath, ['--max-old-space-size=4096', './node_modules/typescript/bin/tsc', '-b', 'tsconfig.host.json'], checkout)
run(process.execPath, ['./node_modules/tsdown/dist/run.mjs', '--env.DSH_BUILD_FACE', 'host'], checkout)

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

// The isolated-claim seam is patched into `dsh-agent` and `dsh-agent-loop`, so
// those built packages must be published beside the subagent artifact: the
// launcher overrides them by path, and a launcher resolving the unpatched
// registry build would leave Pet's inquiry queue unavailable.
const agentArtifacts = join(here, 'agent-artifacts')
rmSync(agentArtifacts, { recursive: true, force: true })
for (const [sourceDir, artifactName] of [['packages/core/agent', 'agent'], ['packages/core/agent-loop', 'agent-loop']]) {
  const sourcePackage = join(checkout, sourceDir)
  const artifact = join(agentArtifacts, artifactName)
  mkdirSync(artifact, { recursive: true })
  cpSync(join(sourcePackage, 'lib'), join(artifact, 'lib'), { recursive: true })
  for (const stale of ['lib/tsconfig.tsbuildinfo', 'lib/types/tsconfig.tsbuildinfo']) {
    rmSync(join(artifact, stale), { force: true })
  }
  const pkg = JSON.parse(readFileSync(join(sourcePackage, 'package.json'), 'utf8'))
  delete pkg.devDependencies
  delete pkg.publishConfig
  const baseVersion = pkg.version
  pkg.version = `${baseVersion}-locus-isolated-claim.1`
  pkg.dsh_compat = {
    replaces: `${pkg.name}@${baseVersion}`,
    reason: 'adds the opt-in isolated queued-turn claim so an inquiry turn has one provable origin without discarding pending next-step input',
    upstreamTag: UPSTREAM.tag,
    upstreamBase: head,
    patchSha256: UPSTREAM.patchSha256,
    removeWhen: 'upstream publishes the isolated queued-turn claim; then delete compat/subagent and use the official packages',
  }
  writeFileSync(join(artifact, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
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
    reason: 'adds silent settlement, idle creation, independent-v1 continuable children, and exact continuation-owned child Session access for unified locus',
    upstreamTag: UPSTREAM.tag,
    upstreamBase: head,
    patchSha256: UPSTREAM.patchSha256,
    removeWhen: 'upstream publishes settlementNotice and independent-v1; then delete compat/subagent and use the official package',
  },
}
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
if (
  !runtimeSource.includes('supportsSettlementNotice')
  || !runtimeSource.includes('supportsIndependentContinuableCreate')
) {
  fail('built artifact has no structural settlement/independent capability marker; Pet would keep it unavailable')
}
if (
  !runtimeSource.includes('supportsIdleContinuableCreate')
  || !runtimeSource.includes('createIdleContinuable')
) {
  fail('built artifact has no idle-continuable capability; safe two-phase provisioning is unavailable')
}
if (
  !runtimeSource.includes('supportsLiveContinuableChildSession')
  || !runtimeSource.includes('withLiveContinuableChildSession')
) {
  fail('built artifact has no continuation-owned child Session capability; policy mutation is unavailable')
}

// The isolated-claim seam: the `AgentOptions` opt-in lives in `dsh-agent`,
// while `Inbox.claim`, the loop wiring and the capability marker live in
// `dsh-agent-loop` (0.1.5 moved `Inbox` out of `dsh-agent`). Verify the
// artifacts just published above; `build-launcher.cjs` owns proving that they
// actually reach the launcher's dependency graph.
const agentLoopRuntimeEntry = join(agentArtifacts, 'agent-loop', 'lib', 'index.js')
const agentLoopRuntimeSource = readFileSync(agentLoopRuntimeEntry, 'utf8')
// `AgentOptions.isolateQueuedTurnClaim` is an interface member, so it is
// correctly erased from emitted JS and must be proven in the published type
// declaration instead. Checking the JS bundle here would always fail.
const agentOptionsTypes = readFileSync(
  join(agentArtifacts, 'agent', 'lib', 'types', 'runtime-types.d.ts'),
  'utf8',
)
if (!agentOptionsTypes.includes('isolateQueuedTurnClaim')) {
  fail('built dsh-agent has no isolated-claim opt-in; a non-steering inquiry queue would silently destroy GUI next-step input')
}
if (
  !agentLoopRuntimeSource.includes('supportsIsolatedQueuedTurnClaim')
  || !agentLoopRuntimeSource.includes('isolateQueuedTurn')
  || !/claim\(target,\s*turn,\s*options\)/.test(agentLoopRuntimeSource)
) {
  fail('built dsh-agent-loop has no isolated-claim seam, opt-in or capability marker; Pet would keep the inquiry queue unavailable')
}
// A string in the bundle does not prove behavior. The reviewed source carries
// executable proofs for exactly these seams (isolated claim scope, silent
// settlement, idle creation, independent composition, exact child Session),
// and they run against the patched checkout immediately below.

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
  || runtime.supportsLiveContinuableChildSession !== true
  || runtime.supportsIndependentContinuableCreate !== true
  || typeof runtime.createIdleContinuable !== 'function'
  || typeof runtime.withLiveContinuableChildSession !== 'function'
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
if (control.version !== 4 || 'settlementNotice' in control || 'contextMode' in control || 'agentPreset' in control) {
  fail('built artifact changed the legacy descriptor shape; refusing to publish it')
}
const independentToolFilter = { allow: ['read', 'read_image', 'glob', 'grep', 'web_search'] }
const independent = descriptor.snapshotSubagentDescriptor({
  mode: 'continuable', provider: 'spawn', label: 'independent-probe',
  agentProvider: 'deepseek', agentModel: 'chat', contextMode: 'independent-v1', agentPreset: 'default',
  toolFilter: independentToolFilter,
})
if (
  independent.version !== 5
  || independent.contextMode !== 'independent-v1'
  || independent.agentPreset !== 'default'
  || JSON.stringify(independent.toolFilter) !== JSON.stringify(independentToolFilter)
) {
  fail('built artifact does not record the independent-v1 durable tool filter; refusing to publish it')
}
const restoredIndependent = descriptor.foldSubagentDescriptor([{
  type: 'subagent/descriptor', data: independent, seq: 0,
}])
if (
  restoredIndependent?.contextMode !== 'independent-v1'
  || JSON.stringify(restoredIndependent.toolFilter) !== JSON.stringify(independentToolFilter)
) {
  fail('built artifact does not cold-restore the independent-v1 durable tool filter; refusing to publish it')
}
console.log(`[compat/subagent] ready: ${manifest.name}@${manifest.version}`)
