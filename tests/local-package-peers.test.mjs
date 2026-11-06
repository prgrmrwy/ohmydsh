import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const semver = createRequire(import.meta.url)('semver')
const RUNTIME_SCOPE = '@deepseek-ai/dsh-'
const BLOCKS = ['dependencies', 'devDependencies', 'peerDependencies']
// `>=<lower> <M.N.0-0`: DSH matches ranges with prereleases included, so the upper
// bound must be the `-0` of the next minor (`<0.3.0` would admit 0.3.0-rc.*).
const INTERVAL = /^>=(\S+) <(\d+)\.(\d+)\.0-0$/

/** The pinned runtime version is the manifest's dshVersion — the single source of truth. */
async function pinnedRuntimeVersion() {
  const manifest = await readFile(path.join(REPO, 'dsh.yaml'), 'utf8')
  const match = manifest.match(/^dshVersion:\s*(\S+)/m)
  assert.ok(match, 'dsh.yaml must declare dshVersion')
  return match[1]
}

function localPackages() {
  const dir = path.join(REPO, 'packages')
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'package.json')))
    .map(entry => ({ id: entry.name, file: path.join(dir, entry.name, 'package.json') }))
}

/**
 * Every violation of the runtime-compatibility contract for one package manifest.
 * - devDependencies on the runtime build against the pin: exactly `^<dshVersion>`;
 * - a package with any runtime peer declares `engines.dsh`, and every runtime peer is
 *   exactly `<engines.dsh> || ^<dshVersion>`. 0.2.0 Hosts read peers and 0.2.1+ read
 *   engines.dsh, both with prereleases included, where the tail is a subset of the
 *   interval, so both Hosts reach the same verdict; the tail exists only because npm
 *   checks workspace peers with standard semver and would otherwise refuse to hoist a
 *   prerelease runtime (nesting duplicate copies that resolve past the worktree);
 * - the shared range is `>=X <M.(N+1).0-0` with X <= dshVersion, and it admits
 *   dshVersion with prereleases included;
 * - no runtime dependency is an exact version, and none is a plain dependency.
 */
function runtimeContractViolations(id, pkg, runtimeVersion) {
  const out = []
  const peers = []
  for (const block of BLOCKS) {
    for (const [name, range] of Object.entries(pkg[block] ?? {})) {
      if (!name.startsWith(RUNTIME_SCOPE)) continue
      if (/^\d/.test(range)) { out.push(`${id} → ${block}.${name} = "${range}" (exact runtime pins are not allowed)`); continue }
      if (block === 'devDependencies' && range !== `^${runtimeVersion}`) out.push(`${id} → devDependencies.${name} = "${range}" (expected "^${runtimeVersion}")`)
      if (block === 'dependencies' && range !== `^${runtimeVersion}`) out.push(`${id} → dependencies.${name} = "${range}" (expected "^${runtimeVersion}")`)
      if (block === 'peerDependencies') peers.push({ name, range })
    }
  }
  if (peers.length === 0) return out
  const engines = pkg.engines?.dsh
  if (typeof engines !== 'string') {
    out.push(`${id} → engines.dsh missing (required when runtime peers are declared)`)
    return out
  }
  for (const { name, range } of peers) {
    if (!(pkg.devDependencies ?? {})[name]) out.push(`${id} → peerDependencies.${name} has no matching devDependency (expected "^${runtimeVersion}")`)
    const expected = `${engines} || ^${runtimeVersion}`
    if (range !== expected) out.push(`${id} → peerDependencies.${name} = "${range}" (expected "${expected}")`)
  }
  const match = engines.match(INTERVAL)
  if (!match) {
    out.push(`${id} → engines.dsh = "${engines}" (expected ">=<lower> <M.N.0-0")`)
    return out
  }
  const [, lower, major, minor] = match
  const pinned = semver.parse(runtimeVersion)
  if (!semver.valid(lower)) {
    out.push(`${id} → engines.dsh lower bound "${lower}" is not a version`)
    return out
  }
  if (Number(major) !== pinned.major || Number(minor) !== pinned.minor + 1) {
    out.push(`${id} → engines.dsh = "${engines}" (upper bound must be <${pinned.major}.${pinned.minor + 1}.0-0)`)
  }
  if (semver.gt(lower, runtimeVersion)) out.push(`${id} → engines.dsh lower bound ${lower} is above dshVersion ${runtimeVersion}`)
  if (!semver.satisfies(runtimeVersion, engines, { includePrerelease: true })) out.push(`${id} → engines.dsh = "${engines}" does not admit dshVersion ${runtimeVersion}`)
  return out
}

