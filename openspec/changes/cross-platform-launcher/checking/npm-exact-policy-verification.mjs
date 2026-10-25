// Offline, inert package-script denial probes against integrity-verified npm11.19.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { SCRIPT_FLAGS, scriptPolicyEnv } = require('../../../../packages/dsh-pet/compat/subagent/compat-script-policy.cjs')
const npm = path.join(import.meta.dirname, 'baselines/npm-policy/package/bin/npm-cli.js')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-exact-policy-'))
const sentinel = path.join(root, 'SCRIPT_RAN')
for (const version of ['1.0.0', '1.0.1']) {
  const pkg = path.join(root, version, 'package')
  await fs.mkdir(pkg, { recursive: true })
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'inert-policy-probe', version, scripts: { postinstall: 'node sentinel.cjs' } }))
  await fs.writeFile(path.join(pkg, 'sentinel.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'unexpected')`)
  const packed = spawnSync('tar', ['-czf', path.join(root, version + '.tgz'), '-C', path.dirname(pkg), 'package'], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
}
// Registry-style rules must NOT match file tarballs by self-reported identity.
// Exercise trusted registry matching separately, and strict subprocess rejection below.
const isScriptAllowed = require(path.join(import.meta.dirname, 'baselines/npm-policy/package/node_modules/@npmcli/arborist/lib/script-allowed.js'))
for (const version of ['1.0.0', '1.0.1']) {
  const node = { packageName: 'inert-policy-probe', version, resolved: `https://registry.npmjs.org/inert-policy-probe/-/inert-policy-probe-${version}.tgz`, package: { name: 'inert-policy-probe', version }, edgesIn: new Set() }
  assert.equal(isScriptAllowed(node, { 'inert-policy-probe@1.0.0': false }), version === '1.0.0' ? false : null)
}
for (const [name, version, success] of [['file-source-not-registry-deny', '1.0.0', false], ['unknown-version', '1.0.1', false]]) {
  const project = path.join(root, name)
  await fs.mkdir(project)
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name, private: true, allowScripts: { 'inert-policy-probe@1.0.0': false }, dependencies: { 'inert-policy-probe': 'file:' + path.join(root, version + '.tgz') } }))
  const npmrc = 'global=true\nlocation=global\nallow-scripts=inert-policy-probe@1.0.0\ndangerously-allow-all-scripts=true\nignore-scripts=true\nstrict-allow-scripts=false\n'
  await fs.writeFile(path.join(project, '.npmrc'), npmrc)
  await fs.writeFile(path.join(root, 'user.npmrc'), npmrc)
  await fs.writeFile(path.join(root, 'global.npmrc'), npmrc)
  const env = scriptPolicyEnv({ ...process.env, NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_SCRIPTS: 'true', npm_config_userconfig: path.join(root, 'user.npmrc'), npm_config_globalconfig: path.join(root, 'global.npmrc'), npm_config_cache: path.join(root, 'cache') })
  const result = spawnSync(process.execPath, [npm, 'install', '--offline', '--no-audit', '--no-fund', ...SCRIPT_FLAGS], { cwd: project, env, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status === 0, success, result.stderr)
  if (!success) assert.match(result.stderr, /strict-allow-scripts|EUNREVIEWEDSCRIPTS|not covered by allowScripts/)
  assert.equal(await fs.stat(sentinel).then(() => true).catch(() => false), false)
  console.log(JSON.stringify({ name, version, status: result.status, scriptSentinelAbsent: true, npmrcBypassesNeutralized: true }))
}
console.log('EXACT_DENY_AND_UNKNOWN_VERSION_FAIL_CLOSED_PASS')
