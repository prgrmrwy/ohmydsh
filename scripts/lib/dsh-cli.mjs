// scripts/lib/dsh-cli.mjs — exact-version DSH CLI resolution and execution.
//
// Cache hits are always executed directly. Provisioning is a last resort and is
// bounded. Temporary compatibility policy: @deepseek-ai/dsh@0.1.1-rc.2 skips
// npm/libnpmexec by default because its prerelease peer graph can hang inside
// Arborist. Remove the single policy entry (and its regression tests) after an
// isolated cold npx install, consecutive builds and repeated restarts are stable.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const BOUNDED_RUNNER = fileURLToPath(new URL('./run-bounded.mjs', import.meta.url))
const DEFAULT_PROVISION_TIMEOUT_MS = 180_000
const DEFAULT_KILL_GRACE_MS = 2_000
const DEFAULT_LOCK_WAIT_MS = 190_000
const LOCK_POLL_MS = 100

/** One centralized, temporary workaround table. Exact specs only. */
export const TEMPORARY_PROVISION_POLICIES = Object.freeze({
  '@deepseek-ai/dsh@0.1.1-rc.2': Object.freeze({
    defaultOrder: Object.freeze(['pnpm']),
    reason: 'temporary rc.2 npm/libnpmexec Arborist hang workaround',
    removeAfter: 'isolated cold npx install + consecutive build + repeated restart pass within timeout',
  }),
})

function envTruthy(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value ?? '').trim())
}

/** Determine channels after both exact-version caches miss. */
export function provisionOrderFor(spec, env = process.env) {
  const policy = TEMPORARY_PROVISION_POLICIES[spec]
  if (policy === undefined) return { channels: ['npx', 'pnpm'], temporary: false, override: false }
  const override = envTruthy(env.DSH_ALLOW_NPX_PROVISION)
  return {
    channels: override ? ['npx', 'pnpm'] : [...policy.defaultOrder],
    temporary: true,
    override,
    reason: policy.reason,
  }
}

/** npm 11 libnpmexec cache key. */
export function computeNpxCacheKey(packages) {
  const input = [...packages].sort((a, b) => a.localeCompare(b, 'en')).join('\n')
  return crypto.createHash('sha512').update(input).digest('hex').slice(0, 16)
}

export function npxCacheDirOf(env = process.env) {
  const cache = env.npm_config_cache || path.join(os.homedir(), '.npm')
  return path.join(cache, '_npx')
}

export function dshBinOf(dir) {
  return path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

export function serverBinFrom(resolved) {
  return resolved.bin
}

export function npxBinPathOf(spec, npxCacheDir) {
  return path.join(npxCacheDir, computeNpxCacheKey([spec]), dshBinOf('.'))
}

export function pnpmCliBaseOf(env = process.env) {
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, 'ohmydsh', 'dsh-cli')
}

function installEnv(env = process.env) {
  if (env.npm_config_registry || env.NPM_CONFIG_REGISTRY) return env
  return { ...env, npm_config_registry: 'https://registry.npmjs.org/' }
}

/**
 * Run one installer through a short-lived supervisor that owns a process group.
 * Exit code 124 means timeout; stderr carries the child/supervisor diagnostics.
 */
