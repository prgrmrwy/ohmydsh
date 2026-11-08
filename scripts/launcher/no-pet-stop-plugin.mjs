import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensurePrivateDirectories, assertPrivatePaths, secureNewPrivateFile } from './private-files.mjs'
import known from './no-pet-known-modules.json' with { type: 'json' }

export const name = 'launcher-no-pet-stop'
export const inject = ['loader', 'connection', 'webServer', 'profileContext']
const ACTIVE = 2 // Cordis FiberState is a compile-time const enum.
const CARRIER = Symbol.for('cordis.group')
const staticModules = new Set(known.modules)
const self = import.meta.url
// Removed entries can still be disposing outside Loader.entries(). A Host that
// exposed Pet or an unknown carrier cannot later downgrade to a noPet proof.
const uncertainRoots = new WeakSet()
const isPet = name => /(?:^|[/@])dsh-pet(?:[/@.]|$)/i.test(name)
const reject = () => { throw new Error('noPet runtime cannot be certified') }
const unknownName = name => isPet(name) || (!staticModules.has(name) && ![self, 'cordis:include', '@deepseek-ai/cordis-plugin-include', 'cordis:group'].includes(name))

// Only the pinned official roster is understood. Unknown plugins can mount
// arbitrary hidden compositions; package-name prefixes cannot certify them.
function checkRows(rows) {
  if (!Array.isArray(rows)) reject()
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || isPet(row.name)) reject()
    if (row.name === 'cordis:group' && row.group === true) checkRows(row.config)
    else if (row.name === '@deepseek-ai/dsh-agent-preset') checkRows(row.config?.plugins)
    else if (!staticModules.has(row.name)) reject()
  }
}

