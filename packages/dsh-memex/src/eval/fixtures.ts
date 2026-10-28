import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface FixtureEntry { readonly path: string; readonly size: number; readonly sha256: string }
export type FixtureManifest = readonly FixtureEntry[]
export type VerifiedFixture = ReadonlyMap<string, Buffer>

function safePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe resource path: ${path}`)
  }
  if (path.split('/').some(part => ['.git', '.sync.json', 'commondir', 'alternates'].includes(part))) {
    throw new Error(`forbidden metadata: ${path}`)
  }
}

function checkDirectoryChain(path: string): void {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) checkDirectoryChain(parent)
  const stat = lstatSync(absolute)
  if (stat.isSymbolicLink()) throw new Error(`symbolic link: ${absolute}`)
  if (!stat.isDirectory()) throw new Error(`not a directory: ${absolute}`)
}

export function validateFixture(source: string, manifest: FixtureManifest): VerifiedFixture {
  const expected = new Map<string, FixtureEntry>()
  const directories = new Set<string>()
  for (const entry of manifest) {
    safePath(entry.path)
    if (expected.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`invalid resource manifest: ${entry.path}`)
    }
    expected.set(entry.path, entry)
    let parent = dirname(entry.path)
    while (parent !== '.') { directories.add(parent); parent = dirname(parent) }
  }
  checkDirectoryChain(source)
  const observed = new Set<string>()
  function inspect(directory: string, prefix = ''): void {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name
      const absolute = join(directory, name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`symbolic link: ${path}`)
      safePath(path)
      if (stat.isDirectory()) {
        if (!directories.has(path)) throw new Error(`unexpected entry: ${path}`)
        inspect(absolute, path)
      } else {
        if (!stat.isFile()) throw new Error(`not a regular resource: ${path}`)
        if (stat.nlink !== 1) throw new Error(`hard link: ${path}`)
        if (!expected.has(path)) throw new Error(`unexpected entry: ${path}`)
        observed.add(path)
      }
    }
  }
  // Complete metadata inspection precedes all source-content reads.
  inspect(source)
  const result = new Map<string, Buffer>()
  for (const [path, entry] of expected) {
    if (!observed.has(path)) throw new Error(`missing resource: ${path}`)
    const fd = openSync(join(source, path), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`resource identity changed: ${path}`)
      const bytes = readFileSync(fd)
      if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        throw new Error(`hash mismatch: ${path}`)
      }
      result.set(path, bytes)
    } finally { closeSync(fd) }
  }
  return result
}

export function materializeFixture(files: VerifiedFixture, target: string): void {
  for (const path of files.keys()) safePath(path)
  writeFiles(files, target)
  for (const part of ['repo', 'library']) initializeGit(join(target, part))
}

export function writeRepository(files: VerifiedFixture, target: string): void {
  writeFiles(files, target)
  initializeGit(target)
}

function writeFiles(files: VerifiedFixture, target: string): void {
  for (const path of files.keys()) safePath(path)
  checkDirectoryChain(dirname(target))
  try { mkdirSync(target, { mode: 0o700 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`target already exists: ${target}`)
    throw error
  }
  for (const [path, bytes] of files) {
    const destination = join(target, path)
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 })
  }
}

function initializeGit(cwd: string): void {
  checkDirectoryChain(cwd)
  // Neither user Git templates nor ambient repository variables may link this new repository elsewhere.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' })
  {
    const git = (...args: string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '--quiet', '--template=')
    git('add', '--all')
    git('-c', 'user.name=Memex selftest', '-c', 'user.email=selftest@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Memex selftest fixture')
    if (git('remote').trim()) throw new Error(`unexpected remote: ${cwd}`)
    const config = readFileSync(join(cwd, '.git/config'), 'utf8')
    if (/\[include(?:If)?\b/i.test(config)) throw new Error(`unexpected git include: ${cwd}`)
  }
}
