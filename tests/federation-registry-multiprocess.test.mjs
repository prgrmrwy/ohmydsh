import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Cross-process registry safety.
 *
 * `NodeRegistryStorage` serializes writes with an in-process promise queue, so
 * the existing package test proves single-process CAS only. Two DSH processes
 * (for example an old Host that has not exited yet and a freshly started one)
 * share `$DSH_HOME/plugins/dsh-federation/nodes.json`, and there the queue does
 * not apply.
 *
 * The invariants that must hold regardless of interleaving:
 *   - the file is never left corrupt or partially written;
 *   - a generation is never silently skipped or duplicated;
 *   - a losing writer fails closed with CONFLICT rather than clobbering;
 *   - a reader never observes a torn file.
 *
 * Nothing touches `~/.dsh`.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

/**
 * One bundle exposing host + core, mirroring the deployed `lib/index.js`, which
 * re-exports both from relative paths (so error classes stay identical).
 */
function buildBundle(root) {
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-registry-mp-${process.pid}.mjs`)
  const entry = path.join(root, 'entry.ts')
  writeFileSync(entry, [
    `export * from ${JSON.stringify(path.join(PKG, 'src/core/index.ts'))}`,
    `export * from ${JSON.stringify(path.join(PKG, 'src/host/index.ts'))}`,
    '',
  ].join('\n'))
  const built = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--outfile=${bundle}`, '--log-level=error',
  ], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  return bundle
}

/** Runs one writer in a separate OS process and reports its outcome. */
function writerScript(bundle, home, generationFrom, delayMs) {
  return `
import { NodeRegistryStorage, NodeRegistryModel, parseNodeId } from ${JSON.stringify(pathToFileURL(bundle).href)}
const storage = new NodeRegistryStorage(${JSON.stringify(home)})
try {
  const loaded = await storage.load()
  const base = loaded.status === 'missing'
    ? NodeRegistryModel.create(parseNodeId('this-mac')).snapshot
    : loaded.snapshot
  const expected = ${generationFrom === 'missing' ? "'missing'" : generationFrom}
  // A create from "missing" must commit generation 0, so it saves the bare
  // initial snapshot; an update commits exactly expected + 1.
  const next = expected === 'missing'
    ? base
    : new NodeRegistryModel(base).addRemote({
      nodeId: parseNodeId(process.env.NODE_LABEL),
      displayName: process.env.NODE_LABEL,
      sshAlias: process.env.NODE_LABEL,
      remoteDshPort: 3080,
    })
  await storage.save(next, expected, {
    // Widen the CAS window so both processes overlap deliberately.
    beforeRename: () => new Promise(resolve => setTimeout(resolve, ${delayMs})),
  })
  console.log(JSON.stringify({ ok: true, generation: next.generation }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, name: error?.name ?? null }))
}
`
}

/**
 * Truly concurrent writers. `spawnSync` blocks the event loop, so it would
 * serialize the processes inside `Promise.all` and the race would never happen;
 * async `spawn` is required for real overlap.
 */
async function runWriters(root, bundle, home, generationFrom, labels, delays) {
  const scripts = await Promise.all(labels.map(async (label, index) => {
    const script = path.join(root, `writer-${label}.mjs`)
    await writeFile(script, writerScript(bundle, home, generationFrom, delays[index]))
    return { label, script }
  }))
  return Promise.all(scripts.map(({ label, script }) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, NODE_LABEL: label }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0) return reject(new Error(`${label} exited ${code}: ${stderr}`))
      try {
        resolve({ label, ...JSON.parse(stdout.trim().split('\n').at(-1)) })
      } catch (error) {
        reject(new Error(`${label} produced no outcome: ${stdout}${stderr}`))
      }
    })
  })))
}

test('two OS processes cannot corrupt or silently clobber the node registry', { timeout: 300_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-registry-mp-'))
  const home = path.join(root, 'dsh-home')
  const bundle = buildBundle(root)
  try {
    const { NodeRegistryStorage, parseRegistry } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)

    // Two independent processes both try to create generation 0 from "missing".
    const created = await runWriters(root, bundle, home, 'missing', ['vm-a', 'vm-b'], [400, 400])
    const winners = created.filter(outcome => outcome.ok)
    const losers = created.filter(outcome => !outcome.ok)

    // Whatever the interleaving, the file must be readable and well-formed.
    const storage = new NodeRegistryStorage(home)
    const loaded = await storage.load()
    assert.equal(loaded.status, 'loaded', 'the registry must exist and parse after concurrent creates')
    const raw = await readFile(storage.file, 'utf8')
    assert.doesNotThrow(() => parseRegistry(raw), 'the committed file must never be torn or partial')
    assert.equal(loaded.snapshot.generation, 0, 'a create must land exactly one generation 0')

    // The local identity is immutable and must be the only node at generation 0.
    assert.equal(loaded.snapshot.nodes.filter(node => node.kind === 'local').length, 1)
    assert.equal(loaded.snapshot.nodes.filter(node => node.kind === 'remote').length, 0)

    // At least one create must succeed, and any loser must fail closed.
    assert.ok(winners.length >= 1, JSON.stringify(created))
    for (const loser of losers) {
      assert.equal(loser.code, 'CONFLICT', `a losing creator must fail closed: ${JSON.stringify(loser)}`)
    }

    // Now both processes race an UPDATE from the same known generation. Exactly
    // one may win; the other must see CONFLICT, never overwrite.
    const updated = await runWriters(root, bundle, home, 0, ['vm-c', 'vm-d'], [400, 400])
    const updateWinners = updated.filter(outcome => outcome.ok)
    const updateLosers = updated.filter(outcome => !outcome.ok)
    assert.equal(updateWinners.length, 1, `exactly one update may commit: ${JSON.stringify(updated)}`)
    assert.equal(updateLosers.length, 1)
    assert.equal(updateLosers[0].code, 'CONFLICT',
      `the losing updater must fail closed: ${JSON.stringify(updateLosers[0])}`)

    const after = await storage.load()
    assert.equal(after.snapshot.generation, 1, 'exactly one generation increment may be recorded')
    const rawAfter = await readFile(storage.file, 'utf8')
    assert.doesNotThrow(() => parseRegistry(rawAfter))

    // No owned temp files may be left behind by the losing writer.
    assert.equal(await storage.cleanupOwnedTemps(), 0,
      'a failed concurrent write must not leave stale temp files')
  } finally {
    await rm(bundle, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
