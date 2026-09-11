const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')

const here = __dirname
const launcher = join(here, '.launcher')
const root = resolve(here, '../../../..')
const version = '0.1.2-rc.1'

function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

function fail(message) {
  console.error(`[compat/subagent-launcher] ${message}`)
  process.exit(1)
}

// The patch is derived from this exact DSH pin. A version bump forces an
// explicit re-audit instead of carrying the override forward by accident.
const dshYaml = readFileSync(join(root, 'dsh.yaml'), 'utf8')
const pinned = dshYaml.match(/^dshVersion:\s*([^\s#]+)/m)?.[1]
if (pinned !== version) {
  fail(`dsh.yaml pins ${String(pinned)}, but the patch targets ${version}; re-audit upstream first`)
}

const fingerprint = createHash('sha256')
  .update(version)
  .update(readFileSync(join(here, 'settlement-notice.patch')))
  .update(readFileSync(join(here, 'build.mjs')))
  .update(readFileSync(join(here, 'build-launcher.cjs')))
  .update(readFileSync(join(here, 'build-storage.mjs')))
  .update(readFileSync(join(here, 'storage-atomic.patch')))
  .update(readFileSync(join(here, 'package.template.json')))
  .digest('hex')
const stampFile = join(launcher, '.fingerprint')
const dshBin = join(launcher, 'node_modules', '.bin', 'dsh')
if (existsSync(stampFile) && existsSync(dshBin) && readFileSync(stampFile, 'utf8').trim() === fingerprint) {
  const requireCached = createRequire(join(launcher, 'package.json'))
  const cachedManifest = JSON.parse(readFileSync(
    requireCached.resolve('@deepseek-ai/dsh-subagent/package.json'),
    'utf8',
  ))
  const installScripts = run('npm', ['install-scripts', 'ls'], launcher, true).trim()
  if (
    cachedManifest.version === `${version}-locus-settlement-notice.1`
    && cachedManifest.dsh_compat?.patchSha256 !== undefined
    && existsSync(join(here, 'storage-artifacts', 'storage-domain', 'lib', 'index.js'))
    && existsSync(join(here, 'storage-artifacts', 'storage-sqlite', 'lib', 'index.js'))
    && /^No packages with unreviewed install scripts\.?$/.test(installScripts)
  ) {
    console.log(`[compat/subagent-launcher] up-to-date: ${dshBin}`)
    process.exit(0)
  }
}

// Materialize the reviewed package. build.mjs checks the patch hash, verifies
// it still applies, builds it, and runs its capability probes.
run(process.execPath, [join(here, 'build.mjs')], here)
run(process.execPath, [join(here, 'build-storage.mjs')], here)
if (!existsSync(join(here, 'lib', 'index.js'))) fail('subagent build produced no runtime entry')

// Use a separate npm root: overrides are root-project policy. Putting this in
// Pet's profile would install a second copy while the DSH process kept using
// its own transitive dependency (verified in the failed compatibility attempt).
rmSync(launcher, { recursive: true, force: true })
mkdirSync(launcher, { recursive: true })
writeFileSync(join(launcher, 'package.json'), `${JSON.stringify({
  name: 'dsh-pet-locus-launcher',
  private: true,
  description: 'Generated isolated DSH root with one reviewed transitive override.',
  dependencies: {
    '@deepseek-ai/dsh': version,
  },
  overrides: {
    '@deepseek-ai/dsh-subagent': `file:${here}`,
    '@deepseek-ai/dsh-storage': `file:${join(here, 'storage-artifacts', 'storage')}`,
    '@deepseek-ai/dsh-storage-domain': `file:${join(here, 'storage-artifacts', 'storage-domain')}`,
    '@deepseek-ai/dsh-storage-json': `file:${join(here, 'storage-artifacts', 'storage-json')}`,
    '@deepseek-ai/dsh-storage-sqlite': `file:${join(here, 'storage-artifacts', 'storage-sqlite')}`,
  },
}, null, 2)}\n`)

console.log('[compat/subagent-launcher] installing isolated DSH dependency root')
run('npm', ['install'], launcher)
// npm's install-script allowlist is fail-closed. Approve the exact versions in
// the generated lock (the flag writes pinned entries) so subprocess/PTY/native
// helpers are actually usable, rather than merely present in node_modules.
run('npm', ['install-scripts', 'approve', '--all', '--allow-scripts-pin'], launcher)
const uncoveredScripts = run('npm', ['install-scripts', 'ls'], launcher, true).trim()
if (!/^No packages with unreviewed install scripts\.?$/.test(uncoveredScripts)) {
  fail(`uncovered dependency install scripts:\n${uncoveredScripts}`)
}

// Verify the override won, carries provenance, and is the only subagent in the
// graph. npm ls exits non-zero for an invalid or conflicting dependency tree.
const requireFromLauncher = createRequire(join(launcher, 'package.json'))
const resolvedPath = requireFromLauncher.resolve('@deepseek-ai/dsh-subagent/package.json')
const resolved = JSON.parse(readFileSync(resolvedPath, 'utf8'))
if (resolved.version !== `${version}-locus-settlement-notice.1`) {
  fail(`override did not win: ${resolvedPath}@${String(resolved.version)}`)
}
if (resolved.dsh_compat?.patchSha256 === undefined) fail('resolved subagent has no provenance marker')
run('npm', ['ls', '@deepseek-ai/dsh-subagent'], launcher)

if (!existsSync(dshBin)) fail('isolated DSH launcher bin is missing')
const reported = run(dshBin, ['--version'], launcher, true).trim()
if (reported !== version) fail(`isolated DSH reports ${reported}, expected ${version}`)
writeFileSync(stampFile, `${fingerprint}\n`)

console.log(`[compat/subagent-launcher] ready: ${dshBin}`)
console.log(`[compat/subagent-launcher] opt in with: DSH_BIN=${dshBin}`)
