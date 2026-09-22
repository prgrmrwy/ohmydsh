const {
  existsSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const { createRequire } = require('node:module')
const { createHash, randomUUID } = require('node:crypto')
const { acquireCompatBuildLock } = require('./compat-build-lock.cjs')
const { runCompatCommand } = require('./compat-run.cjs')

const here = __dirname
const launcher = join(here, '.launcher')
const builds = join(here, '.launcher-builds')
const root = resolve(here, '../../../..')
const version = '0.1.5-rc.2'
const npmVersion = '11.19.0'
const reviewedCommit = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const subagentPatchSha256 = '0be3a0ca5996b6f6c804f1c0e8866542f3dad5d432a399d510ce3c82ab1ce77d'
/**
 * Published Subagent artifact version. `build.mjs` derives it from the tracked
 * skeleton as `skeleton + 1`, so this must follow the same rule instead of
 * hardcoding a suffix that silently drifts when the skeleton is bumped.
 */
const expectedSubagentVersion = (() => {
  const skeleton = readJson(join(here, 'package.template.json'))
  const build = Number(String(skeleton.version).split('.').pop() ?? 0) + 1
  return `${version}-locus-settlement-notice.${build}`
})()

function run(command, args, cwd, capture = false) {
  return runCompatCommand(command, args, cwd, { capture })
}

function runNpm(args, cwd, capture = false) {
  return run('corepack', [`npm@${npmVersion}`, ...args], cwd, capture)
}

function fail(message) {
  throw new Error(`[compat/subagent-launcher] ${message}`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function upstreamVersions() {
  const versions = new Map()
  function walk(directory) {
    for (const entry of require('node:fs').readdirSync(directory)) {
      if (entry === 'node_modules' || entry === '.git') continue
      const candidate = join(directory, entry)
      if (!require('node:fs').statSync(candidate).isDirectory()) continue
      const manifest = join(candidate, 'package.json')
      if (existsSync(manifest)) {
        const pkg = readJson(manifest)
        if (typeof pkg.name === 'string' && typeof pkg.version === 'string') versions.set(pkg.name, pkg.version)
      }
      walk(candidate)
    }
  }
  const checkout = join(here, '.upstream')
  walk(join(checkout, 'packages'))
  walk(join(checkout, 'vendor'))
  return versions
}

function materializeWorkspaceRanges(packageDir, versions) {
  const manifestFile = join(packageDir, 'package.json')
  const pkg = readJson(manifestFile)
  for (const section of ['dependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue
      const version = versions.get(name)
      if (version === undefined) fail(`cannot resolve reviewed upstream version for ${name}`)
      pkg[section][name] = `^${version}`
    }
  }
  writeFileSync(manifestFile, `${JSON.stringify(pkg, null, 2)}\n`)
}

function verifyLauncher(directory, fingerprint) {
  try {
    const stampFile = join(directory, '.fingerprint')
    const realBin = join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(stampFile) || !existsSync(realBin)) return undefined
    if (readFileSync(stampFile, 'utf8').trim() !== fingerprint) return undefined
    const requireFromLauncher = createRequire(join(directory, 'package.json'))
    const subagentPath = requireFromLauncher.resolve('@deepseek-ai/dsh-subagent/package.json')
    const subagent = readJson(subagentPath)
    if (
      subagent.version !== expectedSubagentVersion
      || subagent.dsh_compat?.patchSha256 !== subagentPatchSha256
      || subagent.dsh_compat?.upstreamBase !== reviewedCommit
    ) return undefined
    const runtimeSource = readFileSync(join(dirname(subagentPath), 'lib', 'index.js'), 'utf8')
    for (const marker of [
      'supportsSettlementNotice',
      'supportsIdleContinuableCreate',
      'supportsLiveContinuableChildSession',
      'supportsIndependentContinuableCreate',
      // Host-authored delivery has no `supports*` companion flag — it is
      // published only as a symbol-keyed method — so the four markers above
      // all pass without it. Pet looks the symbol up by exact string and
      // reports `inbox-unavailable` when absent, which then cascades through
      // `idleChildProvisioning` → `locusProvisioning` →
      // `locusProvisioningController` → `locusControlDispatch` and takes the
      // entire unified Feishu channel down. Verify both the method name and
      // the exact symbol string a consumer resolves.
      'deliverSubagentPrompt',
      'dsh.subagent.deliverPrompt',
    ]) {
      if (!runtimeSource.includes(marker)) return undefined
    }
    const installScripts = runNpm(['install-scripts', 'ls'], directory, true).trim()
    if (!/^No packages with unreviewed install scripts\.?$/.test(installScripts)) return undefined
    // Validate the exact published shape, not just npm's temporary absolute
    // file links before they are converted to self-contained relative links.
    runNpm(['ls', '--all', '--json'], directory, true)
    return realpathSync(realBin)
  } catch {
    // A moved checkout can leave valid-looking fingerprints beside broken
    // absolute file links. Treat any cache-probe failure as a rebuild request.
    return undefined
  }
}

const lock = acquireCompatBuildLock()
try {
  const dshYaml = readFileSync(join(root, 'dsh.yaml'), 'utf8')
  const pinned = dshYaml.match(/^dshVersion:\s*([^\s#]+)/m)?.[1]
  if (pinned !== version) {
    fail(`dsh.yaml pins ${String(pinned)}, but the patch targets ${version}; re-audit upstream first`)
  }

  const fingerprint = createHash('sha256')
    .update(version)
    .update(npmVersion)
    // Generated npm manifests contain absolute file: paths. Moving/cloning the
    // repository must invalidate the cache even when source bytes are equal.
    .update(realpathSync(here))
    .update(readFileSync(join(here, 'settlement-notice.patch')))
    .update(readFileSync(join(here, 'build.mjs')))
    .update(readFileSync(join(here, 'build-launcher.cjs')))
    .update(readFileSync(join(here, 'compat-build-lock.cjs')))
    .update(readFileSync(join(here, 'compat-run.cjs')))
    .update(readFileSync(join(here, 'package.template.json')))
    .digest('hex')

  const cachedBin = verifyLauncher(launcher, fingerprint)
  if (cachedBin !== undefined) {
    console.log(`[compat/subagent-launcher] up-to-date: ${cachedBin}`)
    process.exitCode = 0
  } else {
    // Materialize the reviewed packages under the same shared build lock.
    run(process.execPath, [join(here, 'build.mjs')], here)
    if (!existsSync(join(here, 'lib', 'index.js'))) fail('subagent build produced no runtime entry')

    // Staging must be a sibling of the compat source, not its child: the
    // launcher embeds a self-contained copy of that source and recursive copy
    // APIs correctly reject copying a directory into itself.
    const staging = join(dirname(here), `.dsh-pet-locus-launcher.staging-${process.pid}-${randomUUID()}`)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    try {
      const compatPackages = join(staging, 'compat-packages')
      mkdirSync(compatPackages, { recursive: true })
      const stagedSubagent = join(compatPackages, 'subagent')
      mkdirSync(stagedSubagent, { recursive: true })
      cpSync(join(here, 'lib'), join(stagedSubagent, 'lib'), { recursive: true })
      cpSync(join(here, 'package.json'), join(stagedSubagent, 'package.json'))
      const versions = upstreamVersions()
      materializeWorkspaceRanges(stagedSubagent, versions)
      // The framework versions the reviewed upstream tree is itself built on.
      // Read from that tree rather than pasted, for the same reason the patch
      // hashes are derived rather than hardcoded: a constant silently rots the
      // moment the reviewed DSH pin moves, and then pins the WRONG runtime.
      //
      // Declared because several official packages depend on cordis EXACTLY
      // (`dsh-app-boot`, `dsh-agent-presets` and `dsh-session` all say `4.0.2`,
      // not `^4.0.2`) while others allow a range. npm may satisfy the ranges
      // with a newer release first and only then meet the exact requirement,
      // leaving the tree `invalid` and the launcher unpublishable. Until now it
      // happened to resolve correctly only as a side effect of the storage
      // `file:` overrides being expanded first — an accident, not a constraint.
      // Stating it makes the launcher's framework version a reviewed fact.
      const frameworkPins = Object.fromEntries(
        ['@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-include'].map((pkg) => {
          const pinned = versions.get(pkg)
          if (pinned === undefined) fail(`cannot resolve reviewed upstream version for ${pkg}`)
          return [pkg, pinned]
        }),
      )
      writeFileSync(join(staging, 'package.json'), `${JSON.stringify({
        name: 'dsh-pet-locus-launcher',
        private: true,
        description: 'Generated isolated DSH Host runtime with reviewed Pet Locus compatibility overrides.',
        dependencies: {
          '@deepseek-ai/dsh': version,
        },
        // npm currently fails to resolve relative file: overrides here. Install
        // from staging-absolute paths, then replace npm's links with real
        // package copies before publish so the final launcher is self-contained.
        overrides: {
          '@deepseek-ai/dsh-subagent': `file:${join(compatPackages, 'subagent')}`,
          ...frameworkPins,
        },
      }, null, 2)}\n`)

      console.log('[compat/subagent-launcher] installing isolated DSH Host dependency root')
      runNpm(['install'], staging)
      runNpm(['install-scripts', 'approve', '--all', '--allow-scripts-pin'], staging)
      // Prove npm resolved one reviewed override tree while its file links still
      // match the install metadata. The links are converted to real copies next.
      runNpm(['ls', '@deepseek-ai/dsh-subagent'], staging)
      const packageCopies = new Map([
        ['@deepseek-ai/dsh-subagent', 'subagent'],
      ])
      for (const [name, localName] of packageCopies) {
        const installed = join(staging, 'node_modules', ...name.split('/'))
        rmSync(installed, { recursive: true, force: true })
        // Keep npm's link semantics, but make the target relative to this
        // immutable generation so the finished tree is self-contained.
        symlinkSync(join('..', '..', 'compat-packages', localName), installed, 'dir')
      }
      const finalManifest = readJson(join(staging, 'package.json'))
      for (const [name, localName] of packageCopies) {
        finalManifest.overrides[name] = `file:./compat-packages/${localName}`
      }
      writeFileSync(join(staging, 'package.json'), `${JSON.stringify(finalManifest, null, 2)}\n`)
      const generation = `${fingerprint}-${randomUUID()}`
      const futureBuildDir = join(builds, generation)
      const lockFile = join(staging, 'package-lock.json')
      writeFileSync(lockFile, readFileSync(lockFile, 'utf8').split(staging).join(futureBuildDir))
      writeFileSync(join(staging, '.fingerprint'), `${fingerprint}\n`)
      const stagedBin = verifyLauncher(staging, fingerprint)
      if (stagedBin === undefined) fail('staged launcher failed capability, provenance, or dependency verification')
      const reported = run(process.execPath, [stagedBin, '--version'], staging, true).trim()
      if (reported !== version) fail(`isolated DSH reports ${reported}, expected ${version}`)

      mkdirSync(builds, { recursive: true })
      const buildDir = futureBuildDir
      renameSync(staging, buildDir)

      const nextLink = join(here, `.launcher.next-${process.pid}-${randomUUID()}`)
      const previousEntity = join(here, `.launcher.previous-${process.pid}-${randomUUID()}`)
      symlinkSync(join('.launcher-builds', generation), nextLink, 'dir')
      let movedLegacyDirectory = false
      let previousLinkTarget
      try {
        // Existing declarative installs are symlinks and need no removal window:
        // POSIX rename atomically replaces the old pointer. One-time migration
        // from the historical real directory must move it aside first because
        // rename cannot replace a non-empty directory with a symlink.
        if (existsSync(launcher) && lstatSync(launcher).isSymbolicLink()) {
          previousLinkTarget = readlinkSync(launcher)
        } else if (existsSync(launcher)) {
          renameSync(launcher, previousEntity)
          movedLegacyDirectory = true
        }
        renameSync(nextLink, launcher)
        const publishedBin = verifyLauncher(launcher, fingerprint)
        if (publishedBin === undefined) fail('published launcher pointer failed post-rename verification')
        rmSync(previousEntity, { recursive: true, force: true })
        // Keep the active and immediately previous immutable build for rollback;
        // stale older builds are safe to remove only after the new pointer works.
        const activeTarget = realpathSync(launcher)
        const candidates = readdirSync(builds).map(name => join(builds, name))
          .filter(candidate => candidate !== activeTarget)
          .sort((a, b) => lstatSync(b).mtimeMs - lstatSync(a).mtimeMs)
        for (const stale of candidates.slice(1)) rmSync(stale, { recursive: true, force: true })
        console.log(`[compat/subagent-launcher] ready: ${publishedBin}`)
      } catch (error) {
        rmSync(nextLink, { force: true })
        if (previousLinkTarget !== undefined) {
          const restoreLink = join(here, `.launcher.restore-${process.pid}-${randomUUID()}`)
          symlinkSync(previousLinkTarget, restoreLink, 'dir')
          renameSync(restoreLink, launcher)
        } else if (movedLegacyDirectory) {
          rmSync(launcher, { force: true })
          if (existsSync(previousEntity)) renameSync(previousEntity, launcher)
        }
        throw error
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
      // A failure before publish never removes the existing launcher. A backup
      // left after an abrupt post-publish exit is inert and safe to inspect.
    }
  }
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
} finally {
  lock.release()
}
