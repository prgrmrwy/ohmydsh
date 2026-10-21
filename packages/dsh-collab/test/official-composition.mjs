import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, symlink, writeFile, readFile, realpath, rm, access } from 'node:fs/promises'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const deps = fileURLToPath(new URL('../../../spike/collab-host/', import.meta.url))
const bin = join(deps, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const parent = await realpath(tmpdir()), home = await mkdtemp(join(parent, 'collab-direct-'))
const exists = path => access(path).then(() => true, () => false)
try {
  const profile = join(home, 'profiles/probe'), deployment = join(home, 'deployment'), runtime = join(home, 'runtime'), dataDir = join(home, 'ledger')
  await mkdir(profile, { recursive: true }); await mkdir(runtime)
  await cp(new URL('../lib/', import.meta.url), join(deployment, 'lib'), { recursive: true })
  await writeFile(join(deployment, 'package.json'), '{"type":"module"}')
  await symlink(join(deps, 'node_modules'), join(deployment, 'node_modules'), 'dir')
  await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dsh: { profile: { bundles: [] } } }))
  let original
  for (const replay of [false, true]) {
    const ready = join(home, replay ? 'ready-replay' : 'ready-first'), failed = join(home, replay ? 'failed-replay' : 'failed-first')
    const serviceRows = [
      ['dsh-llm', {}], ['dsh-session', {}], ['dsh-session-projection', {}], ['dsh-system-prompt', { persona: '' }], ['dsh-tools', {}], ['dsh-agent', {}],
      ['dsh-session-persistence-jsonl', { root: join(runtime, 'sessions'), compression: 'none' }], ['dsh-agent-loop', { agents: [] }], ['dsh-agent-default-model', { provider: 'scripted', model: 'scripted' }],
      ['dsh-typert-registry', {}], ['dsh-commands', {}], ['dsh-credentials-local', { dshHome: runtime, watch: false }], ['dsh-client-connection', {}], ['dsh-attachment-local', { dshHome: runtime }], ['dsh-client-file-upload', {}],
      ['dsh-sandbox-policy', { mode: 'danger-full-access', workspaceRoot: runtime }], ['dsh-fs-sandbox', { cwd: runtime }], ['dsh-user-approval', { policy: 'never' }], ['dsh-tool-fs', {}],
      ['dsh-subprocess-local', {}], ['dsh-sandbox-local', {}], ['dsh-bash-sandbox', {}], ['dsh-jobs-local', {}], ['dsh-shell-env', {}], ['dsh-tool-bash', {}],
      ['dsh-session-query', {}], ['dsh-storage', {}], ['dsh-storage-sqlite', { path: join(runtime, 'state.sqlite') }], ['dsh-storage-domain', { backend: 'sqlite' }], ['dsh-workspace', {}], ['dsh-agent-preset-registry', { default: 'P1' }], ['dsh-api-session-controller', { nativeOpen: false }],
    ].map(([name, config]) => ({ id: name, name: pathToFileURL(createRequire(join(deps, 'package.json')).resolve(`@deepseek-ai/${name}`)).href, config }))
    await symlink(join(deps, 'node_modules'), join(profile, 'node_modules'), 'dir').catch(error => { if (error.code !== 'EEXIST') throw error })
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      ...serviceRows,
      { id: 'concrete-services', name: new URL('./support/official-assembly.mjs', import.meta.url).href, config: { root: runtime, replay } },
      { id: 'dsh-collab', name: pathToFileURL(join(deployment, 'lib/index.js')).href, config: { dataDir, allowedSessionIds: ['direct-caller'] } },
      { id: 'direct-check', name: new URL('./support/official-direct-check.mjs', import.meta.url).href, config: { dataDir, replay, ready, failed } },
    ] }]))
    const child = spawn(process.execPath, [bin, '--profile', 'probe'], { cwd: home, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_COLLAB_DEPENDENCY_ROOT: deps, DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
    const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
    try {
      await new Promise((resolve, reject) => {
        let done = false
        const finish = error => { if (done) return; done = true; clearTimeout(timer); watcher.close(); error ? reject(error) : resolve() }
        const check = async () => { if (await exists(failed)) finish(new Error(await readFile(failed, 'utf8'))); else if (await exists(ready)) finish() }
        const watcher = watch(home, () => { void check() })
        const timer = setTimeout(() => finish(new Error(`direct profile not ready\n${output}`)), 15000)
        void check(); void exit.then(result => finish(new Error(`official CLI exited early ${JSON.stringify(result)}\n${output}`)))
      })
      const observed = JSON.parse(await readFile(ready, 'utf8'))
      if (original) assert.deepEqual(observed, original); else original = observed
      child.kill('SIGTERM')
      let timer
      const stopped = await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('direct profile shutdown timed out')), 10000) })]).finally(() => clearTimeout(timer))
      assert.deepEqual(stopped, { code: 0, signal: null })
      assert.equal(await exists(join(dataDir, 's.lock')), false)
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exit }
  }
  console.log(JSON.stringify({ case: 'official-direct-composition', restartReceiptStable: true, serviceIdStable: true, lockReleased: true }))
} finally {
  const checked = await realpath(home)
  assert.equal(dirname(checked), parent); assert.ok(basename(checked).startsWith('collab-direct-'))
  await rm(checked, { recursive: true })
}
