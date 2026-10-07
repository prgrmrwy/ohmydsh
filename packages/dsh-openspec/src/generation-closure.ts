import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, realpath, symlink, lstat, readdir, readlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

async function resolveDependency(from: string, name: string): Promise<string> {
  let cursor = from
  while (true) {
    try { return await realpath(join(cursor, 'node_modules', ...name.split('/'))) }
    catch (error: any) { if (error.code !== 'ENOENT') throw error }
    const parent = dirname(cursor)
    if (parent === cursor) throw Object.assign(new Error('dependency-missing'), { code: 'ENOENT' })
    cursor = parent
  }
}

/** Copy each physical dependency once; all links point inside this generation, including cycles and nested versions. */
export async function copyDependencyClosure(source: string, modules: string): Promise<void> {
  const copied = new Map<string, string>()
  const visit = async (packageRoot: string, destinationModules: string) => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const optional = manifest.optionalDependencies ?? {}
    for (const name of Object.keys({ ...manifest.dependencies, ...optional }).sort()) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name === '.' || name === '..') throw new Error('dependency-name-invalid')
      let root: string
      try { root = await resolveDependency(packageRoot, name) }
      catch (error: any) { if (name in optional && error.code === 'ENOENT') continue; throw error }
      let target = copied.get(root)
      const first = !target
      if (!target) {
        target = join(modules, '.dsh-closure', createHash('sha256').update(root).digest('hex').slice(0, 24))
        copied.set(root, target)
        await mkdir(dirname(target), { recursive: true })
        await cp(root, target, { recursive: true, dereference: true, filter: path => path === root || !relative(root, path).split(sep).includes('node_modules') })
      }
      const link = join(destinationModules, ...name.split('/'))
      await mkdir(dirname(link), { recursive: true })
      await symlink(relative(dirname(link), target), link, 'dir')
      if (first) await visit(root, join(target, 'node_modules'))
    }
  }
  await visit(await realpath(source), modules)
}

/** Deterministic bytes + path/type hashes; refuses external links and never follows cycles. */
export async function generationHashes(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  for (const name of ['bin', 'dist', 'schemas', 'node_modules', 'package.json']) {
    const hash = createHash('sha256')
    const walk = async (path: string, key: string): Promise<void> => {
      const info = await lstat(path)
      hash.update(JSON.stringify(key))
      if (info.isSymbolicLink()) {
        const link = await readlink(path)
        const target = resolve(dirname(path), link)
        if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error('generation-integrity-mismatch')
        hash.update('link:' + link)
      } else if (info.isDirectory()) {
        hash.update('directory')
        for (const entry of (await readdir(path)).sort()) await walk(join(path, entry), `${key}/${entry}`)
      } else if (info.isFile()) { hash.update('file'); hash.update(await readFile(path)) }
      else throw new Error('generation-integrity-mismatch')
    }
    try { await lstat(join(root, name)) } catch (error: any) { if (error.code === 'ENOENT') continue; throw error }
    await walk(join(root, name), name)
    hashes[name] = hash.digest('hex')
  }
  return hashes
}
