/*
 * Retrieval runner API: createRunDirectory({home, libraryRoot, runId}) creates an
 * exclusive 0700 run directory under $HOME/.dsh-memex-eval/retrieval and returns
 * runDir/snapshotDir/reportDir. readLibraryFiles(root, ops?) returns the validated
 * source files keyed by safe relative path; the injectable open operation lets
 * tests prove rejection occurs before opening a symlink target. assertUniqueSlugs
 * rejects distractor collisions with source cards or selected gold targets.
 */
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, readlinkSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export interface ReadOps {
  lstat?: typeof lstatSync
  readdir?: typeof readdirSync
  open?: (path: string, flags: number) => number
  fstat?: typeof fstatSync
  read?: typeof readFileSync
  close?: typeof closeSync
}
export interface RunDirectory { runDir: string; snapshotDir: string; reportDir: string }
const defaultOps = { lstat: lstatSync, readdir: readdirSync, open: openSync, fstat: fstatSync, read: readFileSync, close: closeSync }

function pathChain(path: string): string[] {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const rest = absolute.slice(root.length).split(sep).filter(Boolean)
  const chain = [root]
  for (const part of rest) chain.push(join(chain[chain.length - 1]!, part))
  return chain
}
function symlinkError(path: string): Error {
  let target: string | undefined
  try { target = realpathSync(path) } catch {
    try { target = readlinkSync(path) } catch { /* A broken or inaccessible target remains rejected by its link path. */ }
  }
  return new Error(`symlink in path: ${path}${target ? ` -> ${target}` : ''}`)
}
function assertDirectoryChain(path: string, lstat = lstatSync): void {
  for (const part of pathChain(path)) {
    let stat
    try { stat = lstat(part) } catch (error) { throw new Error(`missing directory: ${part}`, { cause: error }) }
    if (stat.isSymbolicLink()) throw symlinkError(part)
    if (!stat.isDirectory()) throw new Error(`not a directory: ${part}`)
  }
}
function safeRelative(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`unsafe source path: ${path}`)
}

export function readLibraryFiles(root: string, injected: ReadOps = {}): Map<string, Buffer> {
  const ops = { ...defaultOps, ...injected }
  assertDirectoryChain(root, ops.lstat)
  const cards = join(root, 'cards')
  const result = new Map<string, Buffer>()
  const files: Array<{ relative: string; absolute: string }> = []
  const inspect = (directory: string, prefix: string): void => {
    for (const name of ops.readdir(directory).sort()) {
      const rel = `${prefix}/${name}`
      safeRelative(rel)
      const absolute = join(directory, name)
      const stat = ops.lstat(absolute)
      if (stat.isSymbolicLink()) throw new Error(`symlink: ${rel}`)
      if (stat.isDirectory()) inspect(absolute, rel)
      else {
        if (!stat.isFile()) throw new Error(`not a regular file: ${rel}`)
        if (stat.nlink !== 1) throw new Error(`hard link: ${rel}`)
        files.push({ relative: rel, absolute })
      }
    }
  }
  const cardsStat = ops.lstat(cards)
  if (cardsStat.isSymbolicLink()) throw new Error(`symlink: cards`)
  if (!cardsStat.isDirectory()) throw new Error('not a directory: cards')
  inspect(cards, 'cards')
  const configPath = join(root, '.memexrc')
  try {
    const stat = ops.lstat(configPath)
    if (stat.isSymbolicLink()) throw new Error(`symlink: .memexrc`)
    if (!stat.isFile()) throw new Error(`not a regular file: .memexrc`)
    if (stat.nlink !== 1) throw new Error(`hard link: .memexrc`)
    files.push({ relative: '.memexrc', absolute: configPath })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const file of files) {
    const fd = ops.open(file.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = ops.fstat(fd)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`not a regular file or hard link: ${file.relative}`)
      result.set(file.relative, ops.read(fd))
    } finally { ops.close(fd) }
  }
  return result
}

export function createRunDirectory(input: { home: string; libraryRoot: string; runId: string }): RunDirectory {
  const { home, libraryRoot, runId } = input
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) || runId === '.' || runId === '..') throw new Error(`invalid run id: ${runId}`)
  assertDirectoryChain(home)
  assertDirectoryChain(libraryRoot)
  const libraryReal = realpathSync(libraryRoot)
  const evalRoot = join(home, '.dsh-memex-eval')
  const retrievalRoot = join(evalRoot, 'retrieval')
  // Check each planned component without following links; only ENOENT is allowed.
  const checkPlannedPath = (target: string): void => {
    const rel = relative(home, target)
    let current = resolve(home)
    let missing = false
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part)
      try {
        const stat = lstatSync(current)
        if (missing) throw new Error(`unexpected path below missing parent: ${current}`)
        if (stat.isSymbolicLink()) throw symlinkError(current)
        if (!stat.isDirectory()) throw new Error(`not a directory: ${current}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { missing = true; continue }
        throw error
      }
    }
  }
  checkPlannedPath(evalRoot)
  checkPlannedPath(retrievalRoot)
  // Walk from the nearest existing ancestor to filesystem root; a cards/ child marks a library.
  let existing = retrievalRoot
  while (true) {
    try { lstatSync(existing); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const next = dirname(existing)
      if (next === existing) throw error
      existing = next
    }
  }
  let cursor = realpathSync(existing)
  while (true) {
    if (cursor === libraryReal) throw new Error(`evaluation root overlaps source library: ${libraryReal}`)
    try { if (lstatSync(join(cursor, 'cards')).isDirectory()) throw new Error(`evaluation root is inside a memory library: ${cursor}`) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  for (const dir of [evalRoot, retrievalRoot]) {
    try { mkdirSync(dir, { mode: 0o700 }); chmodSync(dir, 0o700) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; assertDirectoryChain(dir) }
  }
  const runDir = join(retrievalRoot, runId)
  mkdirSync(runDir, { mode: 0o700 })
  chmodSync(runDir, 0o700)
  const snapshotDir = join(runDir, 'snapshot')
  const reportDir = join(runDir, 'report')
  return { runDir, snapshotDir, reportDir }
}

export function assertUniqueSlugs(existing: readonly string[], distractors: readonly string[], targets: readonly string[] = []): void {
  const known = new Set([...existing, ...targets])
  const seen = new Set<string>()
  for (const slug of distractors) {
    if (known.has(slug) || seen.has(slug)) throw new Error(`distractor slug conflict: ${slug}`)
    seen.add(slug)
  }
}
