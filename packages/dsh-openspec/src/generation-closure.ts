import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, realpath, stat, symlink, lstat, readdir, readlink } from 'node:fs/promises'
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

/**
 * One physical package discovered while walking the closure. `key` is the only name a copied dependency
 * may carry inside a generation: it is derived from what the package is (name, version, own content) and
 * what it directly depends on (each dependency name resolved to that dependency's own name@version) —
 * never from a host filesystem path. Reinstalling the same versions under a different physical layout
 * (nested copies hoisted to a parent root, a shared parent-level store, …) therefore produces the same
 * keys, hence byte-identical generation content.
 */
type ClosureNode = {
  key: string
  root: string
  links: Array<{ name: string; key: string }>
  identity: { name: string; version: string }
}

type ClosurePlan = {
  /** The package the generation serves. It is never copied; only its dependency links are written. */
  root: ClosureNode
  /** Every copied dependency, one entry per physical package discovered. */
  dependencies: ClosureNode[]
}

const DEPENDENCY_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i
const SAFE_KEY_CHARACTERS = /[^A-Za-z0-9@._+-]/g
const safeToken = (value: string) => value.replace(SAFE_KEY_CHARACTERS, '-')
const MAX_LINK_DEPTH = 64
const invalid = (code: string) => Object.assign(new Error(code), { code })

/**
 * Path-free hash of the bytes a copy of this package will hold: the same content yields the same hash
 * wherever the package physically sits, while a patched copy of one name@version stays distinct. Nested
 * `node_modules` is excluded exactly like the copy filter, and links are followed so the hash describes
 * the dereferenced result. Directory revisits contribute once, so cyclic links terminate.
 */
async function packageContentHash(root: string): Promise<string> {
  const hash = createHash('sha256')
  const seen = new Set<string>()
  const walk = async (path: string, key: string, depth: number): Promise<void> => {
    if (depth > MAX_LINK_DEPTH) throw invalid('dependency-identity-invalid')
    const info = await stat(path)
    if (info.isDirectory()) {
      const real = await realpath(path)
      if (seen.has(real)) return
      seen.add(real)
      hash.update('directory:' + key)
      for (const entry of (await readdir(path)).sort()) if (entry !== 'node_modules') await walk(join(path, entry), `${key}/${entry}`, depth + 1)
      return
    }
    if (info.isFile()) { hash.update('file:' + key); hash.update(await readFile(path)); return }
    throw invalid('dependency-identity-invalid')
  }
  await walk(root, '', 0)
  return hash.digest('hex').slice(0, 16)
}

/**
 * Resolve a package's dependency closure into stable node identities without copying anything.
 *
 * Traversal is deterministic (dependency names sorted, depth first) and cycles terminate through the
 * per-realpath memo, so node order — and therefore which physical copy owns a duplicated key — is a
 * function of the resolved graph alone.
 */
async function planClosure(source: string): Promise<ClosurePlan> {
  const identities = new Map<string, { name: string; version: string }>()
  const contents = new Map<string, string>()
  const nodeByRoot = new Map<string, ClosureNode>()
  const identityOf = async (root: string) => {
    const cached = identities.get(root)
    if (cached) return cached
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (typeof manifest?.name !== 'string' || manifest.name === '' || typeof manifest?.version !== 'string' || manifest.version === '') throw invalid('dependency-identity-invalid')
    const identity = { name: manifest.name, version: manifest.version }
    identities.set(root, identity)
    return identity
  }
  const contentOf = async (root: string) => {
    const cached = contents.get(root)
    if (cached !== undefined) return cached
    const value = await packageContentHash(root)
    contents.set(root, value)
    return value
  }
  const visit = async (path: string, isRoot: boolean): Promise<ClosureNode> => {
    const root = await realpath(path)
    const known = nodeByRoot.get(root)
    if (known) return known
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const optional = manifest.optionalDependencies ?? {}
    const resolved: Array<{ name: string; root: string }> = []
    for (const name of Object.keys({ ...manifest.dependencies, ...optional }).sort()) {
      if (!DEPENDENCY_NAME.test(name) || name === '.' || name === '..') throw invalid('dependency-name-invalid')
      try { resolved.push({ name, root: await resolveDependency(root, name) }) }
      catch (error: any) { if (name in optional && error.code === 'ENOENT') continue; throw error }
    }
    const identity = await identityOf(root)
    // The context suffix separates copies of one name@version that resolve different direct dependencies;
    // every component is host-path free, so a relocation cannot change the key.
    const context: string[] = []
    for (const child of resolved) {
      const childIdentity = await identityOf(child.root)
      context.push(`${child.name}->${childIdentity.name}@${childIdentity.version}`)
    }
    // The served package is never copied as a dependency, so only its links matter and its own (large)
    // content is left to the generation's own source hashes.
    const content = isRoot ? '' : await contentOf(root)
    const node: ClosureNode = {
      key: `${safeToken(identity.name.replace('/', '+'))}@${safeToken(identity.version)}~${content.slice(0, 8)}~${createHash('sha256').update(context.join('\n')).digest('hex').slice(0, 8)}`,
      root,
      links: [],
      identity,
    }
    // Registered before descending so a dependency cycle terminates on this same node.
    nodeByRoot.set(root, node)
    for (const child of resolved) node.links.push({ name: child.name, key: (await visit(child.root, false)).key })
    return node
  }
  const root = await visit(source, true)
  const dependencies = [...nodeByRoot.values()].filter(node => node !== root)
  return { root, dependencies }
}

/** Stable, host-path-free identity of a package's whole dependency closure. */
export async function closureIdentity(source: string): Promise<string> {
  const { root, dependencies } = await planClosure(source)
  const keys = [...new Set(dependencies.map(node => node.key))].sort()
  const topLinks = root.links.map(link => `${link.name}->${link.key}`).sort()
  return createHash('sha256').update(JSON.stringify({ keys, topLinks })).digest('hex').slice(0, 16)
}

/** Copy each physical dependency once under its host-path-free key and link it from every parent. */
export async function copyDependencyClosure(source: string, modules: string): Promise<void> {
  const { root, dependencies } = await planClosure(source)
  const byKey = new Map<string, ClosureNode>()
  for (const node of dependencies) {
    const existing = byKey.get(node.key)
    if (!existing) { byKey.set(node.key, node); continue }
    // One key means one directory: two copies may share it only when they link the same children.
    if (JSON.stringify(existing.links) !== JSON.stringify(node.links)) throw invalid('dependency-closure-ambiguous')
  }
  const target = (key: string) => join(modules, '.dsh-closure', key)
  for (const node of byKey.values()) {
    const destination = target(node.key)
    await mkdir(dirname(destination), { recursive: true })
    await cp(node.root, destination, { recursive: true, dereference: true, filter: path => path === node.root || !relative(node.root, path).split(sep).includes('node_modules') })
  }
  const link = async (destinationModules: string, links: ClosureNode['links']) => {
    for (const item of links) {
      const path = join(destinationModules, ...item.name.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await symlink(relative(dirname(path), target(item.key)), path, 'dir')
    }
  }
  // The served package itself is never copied; only its own dependencies are linked into the generation.
  await link(modules, root.links)
  for (const node of byKey.values()) await link(join(target(node.key), 'node_modules'), node.links)
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
