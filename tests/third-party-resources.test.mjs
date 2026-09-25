import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  SPEC_SUPERFLOW_SKILLS,
  packagePins,
  preflightResourceIntegrities,
  renderMcpLauncher,
  renderResourcePatch,
  resourceHealth,
  resourcePackageItems,
  selectedTreeHash,
  syncManagedLaunchers,
  syncSchemaResources,
  validateTarListing,
  validateThirdPartyResources,
} from '../scripts/lib/third-party-resources.mjs'

const I = 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
const workflow = {
  id: 'spec-superflow',
  type: 'npm-workflow',
  enabled: true,
  spec: 'spec-superflow@2.0.1',
  version: '2.0.1',
  integrity: I,
  provider: { spec: '@deepseek-ai/dsh-skill-filesystem@0.1.5-rc.2', version: '0.1.5-rc.2', integrity: I },
  providerName: 'spec-superflow-upstream',
  skills: [...SPEC_SUPERFLOW_SKILLS],
}
const mcp = {
  id: 'jev',
  type: 'npm-mcp-server',
  enabled: true,
  spec: '@jkudish/jev-mcp@0.6.0',
  version: '0.6.0',
  integrity: I,
  bridge: { spec: '@deepseek-ai/dsh-mcp-client@0.1.5-rc.2', version: '0.1.5-rc.2', integrity: I },
  serverName: 'jev',
  credentialEnv: 'TYPESAFE_API_KEY',
  toolCallTimeoutMs: 15000,
  reconnect: { enabled: true, initialDelayMs: 250, maxDelayMs: 2000, maxAttempts: 3 },
}
const schema = {
  id: 'anvil',
  type: 'openspec-schema',
  enabled: true,
  archiveUrl: 'https://example.invalid/repo/tar.gz/73eea60c622712a5d952ec1aec62da4e349f8c33',
  commit: '73eea60c622712a5d952ec1aec62da4e349f8c33',
  archiveSha256: 'a'.repeat(64),
  treeSha256: 'b'.repeat(64),
  sourcePath: 'schemas/anvil',
  target: 'anvil',
  scope: 'user',
}

function validated(...resources) {
  return validateThirdPartyResources(resources)
}

