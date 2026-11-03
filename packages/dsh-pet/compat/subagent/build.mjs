#!/usr/bin/env node
/** Build only the retained model-display and team-membership source extensions.
 * The three-tier Locus uses official subagent, loop, tools and native owners.
 * Generated artifacts are not deployment state; the launcher verifies its graph.
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const requireHere = createRequire(import.meta.url)
const { runCompatCommand } = requireHere('./compat-run.cjs')
const { prepareUpstreamCache, recordUpstreamCache } = requireHere('./upstream-cache.cjs')
const modelDisplayPatchFile = join(here, 'model-display.patch')
const modelDisplayTemplateFile = join(here, 'model-display.package.template.json')
const modelDisplayTemplate = JSON.parse(readFileSync(modelDisplayTemplateFile, 'utf8'))
const teamMembershipPatchFile = join(here, 'team-membership.patch')
const teamMembershipTemplateFile = join(here, 'team-membership.package.template.json')
const teamMembershipTemplate = JSON.parse(readFileSync(teamMembershipTemplateFile, 'utf8'))

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
  /** Reviewed commit behind dsh-v0.2.0-rc.2; a moved tag/local checkout fails. */
  commit: '639ed015397290b3745d163aafe02ffee4aa3f84',
  /** SHA-256 pins for all reviewed patches; edited source changes fail closed. */
  modelDisplayPatchSha256: '7ac67eabf1bb717ce63aad9fb178c9b8a09294b390b133831a20e1613183426f',
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
const teamMembershipHash = createHash('sha256').update(readFileSync(teamMembershipPatchFile)).digest('hex')
if (teamMembershipHash !== '0f42cab5802bcc468ed05cdba5522abe9115cef858543d97c5300ef3d8f95bae' || teamMembershipTemplate.patchSha256 !== teamMembershipHash) fail('Team membership patch or template hash mismatch')
const actualModelDisplayHash = createHash('sha256').update(readFileSync(modelDisplayPatchFile)).digest('hex')
if (actualModelDisplayHash !== UPSTREAM.modelDisplayPatchSha256 || modelDisplayTemplate.patchSha256 !== actualModelDisplayHash) fail('model display patch or template hash mismatch')
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
const combinedPatchHash = createHash('sha256').update(readFileSync(modelDisplayPatchFile)).update(readFileSync(modelDisplayTemplateFile)).update(readFileSync(teamMembershipPatchFile)).update(readFileSync(teamMembershipTemplateFile)).digest('hex')
const cache = prepareUpstreamCache({ checkout, commit: UPSTREAM.commit, patchSha256: combinedPatchHash, run })
console.log(`[compat/subagent] upstream cache ${cache.reused ? 'reused (same commit and patch)' : 'scrubbed (inputs changed or unknown)'}`)

try {
  run('git', ['apply', '--check', modelDisplayPatchFile], checkout)
  run('git', ['apply', '--check', teamMembershipPatchFile], checkout)
} catch {
  fail(
    'the recorded patch does not apply to the pinned upstream source.\n'
    + 'This means upstream moved: re-derive the patch (or drop this artifact if '
    + 'the capability has been published) instead of forcing it.',
  )
}
run('git', ['apply', modelDisplayPatchFile], checkout)
run('git', ['apply', teamMembershipPatchFile], checkout)

