import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { runLauncher } from '../scripts/launcher/main.mjs'

async function fixture(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-preview-'))
  t.after(() => fs.rm(repo, { recursive: true, force: true }))
  await fs.writeFile(path.join(repo, 'dsh.yaml'), 'dshVersion: 0.2.0-rc.2\nautoUpdate: {enabled: false}\nweb: {open: false}\n')
  const home = path.join(repo, 'home'); await fs.mkdir(home)
  const calls = [], logs = [], listeners = new Map()
  let nextPid = 50000
  const options = {
    repo, env: { DSH_HOME: home, DSH_PORT: '3200', DSH_SKIP_HOST_PREREQUISITES: '1' },
    isolatedHome: () => true, log: line => logs.push(line), warn() {}, connect: async () => true,
    probe: async port => listeners.has(port) ? { state: 'owned', processes: [listeners.get(port)] } : { state: 'empty', processes: [] },
    stop: async () => { throw Error('must not stop a neighbour') },
    run: async (command, args) => {
      calls.push(args)
      if (args[0]?.endsWith('dsh-server-bin.mjs')) return { status: 0, stdout: 'DSH_SERVER_BIN=fixture.js\nDSH_RUNTIME_KIND=env\n', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    },
    spawn: (command, args) => {
      const child = new EventEmitter(); child.pid = nextPid++; child.exitCode = null; child.signalCode = null; child.unref = () => {}
      const port = Number(args[args.indexOf('--port') + 1])
      listeners.set(port, { pid: child.pid, created: `time-${child.pid}` })
      return child
    },
  }
  return { repo, home, options, calls, logs, listeners }
}
test('isolated 3080 refuses start stop restart before probe or build effects', async t => {
  const f = await fixture(t)
  f.options.probe = async () => { throw Error('probe must not run') }
  for (const args of [[], ['stop'], ['restart']]) await assert.rejects(runLauncher([...args, '--port', '3080'], f.options), /3080/)
  assert.equal(f.calls.length, 0)
})
test('preview skips occupied preferred port and records only its own child', async t => {
  const f = await fixture(t)
  f.listeners.set(3200, { pid: 42, created: 'neighbour' })
  assert.equal(await runLauncher(['--no-open'], f.options), 0)
  const record = JSON.parse(await fs.readFile(path.join(f.home, 'preview.json')))
  assert.equal(record.port, 3201); assert.equal(record.pid, 50000)
  assert.equal(f.listeners.get(3200).pid, 42)
  assert(f.logs.some(line => line.startsWith('DSH_PREVIEW ') && line.includes('3201')))
})
test('explicit preview port never backs off and exhaustion never stops neighbours', async t => {
  const f = await fixture(t)
  f.listeners.set(3200, { pid: 42, created: 'neighbour' })
  await assert.rejects(runLauncher(['--port', '3200', '--no-open'], f.options), /occupied/)
  for (let port = 3200; port < 3220; port++) f.listeners.set(port, { pid: port, created: 'neighbour' })
  await assert.rejects(runLauncher(['--no-open'], f.options), /exhausted/)
  await assert.rejects(fs.stat(path.join(f.home, 'preview.json')))
})
test('losing a concurrent bind never reports the winner as this preview', async t => {
  const f = await fixture(t)
  const spawn = f.options.spawn
  let attempts = 0
  f.options.spawn = (command, args, options) => {
    const child = spawn(command, args, options)
    if (++attempts === 1) {
      const port = Number(args[args.indexOf('--port') + 1])
      f.listeners.set(port, { pid: 99999, created: 'other-launcher' })
      child.exitCode = 1
    }
    return child
  }
  assert.equal(await runLauncher(['--no-open'], f.options), 0)
  const record = JSON.parse(await fs.readFile(path.join(f.home, 'preview.json')))
  assert.equal(record.port, 3201); assert.equal(record.pid, 50001)
  assert.equal(f.listeners.get(3200).pid, 99999)
})

test('two concurrent preview starts report different own listeners', async t => {
  const a = await fixture(t), b = await fixture(t)
  const listeners = new Map()
  let pid = 70000
  const probe = async port => listeners.has(port) ? { state: 'owned', processes: [listeners.get(port)] } : { state: 'empty', processes: [] }
  const spawn = (_command, args) => {
    const port = Number(args[args.indexOf('--port') + 1])
    const child = new EventEmitter(); child.pid = pid++; child.signalCode = null; child.exitCode = listeners.has(port) ? 1 : null; child.unref = () => {}
    if (child.exitCode === null) listeners.set(port, { pid: child.pid, created: `time-${child.pid}` })
    return child
  }
  for (const f of [a, b]) Object.assign(f.options, { probe, spawn })
  assert.deepEqual(await Promise.all([runLauncher(['--no-open'], a.options), runLauncher(['--no-open'], b.options)]), [0, 0])
  const records = await Promise.all([a, b].map(async f => JSON.parse(await fs.readFile(path.join(f.home, 'preview.json')))))
  assert.notEqual(records[0].port, records[1].port)
  for (const record of records) assert.equal(listeners.get(record.port).pid, record.pid)
})

test('stale preview record is cleared without calling stop on another listener', async t => {
  const f = await fixture(t)
  f.listeners.set(3200, { pid: 42, created: 'neighbour' })
  await fs.writeFile(path.join(f.home, 'preview.json'), JSON.stringify({ port: 3200, pid: 41, created: 'old' }))
  assert.equal(await runLauncher(['stop'], f.options), 0)
  await assert.rejects(fs.stat(path.join(f.home, 'preview.json')))
  assert.equal(f.listeners.get(3200).pid, 42)
})
