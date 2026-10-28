import { constants } from 'node:fs'
import { lstat, readdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

async function directoryChain(path) {
  const parent = dirname(path)
  if (parent !== path) await directoryChain(parent)
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`independent resources: symbolic link or non-directory: ${path}`)
}
async function inventory(root, path, files) {
  const stat = await lstat(join(root, path))
  if (stat.isSymbolicLink()) throw new Error(`independent resources: symbolic link: ${path}`)
  if (stat.isDirectory()) {
    for (const name of (await readdir(join(root, path))).sort()) await inventory(root, `${path}/${name}`, files)
  } else if (stat.isFile()) files.set(path, stat)
  else throw new Error(`independent resources: non-regular file: ${path}`)
}
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink
async function bytesAt(root, path, expected) {
  const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!sameIdentity(await file.stat(), expected)) throw new Error(`independent resources: identity changed: ${path}`)
    return await file.readFile()
  } finally { await file.close() }
}

/** Only declared package resources are replaced; source files are never written. */
export async function materializeIndependentPackageFiles(source, deployed, paths) {
  if (paths === undefined) return []
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || ['.', '..', 'node_modules', '.git'].includes(part)))) throw new Error('unsafe independent resource paths')
  if (new Set(paths).size !== paths.length || paths.some(a => paths.some(b => a !== b && a.startsWith(b + '/')))) throw new Error('duplicate or overlapping independent resource paths')
  source = resolve(source); deployed = resolve(deployed)
  if (source === deployed) throw new Error('independent resource deployment must differ from source')
  const sources = new Map(), targets = new Map()
  for (const root of [source, deployed]) {
    await directoryChain(root)
    for (const path of paths) {
      await directoryChain(dirname(join(root, path)))
      await inventory(root, path, root === source ? sources : targets)
    }
  }
  if (sources.size !== targets.size || [...sources.keys()].some(path => !targets.has(path))) throw new Error('independent resource entries differ')
  // Complete metadata/byte preflight before replacing any deployment leaf.
  const pending = []
  for (const [path, stat] of sources) {
    const bytes = await bytesAt(source, path, stat)
    const target = targets.get(path)
    if (!bytes.equals(await bytesAt(deployed, path, target))) throw new Error(`independent resource bytes differ: ${path}`)
    if (target.nlink > 1) pending.push({ path, bytes, target })
  }
  for (const { path, bytes, target } of pending) {
    const destination = join(deployed, path)
    await directoryChain(dirname(destination))
    if (!sameIdentity(await lstat(destination), target)) throw new Error(`independent resource identity changed: ${path}`)
    const temporary = join(dirname(destination), `.independent-${randomUUID()}`)
    const file = await open(temporary, 'wx', target.mode & 0o777)
    try {
      await file.writeFile(bytes); await file.sync(); await file.close()
      if (!sameIdentity(await lstat(destination), target)) throw new Error(`independent resource identity changed: ${path}`)
      // Both absolute paths belong to the validated deployed directory above.
      await rename(temporary, destination)
    } finally { await file.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  return pending.map(entry => entry.path)
}