// Keep the upstream cache readable as official source even after a failed build.
process.on('exit', () => {
  try {
    // Reversing also removes new helper files that tracked checkout cannot restore.
    run('git', ['apply', '--reverse', modelDisplayPatchFile], checkout)
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
run(process.execPath, ['./node_modules/vitest/vitest.mjs', 'run', 'packages/experimental/agent-team/tests/team.spec.ts', 'packages/experimental/tool-agent-team/tests', '--reporter=dot'], checkout, { env: { CI: 'true' } })
run(process.execPath, ['./node_modules/vitest/vitest.mjs', 'run', '--config', join(here, 'model-display.vitest.config.mjs'), '--reporter=dot'], checkout, { env: { CI: 'true', DSH_COMPAT_SUBAGENT_CHECKOUT: checkout } })
run(process.execPath, ['./node_modules/vitest/vitest.mjs', 'run', 'packages/llm/llm/tests/service.spec.ts', 'packages/api/session-controller/tests/session-models.host.spec.ts', 'packages/client/ui-model-selection/tests', 'packages/client/ui-commands/tests', '--reporter=dot'], checkout, { env: { CI: 'true' } })

console.log('[compat/subagent] building upstream host libraries')
run('corepack', ['pnpm@11.7.0', 'install', '--prefer-offline'], checkout, { env: { CI: 'true' } })
run(process.execPath, ['--max-old-space-size=4096', './node_modules/typescript/bin/tsc', '-b', 'tsconfig.host.json'], checkout)
run(process.execPath, ['./node_modules/tsdown/dist/run.mjs', '--env.DSH_BUILD_FACE', 'host'], checkout)

// Client presentation and generated Remote response codecs must ship together.
run(process.execPath, ['--max-old-space-size=4096', './node_modules/typescript/bin/tsc', '-b', ...modelDisplayTemplate.packages.filter(spec => spec.client).map(spec => spec.sourceDir + (spec.sourceDir.includes('/api/') ? '/tsconfig.client.json' : ''))], checkout)
for (const spec of modelDisplayTemplate.packages.filter(spec => spec.client)) {
  run(process.execPath, [join(checkout, 'node_modules/tsdown/dist/run.mjs'), '--env.DSH_BUILD_FACE', 'client'], join(checkout, spec.sourceDir))
}
const modelDisplayRoot = join(outputRoot, 'agent-artifacts', 'model-display-artifacts')
mkdirSync(modelDisplayRoot, { recursive: true })
for (const spec of [...modelDisplayTemplate.packages, ...teamMembershipTemplate.packages]) {
  const artifactTemplate = teamMembershipTemplate.packages.some(candidate => candidate.name === spec.name) ? teamMembershipTemplate : modelDisplayTemplate
  const sourceDir = join(checkout, spec.sourceDir)
  const upstreamManifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'))
  if (upstreamManifest.name !== spec.name) fail(`model display source identity mismatch: ${spec.name}`)
  const destination = join(modelDisplayRoot, spec.sourceDir.split('/').at(-1))
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(join(sourceDir, 'lib'), join(destination, 'lib'), { recursive: true })
  const { devDependencies: _modelDev, publishConfig: _modelPublish, ...pkg } = upstreamManifest
  const scripts = { ...(pkg.scripts ?? {}) }; delete scripts.postinstall
  const generated = { ...pkg, scripts, version: artifactTemplate.version, dsh_compat: {
    replaces: `${spec.name}@${upstreamManifest.version}`, upstreamTag: UPSTREAM.tag, upstreamBase: UPSTREAM.commit,
    patchSha256: artifactTemplate.patchSha256, reason: artifactTemplate === teamMembershipTemplate ? 'exclude provider-owned subagents before descriptor publication while preserving rostered teammates' : 'presentation-only model groups and actual-versus-next reasoning effort',
  } }
  writeFileSync(join(destination, 'package.json'), `${JSON.stringify(generated, null, 2)}\n`)
  for (const entry of [pkg.main, pkg.types, ...(spec.client ? ['lib/client.js'] : [])]) {
    if (!entry || !existsSync(join(destination, entry))) fail(`model display artifact missing entry: ${spec.name} ${entry}`)
  }
}
if (isolatedOutput) console.log(`[compat/subagent] isolated artifacts written to ${outputRoot}`)

// Stamp only successful inputs; interrupted builds must never reuse partial output.
recordUpstreamCache({ checkout, commit: UPSTREAM.commit, patchSha256: combinedPatchHash })
console.log(`[compat/subagent] ready: model-display ${modelDisplayTemplate.version}, team-membership ${teamMembershipTemplate.version}`)
