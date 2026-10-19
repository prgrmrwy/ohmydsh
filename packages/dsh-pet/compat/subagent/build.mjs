#!/usr/bin/env node
/**
 * Build the fixed-source `@deepseek-ai/dsh-subagent` compatibility artifact.
 *
 * Why this exists: Pet's locus children need narrow Host-owned continuable
 * runtime seams that the pinned 0.2.0-rc.2 package does not expose: silent
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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const requireHere = createRequire(import.meta.url)
const { runCompatCommand } = requireHere('./compat-run.cjs')
const { prepareUpstreamCache, recordUpstreamCache } = requireHere('./upstream-cache.cjs')
const patchFile = join(here, 'settlement-notice.patch')
const inquiryPatchFile = join(here, 'inquiry-isolation.patch')
const toolsPatchFile = join(here, 'newinquiry-tools-guard.patch')
const managedEffectsPatchFile = join(here, 'native-managed-effects.patch')
const nativeToolsTemplateFile = join(here, 'native-tools.package.template.json')
const nativeToolsVerifier = join(here, 'verify-native-managed-effects.mjs')
const agentLoopPackageDir = 'packages/core/agent-loop'
const agentLoopTemplateFile = join(here, 'agent-loop.package.template.json')
const toolsTemplateFile = join(here, 'newtools.package.template.json')
const toolsPackageDir = 'packages/core/tools'

function parseArgs(argv) {
  let output
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg !== '--isolated-output') throw new Error(`unknown argument: ${arg}`)
    if (output !== undefined) throw new Error('duplicate --isolated-output')
    const value = argv[++index]
    if (!value || value.startsWith('--') || !isAbsolute(value)) throw new Error('--isolated-output requires exactly one absolute output directory')
    output = value
  }
  return output
}

let isolatedOutput
try {
  isolatedOutput = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(`[compat/subagent] ${error.message}`)
  process.exit(2)
}
const checkout = process.env.DSH_COMPAT_SUBAGENT_CHECKOUT ?? join(here, '.upstream')
const outputRoot = isolatedOutput ? resolve(isolatedOutput) : resolve(here)
const within = (child, parent) => child === parent || child.startsWith(`${parent}${sep}`)
if (isolatedOutput && (
  within(outputRoot, resolve(here)) || within(outputRoot, resolve(checkout))
  || (existsSync(outputRoot) && readdirSync(outputRoot).length > 0)
)) {
  console.error('[compat/subagent] isolated output must be a new or empty directory outside the compat source tree')
  process.exit(2)
}
const compatBuildLock = requireHere('./compat-build-lock.cjs').acquireCompatBuildLock()
process.once('exit', () => compatBuildLock.release())

/** Pinned upstream identity. A drift here must fail the build, never adapt. */
const UPSTREAM = {
  repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  tag: 'dsh-v0.2.0-rc.2',
  packageDir: 'packages/subagent/subagent',
  /** Reviewed commit behind dsh-v0.2.0-rc.2; a moved tag/local checkout fails. */
  commit: '639ed015397290b3745d163aafe02ffee4aa3f84',
  /** SHA-256 pins for all reviewed patches; edited source changes fail closed. */
  patchSha256: '78490e17d1bbeacc3e1f05aa03c01343dd765628a1deb8068f9388bf438005c8',
  /** SHA-256 of `inquiry-isolation.patch`. */
  agentLoopPatchSha256: '0973da4b6af46fe514ffd15297073922e0cd6c3fd0c8c84ce087f721be233c92',
  /** SHA-256 of the final tool-dispatch guard patch. */
  toolsPatchSha256: '62f9c313364e4aa7a1b2ce6eb8e33f7773802ffe21bc15c40ddb04654f7b13a3',
  /** SHA-256 of the managed-effects owner patch. */
  managedEffectsPatchSha256: '645f55d882c346310f473437ef57950a27eb6dad1d2ccf670b8e2e453ecbad61',
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
const actualAgentLoopPatchHash = createHash('sha256').update(readFileSync(inquiryPatchFile)).digest('hex')
if (actualAgentLoopPatchHash !== UPSTREAM.agentLoopPatchSha256) {
  fail(`inquiry patch hash mismatch\\n  expected ${UPSTREAM.agentLoopPatchSha256}\\n  actual   ${actualAgentLoopPatchHash}`)
}
const actualToolsPatchHash = createHash('sha256').update(readFileSync(toolsPatchFile)).digest('hex')
if (actualToolsPatchHash !== UPSTREAM.toolsPatchSha256) {
  fail(`tools patch hash mismatch\\n  expected ${UPSTREAM.toolsPatchSha256}\\n  actual   ${actualToolsPatchHash}`)
}
const actualManagedEffectsPatchHash = createHash('sha256').update(readFileSync(managedEffectsPatchFile)).digest('hex')
if (actualManagedEffectsPatchHash !== UPSTREAM.managedEffectsPatchSha256) {
  fail(`managed-effects patch hash mismatch\\n  expected ${UPSTREAM.managedEffectsPatchSha256}\\n  actual   ${actualManagedEffectsPatchHash}`)
}
const nativeToolsTemplate = JSON.parse(readFileSync(nativeToolsTemplateFile, 'utf8'))
if (nativeToolsTemplate.patchSha256 !== UPSTREAM.managedEffectsPatchSha256) fail('native tool template patch hash differs from the reviewed patch pin')
if (actualPatchHash !== UPSTREAM.patchSha256) {
  fail(
    `patch hash mismatch\n  expected ${UPSTREAM.patchSha256}\n  actual   ${actualPatchHash}\n`
    + 'Refusing to build: the recorded source change is not the one on disk.',
  )
}

/**
 * Whether the cached checkout actually contains the reviewed commit.
 *
 * A checkout left by an EARLIER reviewed commit was shallow-cloned at the old
 * tag, so the new commit is absent and unfetchable: `git checkout` then fails
 * with "reference is not a tree". That is precisely the upgrade path, so the
 * stale cache must be detected and replaced rather than aborting `dsh build`.
 */
function checkoutHasReviewedCommit() {
  if (!existsSync(join(checkout, '.git'))) return false
  try {
    capture('git', ['cat-file', '-e', `${UPSTREAM.commit}^{commit}`], checkout)
    return true
  } catch {
    return false
  }
}
if (!checkoutHasReviewedCommit()) {
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
// `git checkout -- .` restores tracked files only. Reuse ignored build output
// (node_modules, lib/) only when it was produced for exactly these inputs;
// otherwise remove every untracked and ignored file before building.
const combinedPatchHash = createHash('sha256').update(readFileSync(patchFile)).update(readFileSync(inquiryPatchFile)).update(readFileSync(toolsPatchFile)).update(readFileSync(managedEffectsPatchFile)).update(readFileSync(nativeToolsTemplateFile)).digest('hex')
const cache = prepareUpstreamCache({ checkout, commit: UPSTREAM.commit, patchSha256: combinedPatchHash, run })
console.log(`[compat/subagent] upstream cache ${cache.reused ? 'reused (same commit and patch)' : 'scrubbed (inputs changed or unknown)'}`)

try {
  run('git', ['apply', '--check', patchFile], checkout)
  run('git', ['apply', '--check', inquiryPatchFile], checkout)
  run('git', ['apply', '--check', toolsPatchFile], checkout)
  run('git', ['apply', '--check', managedEffectsPatchFile], checkout)
} catch {
  fail(
    'the recorded patch does not apply to the pinned upstream source.\n'
    + 'This means upstream moved: re-derive the patch (or drop this artifact if '
    + 'the capability has been published) instead of forcing it.',
  )
}
run('git', ['apply', patchFile], checkout)
run('git', ['apply', inquiryPatchFile], checkout)
run('git', ['apply', toolsPatchFile], checkout)
run('git', ['apply', managedEffectsPatchFile], checkout)

// The checkout is now PATCHED, and it stays patched for the whole build below
// (install, native build, tests, tsc, tsdown all read the patched source).
//
// It must not stay patched AFTERWARDS. This directory is also the only place a
// maintainer reads upstream when deciding whether a seam can be retired, and
// `README.md` requires citing upstream source as positive evidence for that
// decision. A checkout left dirty makes the patch read as upstream's own API:
// during the 2026-09-23 review three independent readers concluded that
// `settlementNotice` and `withLiveContinuableChildSession` were official
// capabilities, because the working tree says so while `git show HEAD:` does
// not. The most misleading artifact was the patch's own marker comment
// ("Literal proof that this runtime honors ...") — it reads like an upstream
// guarantee but exists only to let Pet self-check the patch.
//
// Registered as an exit hook rather than a trailing statement so that `fail()`
// and every thrown error restore it too; a build that dies midway is exactly
// when the tree would otherwise be left dirty.
process.on('exit', () => {
  try {
    run('git', ['checkout', '--', '.'], checkout)
  } catch {
    // Restoration is hygiene, not correctness: the artifact is already
    // published (or already failed). Report it without changing the exit code.
    console.warn(
      '[compat/subagent] WARNING: could not restore the upstream checkout.\n'
      + `  Run: git -C ${checkout} checkout -- .\n`
      + '  Until then, read upstream with `git grep <string> HEAD`, not the working tree.',
    )
  }
})

// Semantic gate BEFORE publishing: the reviewed proofs must pass on the
// patched target source. A build that only typechecks can still have lost the
// exact behaviors Pet depends on, so a failure here must stop publication.
console.log('[compat/subagent] proving reviewed seams on the patched source')
run('corepack', ['pnpm@11.7.0', 'install', '--prefer-offline'], checkout, { env: { CI: 'true' } })
run(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'native/system/scripts/build.ts', '--host-addon-only'], checkout)
run(process.execPath, [
  './node_modules/vitest/vitest.mjs', 'run',
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
const target = isolatedOutput ? join(outputRoot, 'subagent') : outputRoot
const loopTarget = isolatedOutput ? join(outputRoot, 'agent-loop') : join(here, 'agent-loop')
const toolsTarget = isolatedOutput ? join(outputRoot, 'tools') : join(here, 'tools')
mkdirSync(target, { recursive: true })
mkdirSync(loopTarget, { recursive: true })
mkdirSync(toolsTarget, { recursive: true })
rmSync(join(target, 'lib'), { recursive: true, force: true })
rmSync(join(loopTarget, 'lib'), { recursive: true, force: true })
rmSync(join(toolsTarget, 'lib'), { recursive: true, force: true })
cpSync(libSource, join(target, 'lib'), { recursive: true })
const loopBuilt = join(checkout, agentLoopPackageDir)
if (!existsSync(join(loopBuilt, 'lib'))) fail('upstream build produced no agent-loop lib directory')
cpSync(join(loopBuilt, 'lib'), join(loopTarget, 'lib'), { recursive: true })
const toolsBuilt = join(checkout, toolsPackageDir)
if (!existsSync(join(toolsBuilt, 'lib'))) fail('upstream build produced no tools lib directory')
cpSync(join(toolsBuilt, 'lib'), join(toolsTarget, 'lib'), { recursive: true })
for (const stale of ['lib/tsconfig.tsbuildinfo', 'lib/types/tsconfig.tsbuildinfo']) {
  rmSync(join(target, stale), { force: true })
}

const upstreamPkg = JSON.parse(readFileSync(join(built, 'package.json'), 'utf8'))
const trackedSkeleton = JSON.parse(readFileSync(join(here, 'package.template.json'), 'utf8'))
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
    reason: 'adds silent settlement, idle creation, independent-v1 continuable children with a caller-named preset, and exact continuation-owned child Session access for unified locus',
    upstreamTag: UPSTREAM.tag,
    upstreamBase: head,
    patchSha256: UPSTREAM.patchSha256,
    // Verifiable condition, not a promise with no due date: each seam names
    // what upstream would have to publish. Reported upstream so far:
    // settlementNotice only (discussions #7508). The other three have NOT been
    // reported, so nothing upstream is tracking them — do not read this field
    // as "expiring soon". Upstream accepts no external PRs; Discussions is the
    // only channel.
    removeWhen: 'upstream publishes all four: settlement suppression, idle continuable creation, independent (self-mounted) child composition, and continuation-owned child Session access; then delete compat/subagent and use the official package',
  },
}
// `sync.mjs` installs this directory by path and checks that its manifest
// declares the official package name, so the built manifest replaces the
// skeleton in the working tree. It is gitignored, which is why a build leaves
// no source diff behind.
writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const loopUpstreamPkg = JSON.parse(readFileSync(join(loopBuilt, 'package.json'), 'utf8'))
const loopTemplate = JSON.parse(readFileSync(agentLoopTemplateFile, 'utf8'))
const { devDependencies: _loopDev, publishConfig: _loopPublish, ...loopSourcePackage } = loopUpstreamPkg
const loopManifest = { ...loopSourcePackage, ...loopTemplate, version: loopTemplate.version, dependencies: loopUpstreamPkg.dependencies, peerDependencies: loopUpstreamPkg.peerDependencies, exports: loopUpstreamPkg.exports, scripts: loopTemplate.scripts, dsh_compat: {
  replaces: `@deepseek-ai/dsh-agent-loop@${loopUpstreamPkg.version}`,
  reason: 'isolates next-step inbox claims to Pet inquiry turns', upstreamTag: UPSTREAM.tag,
  upstreamBase: UPSTREAM.commit, patchSha256: UPSTREAM.agentLoopPatchSha256,
  removeWhen: 'upstream supports isolated queued-turn claim with equivalent next-step inbox isolation',
} }
writeFileSync(join(loopTarget, 'package.json'), `${JSON.stringify(loopManifest, null, 2)}\n`)
const toolsUpstreamPkg = JSON.parse(readFileSync(join(toolsBuilt, 'package.json'), 'utf8'))
const toolsTemplate = JSON.parse(readFileSync(toolsTemplateFile, 'utf8'))
const { devDependencies: _toolsDev, publishConfig: _toolsPublish, ...toolsSourcePackage } = toolsUpstreamPkg
const toolsManifest = {
  ...toolsSourcePackage,
  ...toolsTemplate,
  dependencies: toolsUpstreamPkg.dependencies,
  peerDependencies: toolsUpstreamPkg.peerDependencies,
  exports: toolsUpstreamPkg.exports,
  files: toolsUpstreamPkg.files,
  scripts: toolsUpstreamPkg.scripts,
  dsh_compat: { ...toolsTemplate.dsh_compat, upstreamBase: UPSTREAM.commit, patchSha256: UPSTREAM.toolsPatchSha256 },
}
writeFileSync(join(toolsTarget, 'package.json'), `${JSON.stringify(toolsManifest, null, 2)}\n`)
const nativeToolsRoot = join(outputRoot, 'native-tools')
mkdirSync(nativeToolsRoot, { recursive: true })
for (const spec of nativeToolsTemplate.packages) {
  const sourceDir = join(checkout, spec.sourceDir)
  const upstreamManifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'))
  if (upstreamManifest.name !== spec.name) fail(`native tool source ${spec.sourceDir} declares ${upstreamManifest.name}, expected ${spec.name}`)
  if (!existsSync(join(sourceDir, 'lib'))) fail(`native tool build produced no lib directory for ${spec.name}`)
  const targetDir = join(nativeToolsRoot, spec.sourceDir.split('/').at(-1))
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })
  cpSync(join(sourceDir, 'lib'), join(targetDir, 'lib'), { recursive: true })
  const { devDependencies: _nativeDev, publishConfig: _nativePublish, ...nativePackage } = upstreamManifest
  const scripts = { ...(nativePackage.scripts ?? {}) }
  delete scripts.postinstall
  const nativeDependencies = { ...(nativePackage.dependencies ?? {}) }
  const nativePeers = { ...(nativePackage.peerDependencies ?? {}) }
  for (const section of [nativeDependencies, nativePeers]) {
    for (const [name, range] of Object.entries(section)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue
      const candidate = join(checkout, 'packages', ...name.replace('@deepseek-ai/', '').split('/'))
      if (existsSync(join(candidate, 'package.json'))) {
        const depManifest = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'))
        section[name] = `^${depManifest.version}`
      }
    }
  }
  const nativeManifest = {
    ...nativePackage,
    version: nativeToolsTemplate.version,
    dependencies: nativeDependencies,
    peerDependencies: nativePeers,
    scripts,
    dsh_compat: {
      replaces: `${spec.name}@${upstreamManifest.version}`,
      reason: 'marks tool owners for managed effect classification',
      upstreamTag: UPSTREAM.tag,
      upstreamBase: UPSTREAM.commit,
      patchSha256: UPSTREAM.managedEffectsPatchSha256,
    },
  }
  writeFileSync(join(targetDir, 'package.json'), `${JSON.stringify(nativeManifest, null, 2)}\n`)
  if (!existsSync(join(targetDir, 'lib', 'index.js')) || !existsSync(join(targetDir, 'lib', 'types', 'index.d.ts'))) fail(`native tool artifact is missing runtime or declaration entry: ${spec.name}`)
}
if (!existsSync(join(loopTarget, 'lib', 'index.js'))) fail('agent-loop artifact has no runtime entry')
if (!existsSync(join(toolsTarget, 'lib', 'index.js'))) fail('tools artifact has no runtime entry')
for (const spec of nativeToolsTemplate.packages) {
  const nativeDir = join(nativeToolsRoot, spec.sourceDir.split('/').at(-1))
  const nativeManifest = JSON.parse(readFileSync(join(nativeDir, 'package.json'), 'utf8'))
  if (nativeManifest.name !== spec.name || nativeManifest.version !== nativeToolsTemplate.version || nativeManifest.dsh_compat?.patchSha256 !== UPSTREAM.managedEffectsPatchSha256 || nativeManifest.dsh_compat?.upstreamBase !== UPSTREAM.commit) fail(`native package provenance mismatch: ${spec.name}`)
  if (!existsSync(join(nativeDir, nativeManifest.main)) || !existsSync(join(nativeDir, nativeManifest.types))) fail(`native package runtime or type entry is missing: ${spec.name}`)
  const nativeRuntime = readFileSync(join(nativeDir, nativeManifest.main), 'utf8')
  if (!nativeRuntime.includes('dsh.tool.managed-effect')) fail(`native package omitted managed-effect owner marker: ${spec.name}`)
}
if (!join(toolsTarget, 'lib', 'index.js').startsWith(`${outputRoot}${sep}`)) fail('tools artifact escaped the selected output root')
const loopRuntime = readFileSync(join(loopTarget, 'lib', 'index.js'), 'utf8')
const toolsRuntime = readFileSync(join(toolsTarget, 'lib', 'index.js'), 'utf8')
if (!toolsRuntime.includes('const denialReason = this.guardReason(exec)')) fail('tools artifact omitted its final guard recheck')
if (!loopRuntime.includes('supportsIsolatedQueuedTurnClaim')) fail('agent-loop artifact omitted the isolated queued-turn capability marker')
if (!loopRuntime.includes('supportsIsolatedQueuedTurnClaim = true')) fail('agent-loop artifact omitted the enabled isolated-claim marker')
if (!isAbsolute(loopTarget) || !within(loopTarget, outputRoot)) fail('agent-loop artifact escaped the selected output root')
if (!isAbsolute(toolsTarget) || !within(toolsTarget, outputRoot)) fail('tools artifact escaped the selected output root')

