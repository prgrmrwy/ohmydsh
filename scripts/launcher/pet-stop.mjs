import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { sameProcessIdentity } from './process.mjs'
import { assertPrivatePaths } from './private-files.mjs'

const PREPARE_MS = 30_000
const RECOVERY_MS = 5_000
const MAX_BYTES = 64 * 1024
const fail = code => new Error(`Pet prepare-stop: ${code}`)
const privateOwner = stat => process.getuid === undefined || stat.uid === process.getuid()
function readPrivateJson(home, name) {
  const run = path.join(home, 'run')
  const dir = path.join(run, 'dsh-pet-stop')
  const file = path.join(dir, name)
  // Ordered, batched validation proves existing boundaries even when a later
  // path is missing. An unsafe run directory must not become "no descriptor".
  assertPrivatePaths([{ path: run, type: 'directory', exact: false }, { path: dir, type: 'directory' }, { path: file, type: 'file' }])
  const before = fs.lstatSync(file)
  const privateStat = stat => process.platform === 'win32' || (privateOwner(stat) && (stat.mode & 0o777) === 0o600)
  if (!before.isFile() || before.isSymbolicLink() || !privateStat(before) || before.size > MAX_BYTES) throw fail('unsafe private file')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || !privateStat(stat) || stat.size > MAX_BYTES) throw fail('private file changed')
    return JSON.parse(fs.readFileSync(fd, 'utf8'))
  } finally { fs.closeSync(fd) }
}
function originUrl(origin, port) {
  const url = new URL(origin)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.origin !== origin || Number(url.port || 80) !== port) throw fail('invalid loopback origin')
  return url
}
function readDescriptor(home, port, initial, profile) {
  let doc
  try { doc = readPrivateJson(home, `${port}.json`) }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw fail('unreadable or unsafe descriptor') }
  // Validate the whole document first: a present-but-malformed descriptor
  // always refuses, whatever PID it names.
  try {
    if (doc?.v !== 1 || !Number.isSafeInteger(doc.pid) || doc.pid <= 0 || typeof doc.bootId !== 'string' || !doc.bootId.trim() || doc.profile !== profile) throw fail('descriptor Host mismatch')
    originUrl(doc.origin, port)
    const url = new URL(doc.authenticatedUrl)
    if (url.origin !== doc.origin || url.username || url.password || url.hash) throw fail('invalid authenticated URL')
  } catch { throw fail('invalid descriptor or Host mismatch') }
  // A well-formed descriptor left by another (crashed) boot describes no live
  // Host here and grants nothing; treat it as absent (stop proceeds without drain).
  if (doc.pid !== initial.processes[0].pid) return undefined
  return doc
}