test('local packages declare the runtime-compatibility contract', async () => {
  const runtimeVersion = await pinnedRuntimeVersion()
  const drifted = []
  for (const { id, file } of localPackages()) {
    drifted.push(...runtimeContractViolations(id, JSON.parse(await readFile(file, 'utf8')), runtimeVersion))
  }
  assert.deepEqual(drifted, [], `runtime contract drift:\n  ${drifted.join('\n  ')}`)
})

test('the check leaves non-runtime dependencies alone', async () => {
  // react / cordis / schemastery follow their own upstream cadence.
  const seen = new Set()
  for (const { file } of localPackages()) {
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    for (const block of BLOCKS) {
      for (const name of Object.keys(pkg[block] ?? {})) {
        if (!name.startsWith(RUNTIME_SCOPE)) seen.add(name)
      }
    }
  }
  assert.ok(seen.has('@deepseek-ai/cordis'), 'expected cordis among the unguarded dependencies')
  const pkg = { peerDependencies: { '@deepseek-ai/cordis': '^4.0.4', react: '^18' } }
  assert.deepEqual(runtimeContractViolations('x', pkg, '0.2.1-rc.5'), [])
})

const R = '>=0.2.0-rc.2 <0.3.0-0'
const P = pin => `${R} || ^${pin}`
const ok = (extra = {}) => ({
  engines: { node: '>=22.19', dsh: R },
  peerDependencies: { '@deepseek-ai/dsh-llm': P('0.2.1-rc.5'), '@deepseek-ai/dsh-agent': P('0.2.1-rc.5') },
  devDependencies: { '@deepseek-ai/dsh-llm': '^0.2.1-rc.5', '@deepseek-ai/dsh-agent': '^0.2.1-rc.5' },
  ...extra,
})

test('scenario: aligned declarations pass', () => {
  assert.deepEqual(runtimeContractViolations('x', ok(), '0.2.1-rc.5'), [])
})

test('scenario: 0.2.0-rc.2 → 0.2.1-rc.5 keeps engines.dsh; only the pin-following parts move', () => {
  const before = ok({ peerDependencies: { '@deepseek-ai/dsh-llm': P('0.2.0-rc.2') }, devDependencies: { '@deepseek-ai/dsh-llm': '^0.2.0-rc.2' } })
  assert.deepEqual(runtimeContractViolations('x', before, '0.2.0-rc.2'), [])
  const after = ok({ peerDependencies: { '@deepseek-ai/dsh-llm': P('0.2.1-rc.5') } })
  assert.equal(after.engines.dsh, before.engines.dsh)
  assert.deepEqual(runtimeContractViolations('x', after, '0.2.1-rc.5'), [])
})

test('scenario: the peer tail never changes the Host verdict', () => {
  // Hosts match with prereleases included; the tail must be a subset of the interval.
  for (const v of ['0.2.0-rc.2', '0.2.1-rc.5', '0.2.2-rc.1', '0.3.0-rc.1', '0.1.5-rc.2']) {
    assert.equal(semver.satisfies(v, P('0.2.1-rc.5'), { includePrerelease: true }), semver.satisfies(v, R, { includePrerelease: true }), v)
  }
  // ...while npm (standard semver) can satisfy the workspace peer with the pinned runtime.
  assert.equal(semver.satisfies('0.2.1-rc.5', P('0.2.1-rc.5')), true)
  assert.equal(semver.satisfies('0.2.1-rc.5', R), false)
})

test('scenario: upgrading past the interval fails and names package and field', () => {
  const v = runtimeContractViolations('pkg-a', ok({ peerDependencies: { '@deepseek-ai/dsh-llm': P('0.3.0-rc.1') }, devDependencies: { '@deepseek-ai/dsh-llm': '^0.3.0-rc.1' } }), '0.3.0-rc.1')
  assert.ok(v.some(line => line.startsWith('pkg-a → engines.dsh') && line.includes('<0.4.0-0')), v.join('\n'))
  assert.ok(v.some(line => line.includes('does not admit dshVersion 0.3.0-rc.1')), v.join('\n'))
})

test('scenario: a lower bound above dshVersion fails', () => {
  const r = '>=0.2.1-rc.5 <0.3.0-0'
  const pkg = ok({ engines: { dsh: r }, peerDependencies: { '@deepseek-ai/dsh-llm': `${r} || ^0.2.0-rc.2` }, devDependencies: { '@deepseek-ai/dsh-llm': '^0.2.0-rc.2' } })
  assert.ok(runtimeContractViolations('x', pkg, '0.2.0-rc.2').some(line => line.includes('above dshVersion')))
})

