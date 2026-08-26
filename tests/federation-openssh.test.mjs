import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { identityProbeArgs, tunnelArgs } from '../scripts/federation-openssh.mjs'

const SSH = '/usr/bin/ssh'
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const TEST_TIMEOUT_MS = 20_000

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') return reject(new Error('no TCP port'))
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

function waitForPort(port, expectedOpen, timeout = 5000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = new (requireNetSocket())()
      socket.once('connect', () => { socket.destroy(); expectedOpen ? resolve() : retry() })
      socket.once('error', () => { socket.destroy(); expectedOpen ? retry() : resolve() })
      socket.connect(port, '127.0.0.1')
    }
    const retry = () => {
      if (Date.now() - started >= timeout) reject(new Error(`port ${port} did not become ${expectedOpen ? 'open' : 'closed'}`))
      else setTimeout(probe, 25)
    }
    probe()
  })
}

let SocketClass
function requireNetSocket() {
  return SocketClass
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: TEST_TIMEOUT_MS, ...options })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

async function fixture() {
  const { Socket } = await import('node:net')
  SocketClass = Socket
  const root = await mkdtemp(path.join(tmpdir(), 'federation-sshd-'))
  const ssh = path.join(root, 'ssh')
  await mkdir(ssh, { mode: 0o700 })
  const hostKey = path.join(ssh, 'host_ed25519')
  const clientKey = path.join(ssh, 'client_ed25519')
  for (const target of [hostKey, clientKey]) {
    const made = run(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', target])
    assert.equal(made.status, 0, made.stderr)
  }
  const authorizedKeys = path.join(ssh, 'authorized_keys')
  await writeFile(authorizedKeys, await readFile(`${clientKey}.pub`), { mode: 0o600 })
  const port = await reservePort()
  const pidFile = path.join(root, 'sshd.pid')
  const sshdConfig = path.join(root, 'sshd_config')
  await writeFile(sshdConfig, [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${hostKey}`,
    `PidFile ${pidFile}`,
    `AuthorizedKeysFile ${authorizedKeys}`,
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'ChallengeResponseAuthentication no',
    'UsePAM no',
    'PermitRootLogin no',
    'AllowTcpForwarding yes',
    'PermitOpen 127.0.0.1:*',
    'StrictModes no',
    'LogLevel ERROR',
  ].join('\n'))
  const sshd = spawn(SSHD, ['-D', '-e', '-f', sshdConfig], { stdio: ['ignore', 'ignore', 'pipe'] })
  await waitForPort(port, true)
  const knownHosts = path.join(ssh, 'known_hosts')
  const hostPublic = (await readFile(`${hostKey}.pub`, 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
  await writeFile(knownHosts, `[127.0.0.1]:${port} ${hostPublic}\n`, { mode: 0o600 })
  const config = path.join(ssh, 'config')
  const user = process.env.USER
  await writeFile(config, [
    'Host fixture-target',
    '  HostName 127.0.0.1',
    `  Port ${port}`,
    `  User ${user}`,
    `  IdentityFile ${clientKey}`,
    '  IdentitiesOnly yes',
    `  UserKnownHostsFile ${knownHosts}`,
    '  StrictHostKeyChecking yes',
    'Host fixture-jump',
    '  HostName jump.invalid',
    '  User jump-user',
    'Host fixture-via-jump',
    '  HostName target.invalid',
    '  User target-user',
    '  ProxyJump fixture-jump',
    '',
  ].join('\n'), { mode: 0o600 })
  return { root, sshd, port, config, knownHosts }
}

test('system OpenSSH alias resolves and authenticates only in BatchMode', async t => {
  const f = await fixture()
  t.after(async () => { await stop(f.sshd); await rm(f.root, { recursive: true, force: true }) })
  const args = identityProbeArgs({ configFile: f.config, alias: 'fixture-target' })
  assert.deepEqual(args.slice(0, 4), ['-F', f.config, '-o', 'BatchMode=yes'])
  const result = run(SSH, args)
  assert.equal(result.status, 0, result.stderr)
  assert.throws(() => identityProbeArgs({ configFile: f.config, alias: '-oProxyCommand=bad' }), /invalid SSH alias/)
})

test('unknown host key fails closed without interactive confirmation', async t => {
  const f = await fixture()
  t.after(async () => { await stop(f.sshd); await rm(f.root, { recursive: true, force: true }) })
  await writeFile(f.knownHosts, '', { mode: 0o600 })
  const result = run(SSH, identityProbeArgs({ configFile: f.config, alias: 'fixture-target' }))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Host key verification failed|No ED25519 host key is known/)
})

test('ProxyJump and alias configuration are delegated to system OpenSSH', async t => {
  const f = await fixture()
  t.after(async () => { await stop(f.sshd); await rm(f.root, { recursive: true, force: true }) })
  const result = run(SSH, ['-F', f.config, '-G', '--', 'fixture-via-jump'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^hostname target\.invalid$/m)
  assert.match(result.stdout, /^user target-user$/m)
  assert.match(result.stdout, /^proxyjump fixture-jump$/m)
})

test('loopback tunnel forwards traffic and cleanup closes only its owned listener', async t => {
  const f = await fixture()
  const echoPort = await reservePort()
  const localPort = await reservePort()
  const echo = createServer(socket => socket.pipe(socket))
  await new Promise((resolve, reject) => echo.listen(echoPort, '127.0.0.1', error => error ? reject(error) : resolve()))
  const args = tunnelArgs({ configFile: f.config, alias: 'fixture-target', localPort, remotePort: echoPort })
  assert.ok(args.includes('ExitOnForwardFailure=yes'))
  assert.ok(args.includes('ServerAliveInterval=15'))
  assert.ok(args.includes('ServerAliveCountMax=3'))
  assert.ok(args.includes(`127.0.0.1:${localPort}:127.0.0.1:${echoPort}`))
  const tunnel = spawn(SSH, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  t.after(async () => {
    await stop(tunnel)
    await stop(f.sshd)
    await new Promise(resolve => echo.close(resolve))
    await rm(f.root, { recursive: true, force: true })
  })
  await waitForPort(localPort, true)
  const echoed = await new Promise((resolve, reject) => {
    const socket = new SocketClass()
    socket.once('error', reject)
    socket.once('data', data => { socket.destroy(); resolve(data.toString('utf8')) })
    socket.connect(localPort, '127.0.0.1', () => socket.write('fixture-ping'))
  })
  assert.equal(echoed, 'fixture-ping')
  await stop(tunnel)
  await waitForPort(localPort, false)
  assert.equal(f.sshd.exitCode, null)
})

test('ExitOnForwardFailure rejects an occupied local port', async t => {
  const f = await fixture()
  const occupiedPort = await reservePort()
  const occupied = createServer()
  await new Promise((resolve, reject) => occupied.listen(occupiedPort, '127.0.0.1', error => error ? reject(error) : resolve()))
  t.after(async () => {
    await stop(f.sshd)
    await new Promise(resolve => occupied.close(resolve))
    await rm(f.root, { recursive: true, force: true })
  })
  const result = run(SSH, tunnelArgs({ configFile: f.config, alias: 'fixture-target', localPort: occupiedPort, remotePort: 9 }))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Address already in use|cannot listen to port/)
})
