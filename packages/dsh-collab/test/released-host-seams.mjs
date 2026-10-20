import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, access, cp, symlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'

const bin = fileURLToPath(new URL('../../../spike/collab-host/node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url))
// Read exact package identity rather than infer it from a directory name.
const packagePath = join(dirname(dirname(bin)), 'package.json')
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
assert.equal(pkg.version, '0.2.0-rc.2')
const kernel = fileURLToPath(new URL('../../collab-kernel/lib/index.js', import.meta.url))
const consumerMode = process.argv.includes('--consumer')
const plugin = new URL(consumerMode ? './support/host-consumer-probe.mjs' : './support/host-store-probe.mjs', import.meta.url).href
const dependencyRoot = fileURLToPath(new URL('../../../spike/collab-host/', import.meta.url))
const profileBootPath = join(dirname(bin), 'profile-boot-BZ2ZjNWi.js')
const profileBoot = await readFile(profileBootPath)
assert.match(profileBoot.toString(), /PROCESS_SHUTDOWN_TIMEOUT_MS = 5e3/)
const runtime = { version: pkg.version, binSha256: createHash('sha256').update(await readFile(bin)).digest('hex'), profileBootSha256: createHash('sha256').update(profileBoot).digest('hex'), shutdownBudgetMs: 5000 }
const parent = await realpath(tmpdir())
const root = await mkdtemp(join(parent, 'dsh-collab-host-'))
const { FileStore } = await import(new URL('../../collab-kernel/lib/index.js', import.meta.url))
const exists = async path => access(path).then(() => true, () => false)

async function marker(path, exit) {
  if (await exists(path)) return
  await new Promise((resolve, reject) => {
    const watcher = watch(dirname(path), () => { void exists(path).then(found => { if (found) finish() }) })
    const timeout = setTimeout(() => finish(new Error(`Fixture marker not reached: ${basename(path)}`)), 20000)
    function finish(error) { clearTimeout(timeout); watcher.close(); error ? reject(error) : resolve() }
    void exists(path).then(found => { if (found) finish() })
    exit.then(result => finish(new Error(`Official CLI exited before ${basename(path)}: ${JSON.stringify(result)}`)))
  })
}

try {
  for (const mode of ['normal', 'budget', 'kill']) {
    const home = join(root, mode)
    const profile = join(home, 'profiles', 'probe')
    await mkdir(profile, { recursive: true })
    const deployment = join(home, 'deployment')
    if (consumerMode) {
      await cp(new URL('../lib/', import.meta.url), join(deployment, 'lib'), { recursive: true })
      await writeFile(join(deployment, 'package.json'), '{"type":"module"}')
      await symlink(join(dependencyRoot, 'node_modules'), join(deployment, 'node_modules'), 'dir')
    }
    const config = { mode, kernel, consumer: join(deployment, 'lib/index.js'), runtimeRoot: join(home, 'runtime'), dataDir: join(home, 'data'), ready: join(home, 'ready'), blocked: join(home, 'blocked'), disposing: join(home, 'disposing'), closed: join(home, 'closed') }
    if (consumerMode) await mkdir(config.runtimeRoot)
    await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dsh: { profile: { bundles: [] } } }))
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'store-probe', name: plugin, config }] }]))
    const child = spawn(process.execPath, [bin, '--profile', 'probe'], { cwd: home, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...(consumerMode ? { DSH_COLLAB_DEPENDENCY_ROOT: dependencyRoot } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', bytes => { output += bytes })
    child.stderr.on('data', bytes => { output += bytes })
    const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
    try {
      await marker(config.ready, exit).catch(error => { throw new Error(`${error.message}\n${output}`) })
      if (mode === 'budget') await marker(config.blocked, exit)
      const lockPath = join(config.dataDir, 'probe.lock')
      const logPath = join(config.dataDir, 'probe.jsonl')
      const logBytes = await readFile(logPath)
      const lockBytes = await readFile(lockPath, 'utf8')
      const lock = JSON.parse(lockBytes)
      assert.equal(lock.pid, child.pid)
      const started = performance.now()
      child.kill(mode === 'kill' ? 'SIGKILL' : 'SIGTERM')
      // Outer deadline only fails/cleans up this test; it never defines a PASS
      // shutdown budget or supplies the process termination being verified.
      let deadline
      const result = await Promise.race([exit, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Official CLI failed to stop')), 15000) })]).finally(() => clearTimeout(deadline))
      const elapsedMs = Math.round(performance.now() - started)
      if (mode === 'normal') {
        assert.deepEqual(result, { code: 0, signal: null })
        assert.equal(await exists(config.disposing), true)
        assert.equal(await exists(config.closed), true)
        assert.equal(await exists(lockPath), false)
        const replay = new FileStore(config.dataDir)
        await replay.open('probe')
        try {
          assert.equal((await replay.read('probe', 1)).length, 1)
          assert.deepEqual(await readFile(logPath), logBytes)
        } finally { await replay.close('probe') }
      } else {
        assert.equal(await readFile(lockPath, 'utf8'), lockBytes)
        assert.equal(await exists(config.closed), false)
        if (mode === 'budget') {
          assert.deepEqual(result, { code: 0, signal: null })
          assert.equal(await exists(config.disposing), true)
          assert.ok(elapsedMs >= 4900 && elapsedMs < runtime.shutdownBudgetMs + 2000, `real 5000ms budget observed ${elapsedMs}ms`)
        } else assert.deepEqual(result, { code: null, signal: 'SIGKILL' })
        const retry = new FileStore(config.dataDir)
        await assert.rejects(retry.open('probe'), error => error.code === 'COLLAB_STORE_LOCKED')
        assert.throws(() => process.kill(lock.pid, 0), error => error.code === 'ESRCH')
        if (!consumerMode) {
          // Kernel-only probe: the Host-side death proof is exercised in consumer mode.
          await retry.breakLock('probe', lock.instanceId)
          await retry.open('probe')
          try {
            assert.equal((await retry.read('probe', 1)).length, 1)
            assert.deepEqual(await readFile(logPath), logBytes)
          } finally { await retry.close('probe') }
        } else assert.equal(await readFile(lockPath, 'utf8'), lockBytes, 'no manual unlock before the next official start')
      }
      if (consumerMode) {
        const replayConfig = { ...config, mode: 'normal', replay: true, ready: join(home, 'replay-ready'), disposing: join(home, 'replay-disposing'), closed: join(home, 'replay-closed'), replayed: join(home, 'replayed'), hostLog: join(home, 'replay-host-log.json') }
        await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'consumer-replay', name: plugin, config: replayConfig }] }]))
        const replayChild = spawn(process.execPath, [bin, '--profile', 'probe'], { cwd: home, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_COLLAB_DEPENDENCY_ROOT: dependencyRoot }, stdio: ['ignore', 'pipe', 'pipe'] })
        let replayOutput = ''
        replayChild.stdout.on('data', bytes => { replayOutput += bytes }); replayChild.stderr.on('data', bytes => { replayOutput += bytes })
        const replayExit = new Promise((resolve, reject) => { replayChild.once('error', reject); replayChild.once('exit', (code, signal) => resolve({ code, signal })) })
        try {
          await marker(replayConfig.ready, replayExit).catch(error => { throw new Error(`${error.message}\n${replayOutput}`) })
          const observed = JSON.parse(await readFile(replayConfig.replayed, 'utf8'))
          if (mode !== 'normal') {
            // lock-01: the next official start cleared the dead holder's lock itself and logged it.
            const cleared = JSON.parse(await readFile(replayConfig.hostLog, 'utf8'))
            assert.ok(cleared.some(line => line === `lock cleared: space=probe instanceId=${lock.instanceId} pid=${lock.pid}`), JSON.stringify(cleared))
            console.log(JSON.stringify({ case: `lock-01：上次异常退出留下的锁在重启后自动清理(${mode})`, cleared: true, replayed: true }))
          }
          const record = JSON.parse(logBytes.toString().trim())
          assert.deepEqual(observed.receipt, record.receipt.result)
          assert.equal(observed.address, 'official-consumer')
          assert.equal(observed.serviceId, record.events.find(event => event.type === 'space/created').serviceId)
          assert.deepEqual(await readFile(logPath), logBytes)
          replayChild.kill('SIGTERM')
          let timer
          const stopped = await Promise.race([replayExit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('consumer replay failed to stop')), 15000) })]).finally(() => clearTimeout(timer))
          assert.deepEqual(stopped, { code: 0, signal: null })
          assert.equal(await exists(lockPath), false)
          assert.deepEqual(await readFile(logPath), logBytes)
        } finally { if (replayChild.exitCode === null && replayChild.signalCode === null) replayChild.kill('SIGKILL'); await replayExit }
      }
      console.log(JSON.stringify({ case: `accept-01：真实隔离Host验证完整接缝(${mode})`, ...runtime, elapsedMs, ...result, lockRemaining: mode !== 'normal', kernelProbeOnly: !consumerMode }))
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exit
    }
  }
  console.log(JSON.stringify({ case: 'accept-02：未执行真实Host实验不能宣称完成', releasedBin: pkg.version, note: 'missing released entry or budget throws instead of skipping' }))
  console.log(JSON.stringify({ case: 'accept-03：移除保留持久日志', normalStopKeepsLedger: true }))
} finally {
  const checked = await realpath(root)
  assert.equal(dirname(checked), parent)
  assert.ok(basename(checked).startsWith('dsh-collab-host-'))
  await rm(checked, { recursive: true })
}
