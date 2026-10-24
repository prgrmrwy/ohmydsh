import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const MODULE = '../scripts/lib/package-manager.cjs'
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'ohmydsh package-manager 中文 ')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const nodePath = path.join(root, 'node.exe')
  await writeFile(nodePath, '')
  return { root, nodePath }
}
async function packageEntry(root, name, entry) {
  const dir = path.join(root, 'node_modules', name)
  const file = path.join(dir, entry)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  await writeFile(file, '')
  return file
}
function resolver() {
  // Missing production module is an explicit capability RED before P3; the
  // cases below are concrete filesystem layouts, not mocked success returns.
  return require(MODULE)
}

test('package manager resolver is builtin-only and supports synchronous CJS and ESM consumers', async () => {
  const cjs = resolver()
  assert.equal(typeof cjs.resolvePackageManager, 'function')
  const esm = await import(MODULE)
  assert.equal(esm.default.resolvePackageManager, cjs.resolvePackageManager)
})

test('Windows npm and npx resolve beside current Node without npm_execpath', async t => {
  const { root, nodePath } = await fixture(t)
  const npm = await packageEntry(root, 'npm', 'bin/npm-cli.js')
  const npx = await packageEntry(root, 'npm', 'bin/npx-cli.js')
  for (const [tool, file] of [['npm', npm], ['npx', npx]]) {
    assert.deepEqual(resolver().resolvePackageManager(tool, { nodePath, platform: 'win32', env: { PATH: '' } }), { command: nodePath, argsPrefix: [file] })
  }
})

test('Windows validated npm_execpath is a fallback, never arbitrary script text', async t => {
  const { root, nodePath } = await fixture(t)
  const install = path.join(root, 'different install')
  const npm = await packageEntry(install, 'npm', 'bin/npm-cli.js')
  assert.deepEqual(resolver().resolvePackageManager('npm', { nodePath, platform: 'win32', env: { npm_execpath: npm, PATH: '' } }), { command: nodePath, argsPrefix: [npm] })
  const fake = path.join(root, 'npm.cmd')
  await writeFile(fake, '@echo off\nnode untrusted.js & echo should-not-run\n')
  assert.throws(() => resolver().resolvePackageManager('npm', { nodePath, platform: 'win32', env: { npm_execpath: fake, PATH: root } }), /npm|JS|入口|entry/)
})

test('Windows native pnpm exe takes precedence over npm-prefix JavaScript package', async t => {
  const { root, nodePath } = await fixture(t)
  const exe = path.join(root, 'pnpm.exe')
  await writeFile(exe, '')
  await packageEntry(root, 'pnpm', 'bin/pnpm.cjs')
  assert.deepEqual(resolver().resolvePackageManager('pnpm', { nodePath, platform: 'win32', env: { PATH: root, npm_config_prefix: root } }), { command: exe, argsPrefix: [] })
})

test('Windows pnpm and Corepack verified JS entrypoints use current Node', async t => {
  const { root, nodePath } = await fixture(t)
  const pnpm = await packageEntry(root, 'pnpm', 'bin/pnpm.cjs')
  const corepack = await packageEntry(root, 'corepack', 'dist/corepack.js')
  for (const [tool, file] of [['pnpm', pnpm], ['corepack', corepack]]) {
    assert.deepEqual(resolver().resolvePackageManager(tool, { nodePath, platform: 'win32', env: { PATH: '', npm_config_prefix: root } }), { command: nodePath, argsPrefix: [file] })
  }
})

test('resolver does not execute cmd/bat/ps1 shims or invent missing package managers', async t => {
  const { root, nodePath } = await fixture(t)
  for (const extension of ['cmd', 'bat', 'ps1']) await writeFile(path.join(root, `pnpm.${extension}`), 'exit 77\n')
  assert.throws(() => resolver().resolvePackageManager('pnpm', { nodePath, platform: 'win32', env: { PATH: root } }), /pnpm/)
  const file = await packageEntry(root, 'npm', 'bin/npm-cli.js')
  await writeFile(path.join(root, 'node_modules/npm/package.json'), JSON.stringify({ name: 'not-npm' }))
  assert.throws(() => resolver().resolvePackageManager('npm', { nodePath, platform: 'win32', env: { PATH: '', npm_execpath: file } }), /npm/)
})

test('Windows pnpm falls back to Corepack JS without changing pinned caller arguments', async t => {
  const {root,nodePath} = await fixture(t)
  const cli = await packageEntry(root,'corepack','dist/corepack.js')
  assert.deepEqual(resolver().resolveExecutable('corepack',['pnpm@11.7.0','install'],{platform:'win32',nodePath,env:{PATH:''}}),{command:nodePath,args:[cli,'pnpm@11.7.0','install']})
  assert.deepEqual(resolver().resolvePackageManager('pnpm',{platform:'win32',nodePath,env:{PATH:''}}),{command:nodePath,argsPrefix:[cli,'pnpm']})
})

test('Windows resolver validates current package identity and ignores malformed npm_execpath', async t => {
  const {root,nodePath} = await fixture(t)
  const cli = await packageEntry(root,'npm','bin/npm-cli.js')
  assert.deepEqual(resolver().resolvePackageManager('npm',{platform:'win32',nodePath,env:{PATH:'',NPM_EXECPATH:path.join(root,'malicious.cmd')}}),{command:nodePath,argsPrefix:[cli]})
  await writeFile(path.join(root,'node_modules/npm/package.json'),'not JSON')
  assert.throws(()=>resolver().resolvePackageManager('npm',{platform:'win32',nodePath,env:{PATH:''}}),/Cannot resolve npm/)
})

test('POSIX package-manager command contract stays native argv, not shell', () => {
  assert.deepEqual(resolver().resolvePackageManager('npm', { platform: 'linux', env: {} }), { command: 'npm', argsPrefix: [] })
})

test('native Node argv preserves metacharacters, status and separate streams', () => {
  const values = ['', 'two words', '中文', 'a"b', '$HOME', 'x;y', 'a&b', '(c)', 'C:\\end\\']
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write("err"); process.exitCode=9', ...values], { encoding: 'utf8', shell: false })
  assert.equal(result.status, 9)
  assert.deepEqual(JSON.parse(result.stdout), values)
  assert.equal(result.stderr, 'err')
})
