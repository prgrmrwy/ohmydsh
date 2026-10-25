import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const base = '../packages/dsh-pet/compat/subagent/'

test('exact policy rejects blanket grants and unknown scripts', () => {
  const { validateScriptPolicy, scriptPolicyEnv, assertScriptPolicy, SCRIPT_FLAGS } = require(base + 'compat-script-policy.cjs')
  const policy = { '@google/genai@1.52.0': false, 'protobufjs@7.6.6': false }
  assert.deepEqual(validateScriptPolicy(policy), policy)
  for (const invalid of [{ '*': true }, { koffi: true }, { 'koffi@^3.1.1': true }, { 'koffi@3.1.1': 'yes' }]) assert.throws(() => validateScriptPolicy(invalid), /exact|boolean/)
  assert.throws(() => assertScriptPolicy({ allowScripts: { ...policy, 'koffi@3.1.1': true } }, policy), /policy/)
  assertScriptPolicy({ allowScripts: policy }, policy)
  const env = scriptPolicyEnv({ Path: 'native', npm_config_allow_scripts: '*', NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_SCRIPTS: 'true', NPM_CONFIG_IGNORE_SCRIPTS: 'true', npm_config_strict_allow_scripts: 'false', npm_config_userconfig: 'private', NODE_OPTIONS: '--inspect', KEEP: 'ok' })
  assert.equal(env.KEEP, 'ok')
  assert.equal(env.Path, 'native')
  for (const key of Object.keys(env)) assert.doesNotMatch(key, /^npm_config_(?:allow_scripts|dangerously_allow_all_scripts|ignore_scripts|strict_allow_scripts)$/i)
  const builder = readFileSync(new URL(base + 'build-launcher.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(builder, /\['install-scripts', 'approve', '--all'/)
  assert.match(builder, /\.\.\.SCRIPT_FLAGS/)
  assert.deepEqual(SCRIPT_FLAGS, ['--global=false', '--location=project', '--strict-allow-scripts=true', '--ignore-scripts=false', '--dangerously-allow-all-scripts=false'])
})

test('compat supervisor does not resurrect stripped script configuration', () => {
  const runFile = fileURLToPath(new URL(base + 'compat-run.cjs', import.meta.url))
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const code = `const {runCompatCommand}=require(${JSON.stringify(runFile)});const {scriptPolicyEnv}=require(${JSON.stringify(fileURLToPath(new URL(base + 'compat-script-policy.cjs', import.meta.url)))});const output=runCompatCommand(process.execPath,['-e',"console.log(JSON.stringify(Object.keys(process.env).filter(k=>/^npm_config_(allow_scripts|dangerously_allow_all_scripts|ignore_scripts|strict_allow_scripts)$/i.test(k))))"],${JSON.stringify(cwd)},{capture:true,replaceEnv:true,env:scriptPolicyEnv(process.env)});process.stdout.write(output)`
  const result = spawnSync(process.execPath, ['-e', code], { cwd, env: { ...process.env, NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_SCRIPTS: 'true', npm_config_ignore_scripts: 'true' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [])
})