export function runBoundedProvision(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const request = JSON.stringify({ command, args, cwd, timeoutMs, killGraceMs })
  const result = spawnSync(process.execPath, [BOUNDED_RUNNER], {
    cwd,
    env,
    input: request,
    stdio: ['pipe', options.stdout ?? 'inherit', options.stderr ?? 'inherit'],
    encoding: 'utf8',
  })
  return {
    ok: result.status === 0,
    timedOut: result.status === 124,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

function probeNpxInstall(spec, options) {
  return options.runner('npx', ['-y', spec, '--version'], {
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs,
    env: installEnv(options.env),
  })
}

function sleepSync(ms) {
  const cell = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(cell, 0, 0, ms)
}

function lockOwnerAlive(lockDir) {
  try {
    const value = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
    if (!Number.isSafeInteger(value.pid) || value.pid < 1) return false
    process.kill(value.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function acquireProvisionLock(lockDir, readyBin, options) {
  const started = Date.now()
  while (true) {
    // Re-check the product before claiming a lock: the prior owner publishes the
    // final directory before removing its lock, and a waiter may observe the
    // small window immediately after lock removal.
    if (existsSync(readyBin)) return 'ready'
    try {
      mkdirSync(lockDir, { recursive: false })
      writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
      return 'owner'
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    if (existsSync(readyBin)) return 'ready'
    let stale = false
    try {
      stale = Date.now() - statSync(lockDir).mtimeMs > options.lockWaitMs && !lockOwnerAlive(lockDir)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (stale) {
      rmSync(lockDir, { recursive: true, force: true })
      continue
    }
    if (Date.now() - started >= options.lockWaitMs) return 'timeout'
    sleepSync(Math.min(LOCK_POLL_MS, options.lockWaitMs))
  }
}

function probePnpmInstall(spec, finalDir, options) {
  const readyBin = dshBinOf(finalDir)
  if (existsSync(readyBin)) return { ok: true, cached: true }
  const parent = path.dirname(finalDir)
  mkdirSync(parent, { recursive: true })
  const lockDir = `${finalDir}.lock`
  const ownership = acquireProvisionLock(lockDir, readyBin, options)
  if (ownership === 'ready') return { ok: true, cached: true }
  if (ownership === 'timeout') return { ok: false, timedOut: true, channel: 'pnpm-lock' }

  const staging = `${finalDir}.staging-${process.pid}-${crypto.randomBytes(5).toString('hex')}`
  try {
    mkdirSync(staging, { recursive: true })
    const result = options.runner('pnpm', ['add', spec, '--reporter=append-only'], {
      cwd: staging,
      timeoutMs: options.timeoutMs,
      killGraceMs: options.killGraceMs,
      env: installEnv(options.env),
    })
    if (!result.ok || !existsSync(dshBinOf(staging))) return { ...result, ok: false, channel: 'pnpm' }
    if (existsSync(readyBin)) return { ok: true, cached: true }
    // Only an invalid cache directory may be replaced; a valid winner always wins.
    rmSync(finalDir, { recursive: true, force: true })
    renameSync(staging, finalDir)
    return { ok: existsSync(readyBin), cached: false, channel: 'pnpm' }
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(lockDir, { recursive: true, force: true })
  }
}

function reportProvisionFailure({ spec, pnpmDir, npxRoot, order, failures }) {
  const details = failures.map(item => `${item.channel}:${item.timedOut ? 'timeout' : `exit-${item.status ?? 'failed'}`}`).join(', ')
  console.error(`error: DSH runtime provision failed for exact pin ${spec}`)
  console.error(`       attempted=${order.join(' -> ') || 'none'}; results=${details || 'none'}`)
  console.error(`       npx-cache=${npxRoot}`)
  console.error(`       pnpm-cache=${pnpmDir}`)
  console.error('       retry after checking network/registry; diagnostic escape hatch: DSH_ALLOW_NPX_PROVISION=1 dsh ...')
}

/** Resolve an exact DSH CLI without silently changing version. */
export function resolveCliBin({
  spec,
  version,
  dshBinEnv,
  npxCacheDir,
  pnpmCacheBase,
  installProbe = true,
  env = process.env,
  provisionRunner = runBoundedProvision,
  provisionTimeoutMs = DEFAULT_PROVISION_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
  diagnose = true,
}) {
  if (dshBinEnv) return { kind: 'env', bin: dshBinEnv }
  const npxRoot = npxCacheDir ?? npxCacheDirOf(env)
  let npxBin = npxBinPathOf(spec, npxRoot)
  if (existsSync(npxBin)) return { kind: 'npx-cache', bin: npxBin }
  const pnpmBase = pnpmCacheBase ?? pnpmCliBaseOf(env)
  const pnpmDir = version ? path.join(pnpmBase, version) : pnpmBase
  const pnpmBin = dshBinOf(pnpmDir)
  if (existsSync(pnpmBin)) return { kind: 'pnpm-cache', bin: pnpmBin }
  if (!installProbe) return null

  const policy = provisionOrderFor(spec, env)
  if (policy.override && diagnose) {
    console.error(`warn: DSH_ALLOW_NPX_PROVISION=1 restores npx-first provisioning for ${spec}`)
  } else if (policy.temporary && diagnose) {
    console.error(`info: ${policy.reason}; skipping npx provision for ${spec}`)
  }
  const options = {
    runner: provisionRunner,
    timeoutMs: provisionTimeoutMs,
    killGraceMs,
    lockWaitMs,
    env,
  }
  const failures = []
  for (const channel of policy.channels) {
    if (channel === 'npx') {
      const result = probeNpxInstall(spec, options)
      if (!result.ok) failures.push({ ...result, channel })
      npxBin = npxBinPathOf(spec, npxRoot)
      if (result.ok && existsSync(npxBin)) return { kind: 'npx-cache', bin: npxBin }
      if (result.ok) failures.push({ channel, status: 'missing-bin', timedOut: false })
    } else {
      const result = probePnpmInstall(spec, pnpmDir, options)
      if (result.ok && existsSync(pnpmBin)) return { kind: 'pnpm-cache', bin: pnpmBin }
      failures.push(result)
    }
  }
  if (diagnose) reportProvisionFailure({ spec, pnpmDir, npxRoot, order: policy.channels, failures })
  return null
}

export function runDshCli(args, opts = {}) {
  const resolved = resolveCliBin(opts)
  if (!resolved) return false
  const stdio = opts.stdio ?? 'inherit'
  const result = resolved.kind === 'env'
    ? spawnSync(resolved.bin, args, { stdio })
    : spawnSync(process.execPath, [resolved.bin, ...args], { stdio })
  return result.status === 0
}