async function packageFixture(profile, name, version, files = []) {
  const dir = path.join(profile, 'node_modules', ...name.split('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }))
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await writeFile(path.join(dir, file), `fixture ${file}\n`)
  }
}

async function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('validates all resource shape before a caller side effect and rejects floating, URL, and unknown pins', () => {
  let sideEffects = 0
  const invalid = { ...workflow, unexpected: true }
  assert.throws(() => {
    validateThirdPartyResources([invalid])
    sideEffects++
  }, /unknown field unexpected/)
  assert.equal(sideEffects, 0)
  for (const spec of ['spec-superflow@latest', 'spec-superflow@^2.0.0', 'https://example.invalid/x.tgz']) {
    assert.throws(() => validateThirdPartyResources([{ ...workflow, spec }]), /exact registry npm spec/)
  }
  assert.throws(() => validateThirdPartyResources([{ ...schema, sourcePath: '../escape' }]), /must not escape/)
  assert.throws(() => validateThirdPartyResources([{ ...schema, target: '../escape' }]), /safe schema name/)
  assert.throws(() => validateThirdPartyResources([{ ...schema, scope: 'parent' }]), /must be user or project/)
})

test('translates enabled workflow and MCP packages to unique synthetic remote package pins', () => {
  const resources = validated(workflow, mcp)
  const items = resourcePackageItems(resources)
  assert.deepEqual(items.map(({ id, spec, enabled }) => ({ id, spec, enabled })), [
    { id: 'third-party-spec-superflow-runtime', spec: 'spec-superflow@2.0.1', enabled: true },
    { id: 'third-party-spec-superflow-provider', spec: '@deepseek-ai/dsh-skill-filesystem@0.1.5-rc.2', enabled: true },
    { id: 'third-party-jev-runtime', spec: '@jkudish/jev-mcp@0.6.0', enabled: true },
    { id: 'third-party-jev-bridge', spec: '@deepseek-ai/dsh-mcp-client@0.1.5-rc.2', enabled: true },
  ])
  assert.equal(new Set(items.map((item) => item.id)).size, items.length)
})

test('preflights enabled exact npm integrities once and rejects mismatch before activation', async () => {
  const resources = validated(workflow, { ...mcp, enabled: false })
  const seen = []
  await preflightResourceIntegrities(resources, { resolver: async (pin) => { seen.push(pin.spec); return pin.integrity } })
  assert.deepEqual(seen, ['spec-superflow@2.0.1', '@deepseek-ai/dsh-skill-filesystem@0.1.5-rc.2'])
  await assert.rejects(
    preflightResourceIntegrities(validated(workflow), { resolver: async () => 'sha512-wrong' }),
    /integrity mismatch/,
  )
  assert.equal(packagePins(validated({ ...workflow, enabled: false })).length, 0)
})

test('renders generated rows only for healthy installed identities and exact upstream skill/runtime files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'third-party-health-'))
  const profile = path.join(root, 'profile')
  const assets = path.join(root, 'assets')
  const resources = validated(workflow, mcp)
  await packageFixture(profile, 'spec-superflow', '2.0.1', [
    'scripts/spec-superflow.mjs',
    ...SPEC_SUPERFLOW_SKILLS.map((name) => `skills/${name}/SKILL.md`),
  ])
  await packageFixture(profile, '@deepseek-ai/dsh-skill-filesystem', '0.1.5-rc.2')
  await packageFixture(profile, '@jkudish/jev-mcp', '0.6.0', ['dist/index.js'])
  await packageFixture(profile, '@deepseek-ai/dsh-mcp-client', '0.1.5-rc.2')
  await mkdir(assets, { recursive: true })
  await writeFile(path.join(assets, 'jev-launcher.mjs'), '// generated\n')

  const health = await resourceHealth(resources, { profileDir: profile, managedAssetsDir: assets })
  assert.deepEqual(health, { 'spec-superflow': true, jev: true })
  const parts = renderResourcePatch(resources, { profileDir: profile, managedAssetsDir: assets, health })
  const text = parts.join('\n')
  assert.equal((text.match(/^- insert:$/gmu) ?? []).length, 2, 'new plugin rows must use DSH insertion patches')
  assert.doesNotMatch(text, /^- id: "third-party-/mu, 'a top-level unknown id is only an override and would be ignored')
  assert.match(text, /providerName: "spec-superflow-upstream"/)
  assert.match(text, /includeDefaultRoots: false/)
  assert.match(text, /watch: false/)
  assert.match(text, new RegExp(path.join(profile, 'node_modules', 'spec-superflow', 'skills').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(text, /name: "@deepseek-ai\/dsh-mcp-client"/)
  assert.match(text, /command: !!js process\.execPath/)
  assert.match(text, /disabled: !!js >-\n\s+!process\.env\.TYPESAFE_API_KEY/)
  assert.match(text, /TYPESAFE_API_KEY: !!js process\.env\.TYPESAFE_API_KEY/)
  assert.doesNotMatch(text, /!!js "(?:!process|process)/)
  assert.match(text, /failOnStartupError: false/)
  assert.match(text, /toolCallTimeoutMs: 15000/)
  assert.doesNotMatch(text, /JEV_PROVIDER/)

  const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (source) => source })
  const parsed = yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([jsType]) })
  assert.equal(parsed[1].insert[0].disabled.trim(), '!process.env.TYPESAFE_API_KEY')
  assert.equal(parsed[1].insert[0].config.command, 'process.execPath')

  await rm(path.join(profile, 'node_modules', 'spec-superflow', 'skills', 'code-reviewer', 'SKILL.md'))
  const unhealthy = await resourceHealth(resources, { profileDir: profile, managedAssetsDir: assets })
  assert.equal(unhealthy['spec-superflow'], false)
  const onlyMcp = renderResourcePatch(resources, { profileDir: profile, managedAssetsDir: assets, health: unhealthy }).join('\n')
  assert.doesNotMatch(onlyMcp, /spec-superflow-upstream/)
})

