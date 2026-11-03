const {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const { dirname, isAbsolute, join, resolve, sep } = require('node:path')
const { createRequire } = require('node:module')
const { createHash, randomUUID } = require('node:crypto')
const { acquireCompatBuildLock } = require('./compat-build-lock.cjs')
const { runCompatCommand } = require('./compat-run.cjs')
const { validateScriptPolicy, scriptPolicyEnv, assertScriptPolicy, SCRIPT_FLAGS } = require('./compat-script-policy.cjs')
const { publishLauncher, assertPublicationState } = require('./compat-publish.cjs')
const scriptPolicy = validateScriptPolicy(require('./install-script-policy.json'))

const here = __dirname
const isolatedArgs = process.argv.slice(2)
let isolatedOutput
if (isolatedArgs.length !== 0) {
  if (isolatedArgs.length !== 2 || isolatedArgs[0] !== '--isolated-output' || !isAbsolute(isolatedArgs[1])) {
    console.error('[compat/subagent-launcher] usage: build-launcher.cjs [--isolated-output /absolute/new-or-empty-directory]')
    process.exit(2)
  }
  isolatedOutput = resolve(isolatedArgs[1])
  const inside = (child, parent) => child === parent || child.startsWith(`${parent}${sep}`)
  if (inside(isolatedOutput, resolve(here)) || inside(isolatedOutput, resolve(join(here, '.upstream'))) || (existsSync(isolatedOutput) && readdirSync(isolatedOutput).length > 0)) {
    console.error('[compat/subagent-launcher] isolated output must be a new or empty directory outside compat sources')
    process.exit(2)
  }
}
const launcher = join(here, '.launcher')
const builds = join(here, '.launcher-builds')
const root = resolve(here, '../../../..')
const version = '0.2.0-rc.2'
const npmVersion = '11.19.0'
const reviewedCommit = '639ed015397290b3745d163aafe02ffee4aa3f84'
const modelDisplayPatchSha256 = '7ac67eabf1bb717ce63aad9fb178c9b8a09294b390b133831a20e1613183426f'
const modelDisplayTemplate = readJson(join(here, 'model-display.package.template.json'))
const teamMembershipTemplate = readJson(join(here, 'team-membership.package.template.json'))
function run(command, args, cwd, capture = false) {
  return runCompatCommand(command, args, cwd, { capture })
}

function runNpm(args, cwd, capture = false) {
  return runCompatCommand('corepack', [`npm@${npmVersion}`, ...args, ...SCRIPT_FLAGS], cwd, { capture, env: scriptPolicyEnv(process.env), replaceEnv: true })
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
  const checkout = process.env.DSH_COMPAT_SUBAGENT_CHECKOUT ?? join(here, '.upstream')
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
    assertScriptPolicy(readJson(join(directory, 'package.json')), scriptPolicy)
    const stampFile = join(directory, '.fingerprint')
    const realBin = join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(stampFile) || !existsSync(realBin)) return undefined
    if (readFileSync(stampFile, 'utf8').trim() !== fingerprint) return undefined
    const requireFromLauncher = createRequire(join(directory, 'package.json'))
    for (const spec of [...modelDisplayTemplate.packages, ...teamMembershipTemplate.packages]) {
      const manifest = requireFromLauncher.resolve(`${spec.name}/package.json`)
      const pkg = readJson(manifest)
      const template = teamMembershipTemplate.packages.some(candidate => candidate.name === spec.name) ? teamMembershipTemplate : modelDisplayTemplate
      if (pkg.version !== template.version || pkg.dsh_compat?.patchSha256 !== template.patchSha256 || pkg.dsh_compat?.upstreamBase !== reviewedCommit) return undefined
      if (spec.client && !existsSync(join(dirname(manifest), 'lib/client.js'))) return undefined
    }
    run(process.execPath, [join(here, 'verify-model-display.mjs'), '--graph', directory], here)
    run(process.execPath, [join(here, 'verify-official-runtime.mjs'), '--graph', directory], here)
    const installScripts = runNpm(['install-scripts', 'ls'], directory, true).trim()
    if (!/^No packages with unreviewed install scripts\.?$/.test(installScripts)) return undefined
    // Validate the exact published shape, not just npm's temporary absolute
    // file links before they are converted to self-contained relative links.
    runNpm(['ls', '--all', '--json'], directory, true)
    return realpathSync(realBin)
  } catch (error) {
    // Keep cache misses rebuildable, but expose the failed verification step
    // so a cache probe cannot hide its actual root cause.
    console.error(`Launcher cache verification failed: ${error?.message ?? String(error)}`)
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
    .update(readFileSync(join(here, 'team-membership.patch')))
    .update(readFileSync(join(here, 'team-membership.package.template.json')))
    .update(readFileSync(join(here, 'model-display.patch')))
    .update(readFileSync(join(here, 'model-display.package.template.json')))
    .update(readFileSync(join(here, 'model-display.vitest.config.mjs')))
    .update(readFileSync(join(here, 'verify-model-display.mjs')))
    .update(readFileSync(join(here, 'verify-official-runtime.mjs')))
    .update(readFileSync(join(here, '../../test/model-display-host.spec.ts')))
    .update(readFileSync(join(here, '../../test/model-display-react.spec.tsx')))
    .update(readFileSync(join(here, '../../test/model-display-routing.spec.ts')))
    .update(readFileSync(join(here, '../../test/model-display-popup.spec.ts')))
    .update(readFileSync(join(here, '../../test/model-display-builder.test.cjs')))
    .update(readFileSync(join(here, 'build.mjs')))
    .update(readFileSync(join(here, 'build-launcher.cjs')))
    .update(readFileSync(join(here, 'compat-build-lock.cjs')))
    .update(readFileSync(join(here, 'compat-run.cjs')))
    .update(readFileSync(join(here, 'compat-script-policy.cjs')))
    .update(readFileSync(join(here, 'install-script-policy.json')))
    .update(readFileSync(join(here, 'compat-publish.cjs')))
    .update(readFileSync(join(here, 'test-packaging.cjs')))
    .update(readFileSync(join(here, 'README.zh.md')))
    .update(readFileSync(join(here, 'README.md')))
    .digest('hex')

  if (!isolatedOutput) assertPublicationState(launcher)
  const cachedBin = isolatedOutput ? undefined : verifyLauncher(launcher, fingerprint)
  if (cachedBin !== undefined) {
    console.log(`[compat/subagent-launcher] up-to-date: ${cachedBin}`)
    process.exitCode = 0
  } else {
    // Materialize packages under the shared lock. Isolated mode directs every
    // generated package into its caller-owned output root and never publishes.
    const artifactRoot = isolatedOutput ?? here
    mkdirSync(artifactRoot, { recursive: true })
    if (isolatedOutput && readdirSync(artifactRoot).length > 0) fail('isolated output must remain empty before artifact generation')
    run(process.execPath, [join(here, 'build.mjs'), ...(isolatedOutput ? ['--isolated-output', artifactRoot] : [])], here)
    // Staging must be a sibling of the compat source, not its child: the
    // launcher embeds a self-contained copy of that source and recursive copy
    // APIs correctly reject copying a directory into itself.
    const staging = isolatedOutput
      ? join(artifactRoot, `.launcher-staging-${process.pid}-${randomUUID()}`)
      : join(dirname(here), `.dsh-pet-locus-launcher.staging-${process.pid}-${randomUUID()}`)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    try {
      const compatPackages = join(staging, 'compat-packages')
      mkdirSync(compatPackages, { recursive: true })
      const modelDisplayPackages = new Map()
      for (const spec of [...modelDisplayTemplate.packages, ...teamMembershipTemplate.packages]) {
        const localName = spec.sourceDir.split('/').at(-1)
        const source = join(artifactRoot, 'agent-artifacts', 'model-display-artifacts', localName)
        const destination = join(compatPackages, localName)
        cpSync(source, destination, { recursive: true })
        modelDisplayPackages.set(spec.name, localName)
      }
      const versions = upstreamVersions()
      for (const localName of modelDisplayPackages.values()) materializeWorkspaceRanges(join(compatPackages, localName), versions)
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
      const modelDisplayDependencies = Object.fromEntries(
        [...modelDisplayPackages].map(([name, localName]) => [name, `file:${join(compatPackages, localName)}`]),
      )
      const frameworkPins = Object.fromEntries(
        ['@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-include'].map((pkg) => {
          const pinned = versions.get(pkg)
          if (pinned === undefined) fail(`cannot resolve reviewed upstream version for ${pkg}`)
          return [pkg, pinned]
        }),
      )
      // Reviewed deviation from `@deepseek-ai/dsh-http-proxy`'s declared
      // `undici: ^8.10.0` (and `dsh-web-fetch-http`'s identical range).
      //
      // That package builds the process-wide dispatcher out of ITS OWN undici
      // dependency and installs it with `setGlobalDispatcher`, which is the
      // dispatcher Node's built-in `fetch` then routes through. Its declared
      // range resolves to undici 8.x, whose dispatcher this runtime's built-in
      // fetch cannot consume: undici 6.28.0 on Node 22.23 and 7.8.0 on Node
      // 24.1 both come back with ZERO response headers and a body still
      // compressed, so every `response.json()` on a proxied response fails
      // (subscriptions usage and model catalogs, cost-meter price refresh, geo
      // guard). SSE streaming is never compressed, which is why chat keeps
      // working while every JSON reading call fails — the failure looks like a
      // network error and is not.
      //
      // Measured 2026-09-25 against the same relay, one endpoint:
      // built-in fetch + undici 6.28.1 dispatcher → 19 headers, valid JSON;
      // built-in fetch + undici 7.30.0 dispatcher → 19 headers, valid JSON;
      // built-in fetch + undici 8.11.0 dispatcher → 0 headers, raw brotli.
      // Raising Node does not help (Node 24 + undici 8 fails identically), and
      // letting Node's `NODE_USE_ENV_PROXY` take over instead BREAKS the two
      // packages that fetch through the npm undici 8 they declare.
      //
      // 7.30.0 is therefore the smallest deviation from ^8.10.0 that works on
      // both Node 22 and Node 24. Only these two official packages declare
      // `undici`, and both use only `Agent` / `Pool` / `ProxyAgent` / `fetch`.
      // npm still reports the tree valid (`npm ls --all` → no `problems`).
      // Retire this pin once DSH ships a dispatcher built from the runtime's own
      // undici generation, or drops the install for Node's native env proxy.
      const UNDICI_COMPAT_PIN = '7.30.0'
      writeFileSync(join(staging, 'package.json'), `${JSON.stringify({
        name: 'dsh-pet-locus-launcher',
        private: true,
        allowScripts: scriptPolicy,
        description: 'Generated isolated DSH Host runtime with reviewed Pet Locus compatibility overrides.',
        dependencies: {
          '@deepseek-ai/dsh': version,
          ...modelDisplayDependencies,
        },
        // npm currently fails to resolve relative file: overrides here. Install
        // from staging-absolute paths, then replace npm's links with real
        // package copies before publish so the final launcher is self-contained.
        overrides: {
          ...modelDisplayDependencies,
          ...frameworkPins,
          undici: UNDICI_COMPAT_PIN,
        },
      }, null, 2)}\n`)

      console.log('[compat/subagent-launcher] installing isolated DSH Host dependency root')
      runNpm(['install'], staging)
      // Prove npm resolved one reviewed override tree while its file links still
      // match the install metadata. The links are converted to real copies next.
      runNpm(['ls', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-tools'], staging)
      const packageCopies = modelDisplayPackages
      for (const [name, localName] of packageCopies) {
        const installed = join(staging, 'node_modules', ...name.split('/'))
        rmSync(installed, { recursive: true, force: true })
        // Keep npm's link semantics, but make the target relative to this
        // immutable generation so the finished tree is self-contained.
        symlinkSync(join('..', '..', 'compat-packages', localName), installed, 'dir')
      }
      const finalManifest = readJson(join(staging, 'package.json'))
      for (const [name, localName] of packageCopies) {
        const finalFileSpec = `file:./compat-packages/${localName}`
        finalManifest.dependencies[name] = finalFileSpec
        finalManifest.overrides[name] = finalFileSpec
      }
      writeFileSync(join(staging, 'package.json'), `${JSON.stringify(finalManifest, null, 2)}\n`)
      const generation = `${fingerprint}-${randomUUID()}`
      const futureBuildDir = isolatedOutput
        ? join(artifactRoot, 'launcher')
        : join(builds, generation)
      const lockFile = join(staging, 'package-lock.json')
      writeFileSync(lockFile, readFileSync(lockFile, 'utf8').split(staging).join(futureBuildDir))
      writeFileSync(join(staging, '.fingerprint'), `${fingerprint}\n`)
      const stagedBin = verifyLauncher(staging, fingerprint)
      if (stagedBin === undefined) fail('staged launcher failed capability, provenance, or dependency verification')
      const reported = run(process.execPath, [stagedBin, '--version'], staging, true).trim()
      if (reported !== version) fail(`isolated DSH reports ${reported}, expected ${version}`)

      if (isolatedOutput) {
        const publishedLauncher = join(artifactRoot, 'launcher')
        renameSync(staging, publishedLauncher)
        const publishedBin = verifyLauncher(publishedLauncher, fingerprint)
        if (publishedBin === undefined) fail('published isolated launcher failed post-rename capability, provenance, or dependency verification')
        console.log(`[compat/subagent-launcher] isolated dependency graph written to ${publishedLauncher}`)
      } else {
      mkdirSync(builds, { recursive: true })
      const buildDir = futureBuildDir
      renameSync(staging, buildDir)

      const publishedBin = publishLauncher({ launcher, target: buildDir, verify: () => verifyLauncher(launcher, fingerprint) })
      // Generations may still be used by live Hosts or prepared callers; no GC without leases.
      console.log(`[compat/subagent-launcher] ready: ${publishedBin}`)
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