test('scenario: engines.dsh and peers must agree, and engines.dsh must exist', () => {
  for (const wrong of [R, '^0.2.0-rc.2', P('0.2.0-rc.2')]) {
    const differs = ok({ peerDependencies: { '@deepseek-ai/dsh-llm': P('0.2.1-rc.5'), '@deepseek-ai/dsh-agent': wrong } })
    assert.ok(runtimeContractViolations('x', differs, '0.2.1-rc.5').some(line => line.includes('peerDependencies.@deepseek-ai/dsh-agent') && line.includes('expected')), wrong)
  }
  const missing = ok({ engines: { node: '>=22.19' } })
  assert.ok(runtimeContractViolations('x', missing, '0.2.1-rc.5').some(line => line.includes('engines.dsh missing')))
})

test('scenario: an upper bound that admits next-minor prereleases, or none, fails', () => {
  for (const r of ['>=0.2.0-rc.2 <0.3.0', '>=0.2.0-rc.2', '^0.2.0-rc.2']) {
    const pkg = ok({ engines: { dsh: r }, peerDependencies: { '@deepseek-ai/dsh-llm': `${r} || ^0.2.1-rc.5` } })
    assert.ok(runtimeContractViolations('x', pkg, '0.2.1-rc.5').some(line => line.includes('expected ">=<lower> <M.N.0-0"')), r)
  }
})

test('scenario: exact runtime pins are rejected in every block', () => {
  for (const block of BLOCKS) {
    const pkg = ok({ [block]: { ...(ok()[block] ?? {}), '@deepseek-ai/dsh-tools': '0.2.1-rc.5' } })
    assert.ok(runtimeContractViolations('x', pkg, '0.2.1-rc.5').some(line => line.includes(`${block}.@deepseek-ai/dsh-tools`) && line.includes('exact')), block)
  }
})

test('scenario: devDependencies that do not follow the pin cannot be exempted', () => {
  const v = runtimeContractViolations('x', ok({ devDependencies: { '@deepseek-ai/dsh-llm': '^0.2.0-rc.2' } }), '0.2.1-rc.5')
  assert.ok(v.some(line => line.includes('devDependencies.@deepseek-ai/dsh-llm') && line.includes('expected "^0.2.1-rc.5"')))
})

test('scenario: a runtime peer without a matching devDependency fails', () => {
  // npm would auto-install that peer with standard semver and could pick an older runtime.
  const pkg = ok({ peerDependencies: { '@deepseek-ai/dsh-llm': P('0.2.1-rc.5'), '@deepseek-ai/dsh-session': P('0.2.1-rc.5') } })
  assert.ok(runtimeContractViolations('x', pkg, '0.2.1-rc.5').some(line => line.includes('peerDependencies.@deepseek-ai/dsh-session') && line.includes('devDependency')))
})

// DSH 0.2.2 raised the floor for dsh-auto-model-routing only (change upgrade-dsh-0-2-2-runtime, D3): it needs `agent.model.select`
// and 0.2.2's per-step selection pinning, which 0.2.0/0.2.1 do not have. Every other local package keeps the 0.2.0-rc.2 floor.
const AUTO_ROUTING = 'dsh-auto-model-routing'
const AUTO_FLOOR = '0.2.2-rc.1'
const DEFAULT_FLOOR = '0.2.0-rc.2'
test('scenario: only dsh-auto-model-routing raises the runtime floor to 0.2.2-rc.1', async () => {
  const wrong = []
  let seenAuto = false
  for (const { id, file } of localPackages()) {
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    if (typeof pkg.engines?.dsh !== 'string') continue
    const floor = id === AUTO_ROUTING ? AUTO_FLOOR : DEFAULT_FLOOR
    if (id === AUTO_ROUTING) seenAuto = true
    const interval = `>=${floor} <0.3.0-0`
    if (pkg.engines.dsh !== interval) wrong.push(`${id} → engines.dsh = "${pkg.engines.dsh}" (expected "${interval}")`)
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!name.startsWith(RUNTIME_SCOPE)) continue
      if (!range.startsWith(`${interval} || `)) wrong.push(`${id} → peerDependencies.${name} = "${range}" (expected to start with "${interval} || ")`)
    }
  }
  assert.ok(seenAuto, 'dsh-auto-model-routing must declare engines.dsh')
  assert.deepEqual(wrong, [], wrong.join('\n'))
})

test('scenario: the floor check for 0.2.2 rejects a 0.2.0 floor and admits the pinned runtime', () => {
  const r = `>=${AUTO_FLOOR} <0.3.0-0`
  assert.equal(semver.satisfies('0.2.2-rc.1', r, { includePrerelease: true }), true)
  assert.equal(semver.satisfies('0.2.1-rc.5', r, { includePrerelease: true }), false)
  assert.equal(semver.satisfies('0.2.0-rc.2', r, { includePrerelease: true }), false)
})