function runtimeSnapshot(loader, presetMounts) {
  const trees = [loader, ...(presetMounts?.(loader.ctx.root.fiber) ?? []).map(mount => mount.tree)]
  if (trees.some(tree => tree.getTasks().length)) reject()
  const entries = trees.flatMap(tree => [...tree.entries()])
  if (entries.some(entry => unknownName(entry.options.name))) uncertainRoots.add(loader.ctx.root.fiber)
  if (uncertainRoots.has(loader.ctx.root.fiber)) reject()
  const seen = new Set(entries)
  const checkGroup = group => {
    if (!group || !Array.isArray(group.data)) reject()
    for (const row of group.data) {
      const child = group.tree.store[row.id]
      if (!seen.has(child) || child.options !== row || child.parent !== group) reject()
    }
  }
  for (const tree of trees) checkGroup(tree.root)
  for (const entry of entries) {
    const row = entry.options
    if (typeof row.name !== 'string' || isPet(row.name)) reject()
    const active = entry.fiber?.state === ACTIVE
    if (row.name === 'cordis:include' || row.name === '@deepseek-ai/cordis-plugin-include') {
      if (!active || !entry.subtree) reject()
      checkGroup(entry.subtree.root)
    } else if (row.name === 'cordis:group' && row.group === true) {
      if (!active || !entry.subgroup) reject()
      checkGroup(entry.subgroup)
    } else if (row.name === '@deepseek-ai/dsh-agent-preset') {
      if (!active) reject()
      checkRows(row.config?.plugins)
    } else {
      if (row.name !== self && !staticModules.has(row.name)) reject()
      if (!entry.disabled && !active) reject()
      if (entry.subtree || entry.subgroup || entry.fiber?.runtime?.callback?.[CARRIER]) reject()
    }
  }
  // Keep object identities as well as raw options and lifecycle states: an HMR
  // replacement with identical text must still invalidate an existing ticket.
  return { entries, fibers: entries.map(e => e.fiber), text: JSON.stringify(entries.map(e => [e.id, e.options, e.disabled, e.fiber?.state])) }
}
function sameSnapshot(a, b) {
  return a.text === b.text && a.entries.length === b.entries.length && a.entries.every((e, i) => e === b.entries[i] && a.fibers[i] === b.fibers[i])
}
function publish(home, port, descriptor) {
  const run = path.join(home, 'run')
  const dir = path.join(run, 'dsh-pet-stop')
  const boundaries = [{ path: run, type: 'directory', exact: false }, { path: dir, type: 'directory', exact: true }]
  ensurePrivateDirectories(boundaries)
  const file = path.join(dir, `${port}.json`)
  try { assertPrivatePaths([{ path: file, type: 'file' }]) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temp = path.join(dir, `${port}.${descriptor.bootId}.tmp`)
  const fd = fs.openSync(temp, 'wx', 0o600)
  try {
    secureNewPrivateFile(temp)
    fs.writeFileSync(fd, JSON.stringify(descriptor))
  } finally { fs.closeSync(fd) }
  // Both names are confined to the verified private directory.
  fs.renameSync(temp, file)
  const stat = fs.lstatSync(file)
  return () => {
    try {
      assertPrivatePaths([...boundaries, { path: file, type: 'file' }])
      const current = fs.lstatSync(file)
      if (current.dev === stat.dev && current.ino === stat.ino) fs.unlinkSync(file)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Standard Cordis plugin: certify absence only after the official boot commits. */
export function apply(ctx, config) {
  const ready = ctx.get('appReady')
  if (!ready || ctx.profileContext.name !== 'web' || config?.dshVersion !== known.dshVersion) return
  const bootId = randomUUID()
  let ticket, release, retired = false, epoch = 0
  const invalidate = () => { epoch++; ticket = undefined }
  const retire = () => {
    invalidate()
    if (!release) return
    retired = true
    release()
    release = undefined
  }
  // Withdraw before a newly added/reloaded Pet can register its own route.
  ctx.on('loader/entry-init', retire, { global: true })
  ctx.on('loader/partial-dispose', (entry, legacy) => {
    if (unknownName(entry.options.name) || (legacy?.name && unknownName(legacy.name))) uncertainRoots.add(ctx.root.fiber)
    retire()
  }, { global: true })
  ctx.on('internal/plugin', fiber => {
    if (fiber.entry && unknownName(fiber.entry.options.name)) uncertainRoots.add(ctx.root.fiber)
    invalidate()
  }, { global: true })
  ctx.on('internal/status', invalidate, { global: true })
  ctx.on('loader/volatile-update', invalidate, { global: true })
  const dynamicChanged = () => { uncertainRoots.add(ctx.root.fiber); retire() }
  ctx.on('cordis/dynamic-package', dynamicChanged, { global: true })
  ctx.on('cordis/dynamic-retract', dynamicChanged, { global: true })
  const install = async () => {
    if (ctx.fiber.state !== ACTIVE || retired) return
    // Read after full boot: a nested include can introduce the registry later
    // than this plugin. Its public export also covers retained preset revisions.
    const registry = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-preset-registry')
    let presetMounts
    if (registry) {
      const exports = await registry.parent.tree.import(registry.options.name)
      if (typeof exports.livePresetMounts !== 'function') return
      presetMounts = exports.livePresetMounts
    }
    if (ctx.fiber.state !== ACTIVE || retired) return
    const checkDynamic = entries => {
      // Dynamic Host halves are raw child fibers, outside the Loader trees.
      for (const entry of entries) {
        if (entry.options.name !== '@deepseek-ai/dsh-cordis-host-runner' || entry.disabled) continue
        const runner = entry.fiber.ctx.get('dynamicCordisRunner')
        if (!runner) reject()
        if (runner.inventory().length) { uncertainRoots.add(ctx.root.fiber); reject() }
      }
    }
    const certify = async () => {
      const generation = epoch
      const before = runtimeSnapshot(ctx.loader, presetMounts)
      checkDynamic(before.entries)
      for (const entry of before.entries) {
        if (entry.options.name !== '@deepseek-ai/dsh-agent-preset-registry' || entry.disabled) continue
        const presets = entry.fiber.ctx.get('agentPresets')
        if (!presets || (await presets.compositionInventory()).some(preset => preset.broken !== undefined)) reject()
      }
      const after = runtimeSnapshot(ctx.loader, presetMounts)
      checkDynamic(after.entries)
      if (generation !== epoch || !sameSnapshot(before, after)) reject()
      return after
    }
    try { await certify() } catch { return }
    if (ctx.fiber.state !== ACTIVE || retired) return
    const port = ctx.webServer.port
    const origin = `http://127.0.0.1:${port}`
    const descriptor = { v: 1, pid: process.pid, bootId, profile: 'web', origin, authenticatedUrl: ctx.connection.authenticatedUrl(origin) }
    const unregister = ctx.webServer.register({ kind: 'exact', path: '/dsh-pet/api/prepare-stop', handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) { json(res, rejection, { ok: false }); return }
      if (req.headers.host !== new URL(origin).host || req.headers.origin !== origin) { json(res, 403, { ok: false }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      try {
        const chunks = []; let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 4096) { json(res, 413, { ok: false }); return }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const keys = ['v', 'action', 'nonce', 'expectedHostPid', 'expectedBootId', 'deadlineAt']
        if (!body || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(k => !keys.includes(k)) || body.v !== 1 || !['prepare', 'status', 'resume'].includes(body.action) || typeof body.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) || body.expectedHostPid !== process.pid || body.expectedBootId !== bootId || !Number.isSafeInteger(body.deadlineAt) || body.deadlineAt <= Date.now()) { json(res, 400, { ok: false }); return }
        const snapshot = await certify()
        if (retired || body.deadlineAt <= Date.now()) reject()
        if (ticket && ticket.expiresAt <= Date.now()) ticket = undefined
        if (ticket && ticket.nonce !== body.nonce) { json(res, 409, { ok: false }); return }
        if (body.action === 'resume') ticket = undefined
        if (body.action === 'prepare' && !ticket) ticket = { nonce: body.nonce, preparedAt: Date.now(), expiresAt: Math.min(body.deadlineAt, Date.now() + 30000), snapshot }
        if (ticket && !sameSnapshot(ticket.snapshot, snapshot)) reject()
        json(res, 200, { ok: true, data: { v: 1, nonce: body.nonce, hostPid: process.pid, bootId, phase: ticket ? 'prepared' : 'active', operationNonce: ticket?.nonce ?? null, ...(ticket ? { preparedAt: ticket.preparedAt, expiresAt: ticket.expiresAt } : {}) } })
      } catch { ticket = undefined; json(res, 409, { ok: false }) }
    } })
    try {
      const removeDescriptor = publish(ctx.profileContext.home, port, descriptor)
      release = () => { unregister(); removeDescriptor() }
    } catch (error) { unregister(); throw error }
  }
  ctx.effect(() => ready.onReady(() => {
    // onReady is immediate during HMR; wait outside apply's promise so the
    // Loader can settle this new fiber before certifying the complete tree.
    void ctx.loader.await().then(install).catch(() => ctx.logger.warn('launcher stop protocol unavailable'))
  }))
  ctx.effect(() => retire)
}
