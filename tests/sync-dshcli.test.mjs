import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeNpxCacheKey,
  npxCacheDirOf,
  npxBinPathOf,
  dshBinOf,
  pnpmCliBaseOf,
  resolveCliBin,
} from '../scripts/lib/dsh-cli.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** 在临时目录构造一个装有假 dsh bin 的 npx 缓存树。 */
async function fakeNpxCache(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-dshcli-'))
  t.after(() => { /* 临时目录保留给调试;系统清理 */ })
  return root
}

async function stashBinAt(dir, binRel, body = '#!/usr/bin/env node\n') {
  const full = path.join(dir, binRel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, body)
  return full
}

test('computeNpxCacheKey 与既有 npx 缓存目录名逐一一致(libnpmexec 算法钉板)', () => {
  assert.equal(computeNpxCacheKey(['@deepseek-ai/dsh@0.1.0-rc.7']), '2ede61d9d1d3d32e')
  assert.equal(computeNpxCacheKey(['@deepseek-ai/dsh@0.1.1-rc.1']), '1f7e68c57f9c53b8')
  assert.equal(computeNpxCacheKey(['@deepseek-ai/dsh@0.1.1-rc.2']), 'de4831d60afe10da')
  // 多包排序语义(与 libnpmexec 的 sort().join('\n') 一致)
  assert.equal(
    computeNpxCacheKey(['@deepseek-ai/dsh@0.1.1-rc.2', 'a-pkg@1.0.0']),
    computeNpxCacheKey(['a-pkg@1.0.0', '@deepseek-ai/dsh@0.1.1-rc.2']),
  )
})

test('npxBinPathOf 把 key 与 dsh bin 相对路径组合进缓存根', () => {
  const root = '/tmp/npmmock'
  assert.equal(
    npxBinPathOf('@deepseek-ai/dsh@0.1.1-rc.2', root),
    path.join(root, 'de4831d60afe10da', BIN),
  )
})

test('npxCacheDirOf / pnpmCliBaseOf 跟随环境变量', () => {
  const env = { npm_config_cache: '/tmp/custom-cache', XDG_CACHE_HOME: '/tmp/xdg' }
  assert.equal(npxCacheDirOf(env), path.join('/tmp/custom-cache', '_npx'))
  assert.equal(npxCacheDirOf({}, { platform: 'linux' }), path.join(os.homedir(), '.npm', '_npx'))
  assert.equal(pnpmCliBaseOf(env), path.join('/tmp/xdg', 'ohmydsh', 'dsh-cli'))
  assert.equal(pnpmCliBaseOf({}), path.join(os.homedir(), '.cache', 'ohmydsh', 'dsh-cli'))
})

test('npxCacheDirOf follows native npm Windows cache and case-insensitive overrides', () => {
  const win = { platform: 'win32' }
  assert.equal(npxCacheDirOf({ LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }, win), path.win32.join('C:\\Users\\tester\\AppData\\Local', 'npm-cache', '_npx'))
  assert.equal(npxCacheDirOf({ localappdata: 'D:\\Local' }, win), path.win32.join('D:\\Local', 'npm-cache', '_npx'))
  assert.equal(npxCacheDirOf({ NPM_CONFIG_CACHE: 'D:\\custom', LOCALAPPDATA: 'D:\\Local' }, win), path.win32.join('D:\\custom', '_npx'))
  assert.equal(npxCacheDirOf({}, win), path.win32.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'))
  assert.equal(npxCacheDirOf({ npm_config_cache: '/custom' }, { platform: 'linux' }), path.join('/custom', '_npx'))
})

test('resolveCliBin reuses the platform npm cache without provisioning or an explicit cache argument', async (t) => {
  const root = await fakeNpxCache(t)
  const env = process.platform === 'win32' ? { localappdata: root } : { npm_config_cache: root }
  const spec = '@deepseek-ai/dsh@0.2.0-rc.2'
  const cache = process.platform === 'win32' ? path.join(root, 'npm-cache', '_npx') : path.join(root, '_npx')
  const bin = await stashBinAt(cache, path.join(computeNpxCacheKey([spec]), BIN))
  let provisionCalls = 0
  const resolved = resolveCliBin({
    spec,
    version: '0.2.0-rc.2',
    env,
    pnpmCacheBase: path.join(root, 'absent-pnpm'),
    provisionRunner() { provisionCalls++; throw new Error('A ready native npm cache must not provision') },
  })
  assert.deepEqual(resolved, { kind: 'npx-cache', bin })
  assert.equal(provisionCalls, 0)
})

test('resolveCliBin:DSH_BIN 优先且跳过就绪检查', async (t) => {
  const cache = await fakeNpxCache(t)
  const resolved = resolveCliBin({
    spec: '@deepseek-ai/dsh@0.1.1-rc.2',
    version: '0.1.1-rc.2',
    dshBinEnv: '/custom/dsh-path',
    npxCacheDir: cache,
    pnpmCacheBase: null,
    installProbe: false,
  })
  assert.deepEqual(resolved, { kind: 'env', bin: '/custom/dsh-path' })
})

test('resolveCliBin:npx 缓存命中直连', async (t) => {
  const cache = await fakeNpxCache(t)
  const bin = await stashBinAt(cache, path.join('de4831d60afe10da', BIN))
  const resolved = resolveCliBin({
    spec: '@deepseek-ai/dsh@0.1.1-rc.2',
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: null,
    installProbe: false,
  })
  assert.deepEqual(resolved, { kind: 'npx-cache', bin })
})

test('resolveCliBin:缺失且禁止安装通道时返回 null(cache 命中前不触发安装)', async (t) => {
  const cache = await fakeNpxCache(t)
  const pnpmBase = await fakeNpxCache(t)
  const resolved = resolveCliBin({
    spec: '@deepseek-ai/dsh@0.1.1-rc.2',
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    installProbe: false,
  })
  assert.equal(resolved, null)
})

test('resolveCliBin:pnpm 通道已就绪时直接复用(不触发安装)', async (t) => {
  const cache = await fakeNpxCache(t)
  const pnpmBase = await fakeNpxCache(t)
  const bin = await stashBinAt(pnpmBase, path.join('0.1.1-rc.2', BIN))
  const resolved = resolveCliBin({
    spec: '@deepseek-ai/dsh@0.1.1-rc.2',
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    installProbe: false,
  })
  assert.deepEqual(resolved, { kind: 'pnpm-cache', bin })
  assert.ok(existsSync(bin))
})