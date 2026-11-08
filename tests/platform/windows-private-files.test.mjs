import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ensurePrivateDirectories, assertPrivatePaths, secureNewPrivateFile } from '../../scripts/launcher/private-files.mjs'
import { noPetStopPatch } from '../../scripts/launcher/no-pet-stop-profile.mjs'
import { apply as noPetPlugin } from '../../scripts/launcher/no-pet-stop-plugin.mjs'
import { preparePetStop } from '../../scripts/launcher/pet-stop.mjs'
import { publishStopDescriptor, releaseStopDescriptor } from '../../packages/dsh-pet/lib/host/locus/stop-preparation.js'

// This suite is selected only on native Windows. It changes real ACLs on owned
// temporary fixtures; POSIX chmod or mocked stat.mode cannot verify this contract.
assert.equal(process.platform, 'win32', 'native Windows ACL suite requires Win32')
const root = path.resolve(import.meta.dirname, '../..')
const aclScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$directory = ([System.IO.File]::GetAttributes($r.path) -band [System.IO.FileAttributes]::Directory) -ne 0
function Read-Acl {
  if ($directory) { return [System.IO.Directory]::GetAccessControl($r.path) }
  return [System.IO.File]::GetAccessControl($r.path)
}
function Write-Acl($value) {
  if ($directory) { [System.IO.Directory]::SetAccessControl($r.path, $value) }
  else { [System.IO.File]::SetAccessControl($r.path, $value) }
}
$a = Read-Acl
if ($r.action -eq 'grant') {
  $sid = [System.Security.Principal.SecurityIdentifier]::new([string]$r.sid)
  $rights = [System.Security.AccessControl.FileSystemRights]$r.rights
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
  if ($r.inherit) { $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  $a.AddAccessRule($rule)
  Write-Acl $a
} elseif ($r.action -eq 'inherit') {
  $a.SetAccessRuleProtection($false, $true)
  Write-Acl $a
} elseif ($r.action -ne 'inspect') { throw 'unknown fixture action' }
$a = Read-Acl
$rules = @($a.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
@{ sddl = $a.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::All); inherited = @($rules | Where-Object { $_.IsInherited }).Count } | ConvertTo-Json -Compress
`
function acl(request) {
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', aclScript], { input: JSON.stringify(request), encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim())
}
function home(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'private-files 中文 &; '))
  t.after(() => {
    assert.equal(path.dirname(directory), os.tmpdir())
    assert(path.basename(directory).startsWith('private-files 中文 &; '))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}
async function fixture(t, producer = 'pet') {
  const directory = home(t)
  let requests = 0, prepared, route
  const server = http.createServer(async (req, res) => {
    requests++
    if (req.method === 'GET') { res.writeHead(303, { Location: '/', 'Set-Cookie': 'fixture=authenticated; HttpOnly' }); res.end(); return }
    if (route) { await route.handler(req, res); return }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    if (body.action === 'prepare') prepared = { operationNonce: body.nonce, preparedAt: Date.now(), expiresAt: body.deadlineAt }
    if (body.action === 'resume') prepared = undefined
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, data: { v: 1, nonce: body.nonce, hostPid: process.pid, bootId: 'fixture-boot-identity', phase: prepared ? 'prepared' : 'active', operationNonce: null, ...prepared } }))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const descriptor = { v: 1, pid: process.pid, bootId: 'fixture-boot-identity', profile: 'web', origin, authenticatedUrl: `${origin}/?token=fixture-only` }
  const cleanups = []
  if (producer === 'pet') await publishStopDescriptor(directory, port, descriptor)
  else {
    const fiber = { state: 2 }, loader = { root: { data: [], tree: { store: {} } }, getTasks: () => [], entries: () => [], await: async () => {} }
    loader.ctx = { root: { fiber } }
    const ctx = {
      fiber, root: { fiber }, loader, profileContext: { name: 'web', home: directory },
      get: name => name === 'appReady' ? { onReady: callback => { callback(); return () => {} } } : undefined,
      on() {}, effect(callback) { const dispose = callback(); if (typeof dispose === 'function') cleanups.push(dispose) },
      connection: { authenticatedUrl: () => descriptor.authenticatedUrl, requestRejection: () => undefined },
      webServer: { port, register(value) { route = value; return () => { route = undefined } } },
      logger: { warn() {} },
    }
    const known = JSON.parse(fs.readFileSync(path.join(root, 'scripts/launcher/no-pet-known-modules.json')))
    noPetPlugin(ctx, { dshVersion: known.dshVersion })
    t.after(() => { for (const dispose of cleanups.reverse()) dispose() })
    const deadline = Date.now() + 15000
    while (!fs.existsSync(path.join(directory, 'run/dsh-pet-stop', `${port}.json`)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    assert(fs.existsSync(path.join(directory, 'run/dsh-pet-stop', `${port}.json`)), 'noPet publisher produced no private descriptor')
  }
  const initial = { state: 'owned', processes: [{ pid: process.pid, created: 'fixture-created', executable: process.execPath, argv: [process.execPath, 'fixture-web.mjs'] }] }
  return { home: directory, port, descriptor, file: path.join(directory, 'run/dsh-pet-stop', `${port}.json`), requests: () => requests,
    prepare: () => preparePetStop({ home: directory, port, initial, probe: async () => initial }) }
}

for (const producer of ['pet', 'noPet']) test(`${producer} publishes a real private Windows descriptor usable by the launcher`, async t => {
  const f = await fixture(t, producer)
  assertPrivatePaths([{ path: path.join(f.home, 'run'), type: 'directory', exact: false }, { path: path.dirname(f.file), type: 'directory', exact: true }, { path: f.file, type: 'file' }])
  const operation = await f.prepare()
  await operation.beforeSignal()
  assert.equal(await operation.resume(), 'resumed')
  assert(f.requests() >= 4)
  if (producer === 'pet') {
    await publishStopDescriptor(f.home, f.port, { ...f.descriptor, bootId: 'replacement-boot-identity' })
    await releaseStopDescriptor(f.home, f.port, f.descriptor.bootId)
    assert.equal(JSON.parse(fs.readFileSync(f.file)).bootId, 'replacement-boot-identity')
    await releaseStopDescriptor(f.home, f.port, 'replacement-boot-identity')
    assert.equal(fs.existsSync(f.file), false)
  }
})

test('managed patch supports Unicode and shell metacharacters and refuses actual outsider ACLs', t => {
  const directory = home(t)
  const file = noPetStopPatch(directory, root, 'fixture-version')
  assertPrivatePaths([{ path: file, type: 'file' }])
  assert.equal(noPetStopPatch(directory, root, 'fixture-version'), file)
  const privateDir = path.dirname(file)
  acl({ path: privateDir, action: 'grant', sid: 'S-1-1-0', rights: 'ReadAndExecute', inherit: true })
  const before = acl({ path: privateDir, action: 'inspect' }).sddl
  assert.throws(() => noPetStopPatch(directory, root, 'fixture-version'), /unsafe|private|ACL|permission/i)
  assert.equal(acl({ path: privateDir, action: 'inspect' }).sddl, before, 'unsafe existing ACL must not be repaired')
})

for (const entry of [
  { target: 'file', sid: 'S-1-1-0', rights: 'Read', inherited: false },
  { target: 'file', sid: 'S-1-5-11', rights: 'Read', inherited: true },
  { target: 'directory', sid: 'S-1-1-0', rights: 'ReadAndExecute', inherited: false },
  { target: 'run', sid: 'S-1-5-11', rights: 'Write, Delete, ChangePermissions', inherited: false },
]) test(`unsafe ${entry.target} ${entry.inherited ? 'inherited' : 'explicit'} ACL refuses before authentication or stop`, async t => {
  const f = await fixture(t)
  const target = entry.target === 'file' ? f.file : entry.target === 'directory' ? path.dirname(f.file) : path.join(f.home, 'run')
  if (entry.inherited) {
    acl({ path: path.dirname(target), action: 'grant', sid: entry.sid, rights: entry.rights, inherit: true })
    assert(acl({ path: target, action: 'inherit' }).inherited > 0)
  } else acl({ path: target, action: 'grant', sid: entry.sid, rights: entry.rights, inherit: false })
  const before = acl({ path: target, action: 'inspect' }).sddl
  assert.throws(() => assertPrivatePaths([{ path: target, type: entry.target === 'file' ? 'file' : 'directory', exact: entry.target !== 'run' }]), /unsafe|private|ACL|permission/i)
  let signals = 0
  await assert.rejects(async () => { const operation = await f.prepare(); await operation.beforeSignal(); signals++ }, /unsafe|private|descriptor/i)
  assert.equal(signals, 0)
  assert.equal(f.requests(), 0)
  await assert.rejects(() => publishStopDescriptor(f.home, f.port, f.descriptor), /unsafe|private|ACL|permission/i)
  await releaseStopDescriptor(f.home, f.port, f.descriptor.bootId)
  assert.equal(fs.existsSync(f.file), true, 'best-effort release must leave an unsafe boundary untouched')
  assert.equal(acl({ path: target, action: 'inspect' }).sddl, before)
})

test('safe inherited file ACL is accepted; junction targets are never changed', t => {
  const directory = home(t), run = path.join(directory, 'run'), privateDir = path.join(run, 'private')
  ensurePrivateDirectories([{ path: run, exact: false }, { path: privateDir, exact: true }])
  const file = path.join(privateDir, 'file.json')
  fs.writeFileSync(file, '{}', { flag: 'wx', mode: 0o600 })
  secureNewPrivateFile(file)
  assert(acl({ path: file, action: 'inherit' }).inherited > 0)
  assertPrivatePaths([{ path: file, type: 'file' }])
  const target = path.join(directory, 'other'), linked = path.join(directory, 'linked')
  fs.mkdirSync(target)
  fs.symlinkSync(target, linked, 'junction')
  assert.throws(() => ensurePrivateDirectories([{ path: linked, exact: true }]), /unsafe|private|reparse|directory/i)
  assert.deepEqual(fs.readdirSync(target), [])
})

test('missing Windows ACL tool fails closed without creating a directory', t => {
  const directory = home(t), target = path.join(directory, 'uncreated')
  // Node itself needs the real SystemRoot during Windows startup. Change only
  // the helper lookup after the isolated child has loaded its Node bindings.
  const code = 'const {ensurePrivateDirectories}=await import(process.argv[1]);const saved=process.env.SystemRoot;process.env.SystemRoot=process.argv[3];try{ensurePrivateDirectories([{path:process.argv[2],exact:true}]);process.exitCode=7}catch{process.exitCode=0}finally{process.env.SystemRoot=saved}'
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, pathToFileURL(path.join(root, 'scripts/launcher/private-files.mjs')).href, target, path.join(directory, 'missing-system')], { env: { ...process.env }, shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.equal(fs.existsSync(target), false)
})
