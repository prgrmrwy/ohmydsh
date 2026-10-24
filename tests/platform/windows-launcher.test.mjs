import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Platform suites are selected explicitly by the root driver, never reported
// as passing skips on another OS. This suite requires native Windows Git.
const run = (command, argv) => new Promise((resolve, reject) => execFile(command, argv, { shell: false, windowsHide: true, encoding: 'buffer' }, (error, stdout) => error ? reject(error) : resolve(stdout)))

test('test_git_quote_and_empty_config_roundtrip', async t => {
  assert.equal(process.platform, 'win32', 'run this platform suite only on native Windows')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launcher git 中文 '))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const config = path.join(dir, 'fixture.config')
  for (const value of ['a"b 中文 &;()', '']) {
    await run('git.exe', ['config', '--file', config, 'launcher.value', value])
    assert.deepEqual(await run('git.exe', ['config', '--file', config, '--null', '--get', 'launcher.value']), Buffer.from(value + '\0'))
  }
})

test('native Windows ownership preserves Unicode spaced entry paths and stops only its fixture', async t => {
  assert.equal(process.platform, 'win32')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { spawn } = await import('node:child_process')
  const net = await import('node:net')
  const { once } = await import('node:events')
  const { probePort, stopServer } = await import('../../scripts/launcher/process.mjs')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launcher ownership 中文 '))
  let child
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'close'); child.kill(); await done }
    await rm(dir, { recursive: true, force: true })
  })
  const pkg = path.join(dir, 'node_modules/@deepseek-ai/dsh')
  await mkdir(path.join(pkg, 'lib'), { recursive: true })
  await writeFile(path.join(pkg, 'package.json'), '{"name":"@deepseek-ai/dsh","type":"module"}')
  const entry = path.join(pkg, 'lib/bin.js')
  await writeFile(entry, `import net from 'node:net';net.createServer(c=>c.end()).listen(Number(process.argv.at(-1)),'127.0.0.1',()=>console.log('READY'));`)
  const reservation = net.createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  child = spawn(process.execPath, [entry, 'web', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  await once(child.stdout, 'data')
  const before = await probePort(port)
  assert.equal(before.state, 'owned', JSON.stringify({ expected: entry, actual: before.processes?.[0]?.argv?.[1], error: before.error }))
  assert.equal(before.processes[0].argv[1], entry)
  assert.equal((await stopServer(port, { warn: () => {} })).ok, true)
  assert.equal((await probePort(port)).state, 'empty')
})

test('native Windows fixed ownership query returns empty for a verified unused loopback port', async () => {
  assert.equal(process.platform, 'win32', 'run this platform suite only on native Windows')
  const net = await import('node:net')
  const { once } = await import('node:events')
  const { probePort } = await import('../../scripts/launcher/process.mjs')
  const server = net.createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const result = await probePort(port)
  assert.equal(result.state, 'empty', result.error)
})