// Direct HTTP ignores proxy configuration; credentials stay in this closure and
// response bodies/errors are never forwarded to launcher output or receipts.
function request(url, { method = 'GET', headers = {}, body, deadlineAt }) {
  return new Promise((resolve, reject) => {
    if (Date.now() >= deadlineAt) { reject(fail('request deadline expired')); return }
    let settled = false
    const finish = (error, result) => { if (!settled) { settled = true; clearTimeout(timer); error ? reject(error) : resolve(result) } }
    const req = http.request(url, { method, headers, agent: false,
      ...(url.hostname === 'localhost' ? { lookup: (_host, options, done) => options?.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4) } : {}),
    }, response => {
      const chunks = []; let size = 0
      response.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { finish(fail('response too large')); req.destroy() } else chunks.push(chunk) })
      response.on('end', () => finish(null, { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', () => finish(fail('response interrupted')))
    })
    const timer = setTimeout(() => { finish(fail('request timed out')); req.destroy() }, Math.max(1, deadlineAt - Date.now()))
    req.on('error', () => finish(fail('local request failed')))
    req.end(body)
  })
}
function cookieFrom(headers) {
  const values = headers['set-cookie']
  if (!Array.isArray(values) || !values.length) throw fail('authentication cookie missing')
  const pairs = values.map(value => value.split(';', 1)[0])
  if (pairs.some(value => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[\x21-\x3A\x3C-\x7E]+$/.test(value)) || pairs.join('; ').length > 8192) throw fail('invalid authentication cookie')
  return pairs.join('; ')
}
function authenticationCookie(auth, origin) {
  if (auth.status !== 303 || typeof auth.headers.location !== 'string') throw fail('authentication exchange requires 303')
  let location
  try { location = new URL(auth.headers.location, origin) } catch { throw fail('invalid authentication redirect') }
  if (location.origin !== origin || location.username || location.password) throw fail('cross-origin authentication redirect')
  return cookieFrom(auth.headers)
}
const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
function responseData(response, expected, phases) {
  let doc
  try { doc = JSON.parse(response.body) } catch { throw fail('invalid JSON response') }
  const data = doc?.data
  if (response.status < 200 || response.status >= 300 || doc?.ok !== true || data?.v !== 1 || data.nonce !== expected.nonce || data.hostPid !== expected.hostPid || data.bootId !== expected.bootId || !phases.includes(data.phase)) throw fail(`unverified response (HTTP ${response.status})`)
  if (data.operationNonce !== undefined && data.operationNonce !== null && data.operationNonce !== expected.nonce) throw fail('another preparation operation is active')
  return data
}
const completeIdentity = initial => initial?.state === 'owned' && initial.processes?.length === 1 && initial.processes.every(record => Number.isSafeInteger(record.pid) && record.pid > 0 && typeof record.created === 'string' && record.created && Array.isArray(record.argv) && record.argv.length > 0 && record.argv.every(arg => typeof arg === 'string') && typeof record.executable === 'string' && record.executable)

/** Confirm a replacement Host actually loaded the authenticated protocol, without preparing it. */
export async function verifyStopProtocol({ home, port, initial, probe, env, profile = 'web', deadlineAt = Date.now() + RECOVERY_MS }) {
  if (!completeIdentity(initial)) throw fail('complete replacement Host identity required')
  const bound = structuredClone(initial)
  const sameHost = async () => {
    const current = await probe(port, { env, deadline: deadlineAt })
    if (!completeIdentity(current) || !sameProcessIdentity(bound.processes[0], current.processes[0])) throw fail('replacement Host identity changed')
  }
  let descriptor
  while (Date.now() < deadlineAt) {
    await sameHost()
    descriptor = readDescriptor(home, port, bound, profile)
    if (descriptor) break
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadlineAt - Date.now()))))
  }
  if (!descriptor) throw fail('new Host protocol descriptor missing; protocol load not confirmed')
  const auth = await request(new URL(descriptor.authenticatedUrl), { deadlineAt })
  const cookie = authenticationCookie(auth, descriptor.origin)
  const expected = { nonce: randomBytes(16).toString('hex'), hostPid: descriptor.pid, bootId: descriptor.bootId }
  const response = await request(new URL('/dsh-pet/api/prepare-stop', descriptor.origin), { method: 'POST', deadlineAt,
    headers: { Cookie: cookie, Origin: descriptor.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, action: 'status', nonce: expected.nonce, expectedHostPid: expected.hostPid, expectedBootId: expected.bootId, deadlineAt }),
  })
  const data = responseData(response, expected, ['active'])
  if (data.operationNonce !== null) throw fail('replacement active status not confirmed')
  await sameHost()
}

