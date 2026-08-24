import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HELPERS = path.join(ROOT, 'scripts/lib/dsh-runtime.sh')

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
    server.on('error', reject)
  })
}

async function waitListening(port, child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`listener exited early: ${child.exitCode}`)
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (open) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`port ${port} did not listen`)
}

async function makeListener({ dshArgv }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-runtime-'))
  const port = await freePort()
  await writeFile(path.join(dir, 'web'), `require('node:http').createServer((_,r)=>r.end('ok')).listen(${port},'127.0.0.1')\n`)
  let command = process.execPath
  let args = [path.join(dir, 'web')]
  if (dshArgv) {
    const binDir = path.join(dir, 'node_modules/.bin')
    await mkdir(binDir, { recursive: true })
    command = path.join(binDir, 'dsh')
    await symlink(process.execPath, command)
    args = ['web', '--port', String(port)]
  }
  const child = spawn(command, args, { cwd: dir, stdio: 'ignore' })
  await waitListening(port, child)
  return { dir, port, child }
}

async function waitExited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => child.once('exit', resolve))
}

async function cleanup(instance) {
  if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  await waitExited(instance.child)
  await rm(instance.dir, { recursive: true, force: true })
}

test('stop_dsh_server_on_port stops current node_modules/.bin/dsh web argv', async () => {
  const instance = await makeListener({ dshArgv: true })
  try {
    const result = spawnSync('bash', ['-c', `source "$1"; stop_dsh_server_on_port "$2" 20`, '_', HELPERS, String(instance.port)], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    await waitExited(instance.child)
    assert.notEqual(instance.child.signalCode, null)
  } finally {
    await cleanup(instance)
  }
})

test('stop_dsh_server_on_port refuses a non-DSH listener on same port', async () => {
  const instance = await makeListener({ dshArgv: false })
  try {
    const result = spawnSync('bash', ['-c', `source "$1"; stop_dsh_server_on_port "$2"; rc=$?; echo "$rc"; exit 0`, '_', HELPERS, String(instance.port)], { encoding: 'utf8' })
    assert.equal(result.stdout.trim(), '2')
    assert.equal(instance.child.exitCode, null, 'foreign listener must remain alive')
  } finally {
    await cleanup(instance)
  }
})
