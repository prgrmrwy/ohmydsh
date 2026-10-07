import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type StagedTarget = { target: string; integrity: string; packageJson: Record<string, any>; lockfile: Record<string, any> }
export type StageDependencies = {
  /** Registry metadata for the exact version; implementations must reject redirects and non-official hosts. */
  fetchMetadata: (target: string) => Promise<{ integrity?: unknown; tarball?: unknown }>
  /** Installs `@fission-ai/openspec@target` with scripts ignored into `stageDir`, producing node_modules and package-lock.json. */
  install: (stageDir: string, target: string) => Promise<void>
  /** CLI smoke: the staged CLI reports exactly `target`. */
  smoke: (stageRoot: string, target: string) => Promise<boolean>
  /** Renderer parity: staged official renderer exposes the mapped workflow catalog without marker or frame collisions. */
  parity: (stageRoot: string, target: string) => Promise<boolean>
}

const OPENSPEC = 'node_modules/@fission-ai/openspec'

export async function stageTarget(root: string, target: string, deps: StageDependencies): Promise<StagedTarget> {
  const meta = await deps.fetchMetadata(target)
  const integrity = meta.integrity
  const tarball = meta.tarball
  if (typeof integrity !== 'string' || !/^sha512-/.test(integrity) || typeof tarball !== 'string' || !tarball.startsWith('https://registry.npmjs.org/')) throw new Error('registry-integrity-invalid')
  const pkg = JSON.parse(await readFile(join(root, 'packages/dsh-openspec/package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  const stageDir = await mkdtemp(join(tmpdir(), 'dsh-openspec-stage-'))
  try {
    await writeFile(join(stageDir, 'package.json'), JSON.stringify({ name: 'dsh-openspec-stage', version: '0.0.0', private: true, dependencies: { '@fission-ai/openspec': target } }))
    await deps.install(stageDir, target)
    const stageLock = JSON.parse(await readFile(join(stageDir, 'package-lock.json'), 'utf8'))
    const stagedEntry = stageLock.packages?.[OPENSPEC]
    if (stagedEntry?.integrity !== integrity || stagedEntry?.version !== target) throw new Error('registry-integrity-mismatch')
    const stageRoot = join(stageDir, OPENSPEC)
    if (!await deps.smoke(stageRoot, target)) throw new Error('cli-smoke-failed')
    if (!await deps.parity(stageRoot, target)) throw new Error('renderer-parity-failed')
    const nextPkg = structuredClone(pkg)
    nextPkg.dependencies['@fission-ai/openspec'] = target
    const nextLock = structuredClone(lock)
    const workspace = nextLock.packages?.['packages/dsh-openspec']
    if (!workspace || !nextLock.packages[OPENSPEC]) throw new Error('lockfile-closure-incomplete')
    workspace.dependencies = { ...(workspace.dependencies ?? {}), '@fission-ai/openspec': target }
    nextLock.packages[OPENSPEC] = { ...nextLock.packages[OPENSPEC], ...stagedEntry, resolved: tarball }
    for (const [key, entry] of Object.entries<any>(stageLock.packages ?? {})) {
      if (!key.startsWith('node_modules/') || key === OPENSPEC) continue
      const existing = nextLock.packages[key]
      if (!existing) { nextLock.packages[key] = entry; continue }
      if (existing.version !== entry.version || existing.integrity !== entry.integrity) throw new Error('lockfile-closure-conflict')
    }
    return { target, integrity, packageJson: nextPkg, lockfile: nextLock }
  } finally {
    await rm(stageDir, { recursive: true, force: true })
  }
}