test('strict launcher passes only key and typesafe provider, forwards signals, and propagates exit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'third-party-launcher-'))
  const server = path.join(root, 'server.mjs')
  const launcher = path.join(root, 'launcher.mjs')
  const output = path.join(root, 'env.json')
  await writeFile(server, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(output)}, JSON.stringify(process.env))\nprocess.exit(7)\n`)
  const source = renderMcpLauncher(server)
  assert.doesNotMatch(source, /\.\.\.process\.env/)
  assert.match(source, /env: \{ TYPESAFE_API_KEY: key, JEV_PROVIDER: 'typesafe' \}/)
  assert.match(source, /SIGINT.*SIGTERM.*SIGHUP/s)
  await writeFile(launcher, source)
  const result = spawnSync(process.execPath, [launcher], {
    encoding: 'utf8',
    env: { ...process.env, TYPESAFE_API_KEY: 'unit-test-key', SHOULD_NOT_LEAK: 'nope' },
  })
  assert.equal(result.status, 7, result.stderr)
  const childEnv = JSON.parse(await readFile(output, 'utf8'))
  // macOS dyld may inject __CF_USER_TEXT_ENCODING after spawn; assert the
  // launcher-controlled application environment remains the exact allowlist.
  assert.equal(childEnv.TYPESAFE_API_KEY, 'unit-test-key')
  assert.equal(childEnv.JEV_PROVIDER, 'typesafe')
  assert.equal(childEnv.SHOULD_NOT_LEAK, undefined)
  assert.equal(childEnv.PATH, undefined)
  assert.equal(childEnv.HOME, undefined)
  assert.deepEqual(Object.keys(childEnv).filter((key) => !key.startsWith('__CF_')).sort(), ['JEV_PROVIDER', 'TYPESAFE_API_KEY'])
  const missing = spawnSync(process.execPath, [launcher], { encoding: 'utf8', env: {} })
  assert.equal(missing.status, 78)
  assert.equal(missing.stdout, '')
  assert.equal(missing.stderr, '')

  const deadEntry = path.join(root, 'missing-entry.mjs')
  await writeFile(launcher, renderMcpLauncher(deadEntry))
  const failed = spawnSync(process.execPath, [launcher], {
    encoding: 'utf8',
    env: { TYPESAFE_API_KEY: 'must-not-appear-in-child-error' },
  })
  assert.notEqual(failed.status, 0)
  assert.doesNotMatch(`${failed.stdout}${failed.stderr}`, /must-not-appear-in-child-error/)
})

test('managed launcher ownership is idempotent, drift-safe, and removable on disable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'third-party-managed-launcher-'))
  const profile = path.join(root, 'profile')
  const assets = path.join(root, 'assets')
  const resources = validated(mcp)
  await packageFixture(profile, '@jkudish/jev-mcp', '0.6.0', ['dist/index.js'])
  const state = {}
  const changes = []
  await syncManagedLaunchers(resources, { profileDir: profile, managedAssetsDir: assets, state, onChange: (v) => changes.push(v) })
  assert.equal(existsSync(path.join(assets, 'jev-launcher.mjs')), true)
  await syncManagedLaunchers(resources, { profileDir: profile, managedAssetsDir: assets, state, onChange: (v) => changes.push(v) })
  assert.equal(changes.length, 1)
  await writeFile(path.join(assets, 'jev-launcher.mjs'), '// local drift\n')
  await assert.rejects(syncManagedLaunchers([], { profileDir: profile, managedAssetsDir: assets, state }), /drift/)
  assert.equal(existsSync(path.join(assets, 'jev-launcher.mjs')), true)
})

test('archive listing rejects absolute, traversal, backslash, and multiple-root entries', () => {
  assert.equal(validateTarListing('repo/file\nrepo/dir/other\n'), 'repo')
  for (const listing of ['/abs\n', '../escape\n', 'repo\\evil\n', 'one/a\ntwo/b\n']) {
    assert.throws(() => validateTarListing(listing), /unsafe|one root/)
  }
})

test('schema install is hash-verified, idempotent, drift-safe, atomic, and reversible', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'third-party-schema-'))
  const repo = path.join(root, 'repo')
  const userSchemasDir = path.join(root, 'user-data', 'openspec', 'schemas')
  const fixtureTree = path.join(root, 'fixture-tree')
  await mkdir(fixtureTree, { recursive: true })
  await writeFile(path.join(fixtureTree, 'schema.yaml'), 'name: anvil\n')
  await mkdir(path.join(fixtureTree, 'templates'))
  await writeFile(path.join(fixtureTree, 'templates', 'task.md'), '# task\n')
  const treeSha256 = await selectedTreeHash(fixtureTree)
  const archiveBytes = Buffer.from('local archive fixture')
  const archiveSha256 = await hashBytes(archiveBytes)
  const resource = validated({ ...schema, archiveSha256, treeSha256 })
  const state = {}
  let fetches = 0
  const changes = []
  const fetchArchive = async (_url, destination) => { fetches++; await writeFile(destination, archiveBytes) }
  const extractArchive = async (_archive, destination) => {
    const source = path.join(destination, 'repo-root', 'schemas', 'anvil')
    await mkdir(path.dirname(source), { recursive: true })
    await mkdir(source)
    await writeFile(path.join(source, 'schema.yaml'), 'name: anvil\n')
    await mkdir(path.join(source, 'templates'))
    await writeFile(path.join(source, 'templates', 'task.md'), '# task\n')
  }
  await syncSchemaResources(resource, { repo, userSchemasDir, state, fetchArchive, extractArchive, onChange: (v) => changes.push(v) })
  const target = path.join(userSchemasDir, 'anvil')
  assert.equal(await selectedTreeHash(target), treeSha256)
  assert.equal(fetches, 1)
  await syncSchemaResources(resource, { repo, userSchemasDir, state, fetchArchive, extractArchive, onChange: (v) => changes.push(v) })
  assert.equal(fetches, 1)
  assert.equal(changes.length, 1)

  await writeFile(path.join(target, 'schema.yaml'), 'local drift\n')
  await assert.rejects(syncSchemaResources(resource, { repo, userSchemasDir, state, fetchArchive, extractArchive }), /drift/)
  await assert.rejects(syncSchemaResources([], { repo, userSchemasDir, state, fetchArchive, extractArchive }), /drift/)
  assert.equal(existsSync(target), true)

  await writeFile(path.join(target, 'schema.yaml'), 'name: anvil\n')
  await syncSchemaResources([], { repo, userSchemasDir, state, fetchArchive, extractArchive, onChange: (v) => changes.push(v) })
  assert.equal(existsSync(target), false)
  assert.deepEqual(state.thirdPartySchemas, {})
})

test('schema hash failures leave an existing managed target intact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'third-party-schema-atomic-'))
  const repo = path.join(root, 'repo')
  const userSchemasDir = path.join(root, 'user-data', 'openspec', 'schemas')
  const target = path.join(userSchemasDir, 'anvil')
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, 'schema.yaml'), 'old\n')
  const oldHash = await selectedTreeHash(target)
  const bytes = Buffer.from('archive')
  const state = { thirdPartySchemas: { anvil: { target: 'anvil', scope: 'user', deployedHash: oldHash, sourceIdentity: 'old' } } }
  const resources = validated({ ...schema, archiveSha256: await hashBytes(bytes), treeSha256: 'f'.repeat(64) })
  await assert.rejects(syncSchemaResources(resources, {
    repo,
    userSchemasDir,
    state,
    fetchArchive: async (_url, file) => writeFile(file, bytes),
    extractArchive: async (_archive, destination) => {
      const source = path.join(destination, 'root', 'schemas', 'anvil')
      await mkdir(source, { recursive: true })
      await writeFile(path.join(source, 'schema.yaml'), 'new but wrong hash\n')
    },
  }), /selected tree sha256 mismatch/)
  assert.equal(await readFile(path.join(target, 'schema.yaml'), 'utf8'), 'old\n')
})