/** Authenticate and drain only the Host captured by the caller before preparing. */
export async function preparePetStop({ home, port, initial, probe, env, profile = 'web', allowLegacyRestart = false, warn = console.error, deadlineAt = Date.now() + PREPARE_MS }) {
  if (initial?.state === 'empty') return { beforeSignal() {}, resume: async () => 'not-needed' }
  if (!completeIdentity(initial)) throw fail('complete single Host identity required; Host 未停止')
  initial = structuredClone(initial)
  const descriptor = readDescriptor(home, port, initial, profile)
  if (!descriptor) {
    // No descriptor: an old Host, or a Pet that never published one. Stopping
    // without drain is safe because Pet startup recovery settles leftovers
    // conservatively (finishing → unknown-terminal, no resend; unprovable →
    // manual). The only cost is that an in-flight reply may need a fresh @.
    // An INVALID descriptor still refuses (readDescriptor throws): a suspicious
    // file is not an absent one. `allowLegacyRestart` stays accepted for scripts.
    warn('此 Host 无 Pet 停止凭据，跳过 Pet 收尾直接停止；处理中的投递交由下次启动恢复处理（不会重发，可能需要重新 @）。')
    return { beforeSignal() {}, resume: async () => 'not-needed' }
  }
  const expected = { nonce: randomBytes(16).toString('hex'), hostPid: descriptor.pid, bootId: descriptor.bootId }
  let cookie, attempted = false
  const sameHost = async (until = deadlineAt) => {
    const current = await probe(port, { env, deadline: until })
    if (!completeIdentity(current) || !sameProcessIdentity(initial.processes[0], current.processes[0])) throw fail('Host identity changed')
  }
  const send = async (action, until) => {
    await sameHost(until)
    const response = await request(new URL('/dsh-pet/api/prepare-stop', descriptor.origin), { method: 'POST', deadlineAt: until,
      headers: { Cookie: cookie, Origin: descriptor.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, action, nonce: expected.nonce, expectedHostPid: expected.hostPid, expectedBootId: expected.bootId, deadlineAt: until }),
    })
    await sameHost(until)
    return response
  }
  const resume = async () => {
    if (!cookie || !attempted) return 'not-needed'
    const until = Date.now() + RECOVERY_MS
    try {
      const data = responseData(await send('resume', until), expected, ['active', 'preparing', 'prepared', 'failed'])
      if (data.phase === 'active') return 'resumed'
      const status = responseData(await send('status', until), expected, ['active', 'preparing', 'prepared', 'failed'])
      return status.phase === 'active' ? 'resumed' : 'pending'
    } catch { return 'pending' }
  }
  try {
    await sameHost()
    const auth = await request(new URL(descriptor.authenticatedUrl), { deadlineAt })
    cookie = authenticationCookie(auth, descriptor.origin)
    attempted = true
    const requestedAt = Date.now()
    const prepared = responseData(await send('prepare', deadlineAt), expected, ['prepared'])
    const preparedAt = timestamp(prepared.preparedAt), expiresAt = timestamp(prepared.expiresAt)
    if (!Number.isFinite(preparedAt) || !Number.isFinite(expiresAt) || preparedAt < requestedAt || preparedAt > Date.now() || preparedAt > expiresAt || expiresAt > deadlineAt || expiresAt <= Date.now()) throw fail('expired or invalid prepared ticket')
    const beforeSignal = async () => {
      if (Date.now() >= expiresAt || Date.now() >= deadlineAt) throw fail('prepared ticket expired')
      const status = responseData(await send('status', Math.min(expiresAt, deadlineAt)), expected, ['prepared'])
      if (status.operationNonce !== expected.nonce || timestamp(status.preparedAt) !== preparedAt || timestamp(status.expiresAt) !== expiresAt || Date.now() >= expiresAt) throw fail('prepared status no longer matches ticket')
    }
    return { beforeSignal, resume }
  } catch (error) {
    const recovery = await resume()
    throw fail(`${error.message.startsWith('Pet prepare-stop: ') ? error.message.slice(18) : 'handshake failed'}; Host 未停止${recovery === 'pending' ? '；Pet 仍在维护中或恢复未确认（drain pending）' : recovery === 'resumed' ? '；Pet 已恢复' : ''}`)
  }
}
