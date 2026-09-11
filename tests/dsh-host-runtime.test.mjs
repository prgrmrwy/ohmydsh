import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  declaredHostRuntimeFromManifest,
  prepareDeclaredHostRuntime,
} from '../scripts/lib/dsh-host-runtime.mjs'

const VERSION = '0.1.2-rc.1'

async function fixture(t, declaration = { kind: 'pet-unified-locus-v1', supportedDshVersion: VERSION }) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-host-runtime-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const compat = path.join(repo, 'packages/dsh-pet/compat/subagent')
  await mkdir(compat, { recursive: true })
  await writeFile(path.join(compat, 'build-launcher.cjs'), '')
  await writeFile(path.join(repo, 'dsh.yaml'), [
    `dshVersion: ${VERSION}`,
    'customizations:',
    '  - id: dsh-pet',
    '    type: package',
    '    source: local',
    '    version: 0.1.0',
    '    enabled: true',
    '    hostRuntimeCompatibility:',
    `      kind: ${declaration.kind}`,
    `      supportedDshVersion: ${declaration.supportedDshVersion}`,
    '',
  ].join('\n'))
  return { repo, compat }
}

function manifest(overrides = {}) {
  return {
    dshVersion: overrides.dshVersion ?? VERSION,
    customizations: [{
      id: 'dsh-pet', type: 'package', source: 'local', enabled: overrides.enabled ?? true,
      enabledEnv: overrides.enabledEnv,
      hostRuntimeCompatibility: overrides.declaration ?? {
        kind: 'pet-unified-locus-v1', supportedDshVersion: VERSION,
      },
    }],
  }
}

test('损坏 manifest 不得冒充合法无声明并回退官方 Host', async t => {
  const { repo } = await fixture(t)
  assert.throws(() => declaredHostRuntimeFromManifest(null, { repo, env: {} }), /root must be a mapping/)
  assert.throws(() => declaredHostRuntimeFromManifest({ dshVersion: VERSION }, { repo, env: {} }), /customizations must be a list/)
  assert.throws(() => declaredHostRuntimeFromManifest({ dshVersion: VERSION, customizations: {} }, { repo, env: {} }), /customizations must be a list/)
})

test('只接受 dsh-pet 固定 compatibility kind，不开放 manifest 执行路径', async t => {
  const { repo } = await fixture(t)
  const parsed = declaredHostRuntimeFromManifest(manifest(), { repo, env: {} })
  assert.equal(parsed.kind, 'pet-unified-locus-v1')
  assert.match(parsed.builder, /packages\/dsh-pet\/compat\/subagent\/build-launcher\.cjs$/)
  assert.match(parsed.serverBin, /\.launcher\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js$/)
  assert.throws(
    () => declaredHostRuntimeFromManifest(manifest({ declaration: {
      kind: 'pet-unified-locus-v1', supportedDshVersion: VERSION, builder: '/tmp/evil',
    } }), { repo, env: {} }),
    /\.builder is unknown/,
  )
})

test('启用 Pet 时版本 mismatch fail closed；effective disabled 时不阻止升级', async t => {
  const { repo } = await fixture(t)
  assert.throws(
    () => declaredHostRuntimeFromManifest(manifest({ dshVersion: '0.1.2' }), { repo, env: {} }),
    /re-audit or remove/,
  )
  assert.equal(declaredHostRuntimeFromManifest(manifest({ dshVersion: '0.1.2', enabled: false }), { repo, env: {} }), null)
  assert.equal(declaredHostRuntimeFromManifest(manifest({
    dshVersion: '0.1.2', enabledEnv: 'DSH_PET_ENABLED',
  }), { repo, env: { DSH_PET_ENABLED: 'false' } }), null)
})

test('builder 失败时 Host fail closed，不回退官方 runtime', async t => {
  const { repo } = await fixture(t)
  assert.throws(() => prepareDeclaredHostRuntime({
    repo,
    runner: () => ({ ok: false, timedOut: false, status: 17 }),
  }), /exited 17.*refusing official-runtime fallback/)
})

test('builder 成功后要求真实 bin 和精确版本', async t => {
  const { repo, compat } = await fixture(t)
  let calls = 0
  const runner = (command, args) => {
    calls += 1
    if (calls === 1) {
      const bin = path.join(compat, '.launcher/node_modules/@deepseek-ai/dsh/lib/bin.js')
      mkdirSync(path.dirname(bin), { recursive: true })
      writeFileSync(bin, '')
      writeFileSync(path.join(compat, '.launcher/.fingerprint'), 'a'.repeat(64))
      return { ok: true, status: 0, stdout: '' }
    }
    return { ok: true, status: 0, stdout: `${VERSION}\n` }
  }
  const resolved = prepareDeclaredHostRuntime({ repo, runner })
  assert.equal(resolved.kind, 'customization-host-runtime')
  assert.equal(resolved.ownerId, 'dsh-pet')
  assert.equal(resolved.fingerprint, 'a'.repeat(64))
  assert.equal(calls, 2)
})

test('版本探针错误时拒绝发布给 Host', async t => {
  const { repo, compat } = await fixture(t)
  let calls = 0
  assert.throws(() => prepareDeclaredHostRuntime({
    repo,
    runner: () => {
      calls += 1
      if (calls === 1) {
        const bin = path.join(compat, '.launcher/node_modules/@deepseek-ai/dsh/lib/bin.js')
        mkdirSync(path.dirname(bin), { recursive: true })
        writeFileSync(bin, '')
        return { ok: true, status: 0, stdout: '' }
      }
      return { ok: true, status: 0, stdout: '9.9.9\n' }
    },
  }), /reports 9\.9\.9, expected/)
})