if (isolatedOutput && !target.startsWith(`${outputRoot}/`)) fail('isolated Subagent artifact escaped the requested root')
if (isolatedOutput) console.log(`[compat/subagent] isolated artifacts written to ${outputRoot}`)

// Prove the capability is actually present, rather than trusting the build.
// Isolated package output is intentionally staged, not installed: its bare
// imports resolve only after the launcher assembles the dependency graph. Probe
// the exact built bytes from the patched upstream workspace instead, then
// verify the copied artifact bytes below remain identical.
const descriptor = await import(pathToFileURL(join(libSource, 'index.js')).href)
const sourceEntryBytes = readFileSync(join(libSource, 'index.js'))
const artifactEntryBytes = readFileSync(join(target, 'lib', 'index.js'))
if (!sourceEntryBytes.equals(artifactEntryBytes)) fail('copied Subagent entry differs from the built source that passed capability probes')
const runtimeSource = artifactEntryBytes.toString('utf8')
if (!/settlementNotice\s*===\s*["']silent["']/.test(runtimeSource)) {
  fail('built artifact has no silent-settlement guard; refusing to publish it')
}
if (
  !runtimeSource.includes('supportsSettlementNotice')
  || !runtimeSource.includes('supportsIndependentContinuableCreate')
  || !runtimeSource.includes('supportsIndependentChildAgentPreset')
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
// The access seam must resolve residency itself. The registry settles and
// disposes an idle child with an empty inbox, so a child is normally NOT
// resident when the next delivery arrives; an accessor that refused on that
// state made every post-idle read fail, which the host could only report (and
// only "recover" from) by retiring a healthy generation and building yet
// another child for the same group.
//
// The refusal is matched as the THROWN template literal, not as prose: the
// upstream source documents `undefined`-when-not-resident in its own comments,
// so a bare phrase match fails on a correct artifact.
if (
  /is not resident\x60/.test(runtimeSource)
  || !runtimeSource.includes('materializeForAccess')
) {
  fail('built artifact still requires prior residency for continuation-owned child Session access')
}
// Unlike the capabilities above, host-authored delivery is published as a
// SYMBOL-keyed method with no `supports*` companion flag, so the five marker
// checks above all pass without it. `adaptLocusInboxPort` looks up exactly
// `Symbol.for('dsh.subagent.deliverPrompt')` and returns undefined when it is
// missing, which Pet reports as `inbox-unavailable` — and that single gap
// cascades: `locusChildProbe.available` gates `idleChildProvisioning`, which
// gates `locusProvisioning`, `locusProvisioningController` and
// `locusControlDispatch`, so the whole unified Feishu channel goes
// unavailable. A patch hunk that stops applying cleanly here is therefore both
// high-impact and, without this check, invisible to the build.
if (
  !runtimeSource.includes('deliverSubagentPrompt')
  || !runtimeSource.includes('dsh.subagent.deliverPrompt')
) {
  fail('built artifact has no host-authored delivery seam; unified locus intake would be unavailable')
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
  || runtime.supportsIndependentChildAgentPreset !== true
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
// Stamp the cache only after every capability proof passed: an interrupted or
// failed build leaves no stamp, so the next run scrubs instead of trusting it.
recordUpstreamCache({ checkout, commit: UPSTREAM.commit, patchSha256: combinedPatchHash })
console.log(`[compat/subagent] ready: ${manifest.name}@${manifest.version}`)
