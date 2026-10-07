import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rename, writeFile, rm, realpath } from 'node:fs/promises'
import { join, resolve, isAbsolute, dirname } from 'node:path'
import { activateGeneration, loadGeneration, selectGeneration } from './generations.js'

async function resolveDependency(from: string, name: string): Promise<string> {
  let cursor = from
  while (true) {
    const candidate = join(cursor, 'node_modules', ...name.split('/'))
    try { return await realpath(candidate) } catch { /* continue toward the package root */ }
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`dependency-missing:${name}`)
    cursor = parent
  }
}

async function copyDependencyClosure(packageRoot: string, destinationModules: string, seen = new Set<string>()): Promise<void> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies }
  for (const name of Object.keys(dependencies)) {
    const root = await resolveDependency(packageRoot, name)
    const identity = `${name}:${root}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const target = join(destinationModules, ...name.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await cp(root, target, { recursive: true, dereference: true, errorOnExist: true, force: false })
    await copyDependencyClosure(root, destinationModules, seen)
  }
}

/** True only when the invocation's final shell argument is exactly the generation's CLI path (POSIX single-quoted). */
function invocationNamesCli(invocation: string, cliPath: string): boolean {
  const quoted = `'${cliPath.replaceAll("'", "'\\''")}'`
  return invocation.endsWith(` ${quoted}`)
}

export async function materializeGeneration(input: { home: string; id: string; sourceRoot: string; version: string; skills: unknown[]; invocation: string; selectionFingerprint?: string; delivery?: string }) {
  const source = resolve(input.sourceRoot)
  const root = join(input.home, 'plugins', 'dsh-openspec')
  const destination = join(root, 'generations', input.id)
  const staged = `${destination}.staging-${process.pid}-${Date.now()}`
  if (!/^[a-z0-9._-]+$/.test(input.id) || !isAbsolute(input.home)) throw new Error('generation-invalid')
  await mkdir(staged, { recursive: true })
  const files = ['bin', 'dist', 'schemas']
  const hashes: Record<string, string> = {}
  try {
    for (const name of files) {
      const from = join(source, name)
      try { await cp(from, join(staged, name), { recursive: true, dereference: true, errorOnExist: true, force: false }) }
      catch (error: any) { if (error?.code !== 'ENOENT') throw error }
    }
    const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    if (packageJson.version !== input.version || packageJson.name !== '@fission-ai/openspec') throw new Error('upstream-identity-mismatch')
    for (const name of [...files, 'package.json']) {
      try { hashes[name] = createHash('sha256').update(await readFile(join(source, name))).digest('hex') }
      catch { /* optional source directory */ }
    }
    const binRelative = packageJson.bin?.openspec
    if (typeof binRelative !== 'string' || isAbsolute(binRelative) || binRelative.split(/[\\/]/).includes('..')) throw new Error('upstream-identity-mismatch')
    // The entry file need not embed the version (the official bin only imports dist/cli); the authoritative
    // check is executing the materialized CLI with --version after activation-independent staging below.
    await readFile(join(staged, binRelative), 'utf8')
    await copyDependencyClosure(source, join(staged, 'node_modules'))
    await writeFile(join(staged, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: input.version, type: 'module', bin: { openspec: binRelative }, dependencies: packageJson.dependencies }, null, 2) + '\n')
    await writeFile(join(staged, 'generation.json'), JSON.stringify({ id: input.id, version: input.version, skills: input.skills, invocation: input.invocation, sourceHashes: hashes, selectionFingerprint: input.selectionFingerprint, delivery: input.delivery }, null, 2) + '\n')
    await mkdir(join(root, 'generations'), { recursive: true })
    try {
      const existing = await readFile(join(destination, 'generation.json'), 'utf8')
      const manifest = JSON.parse(existing)
      if (manifest.id === input.id && manifest.version === input.version && manifest.sourceHashes && JSON.stringify(manifest.skills) === JSON.stringify(input.skills) && manifest.invocation === input.invocation && (!input.selectionFingerprint || manifest.selectionFingerprint === input.selectionFingerprint)) {
        const prior = await loadGeneration(input.home, input.id)
        if ((await readFile(join(root, 'active.json'), 'utf8')).includes(input.id)) return { ...prior, files: [binRelative, 'dist', 'schemas', 'node_modules', 'package.json'], hashes: manifest.sourceHashes }
        return await selectGeneration(input.home, input.id)
      }
      throw new Error('generation-identity-collision')
    } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
    // The recorded invocation must name exactly the CLI this generation will serve; checked before anything is exposed.
    if (!invocationNamesCli(input.invocation, join(destination, binRelative))) throw new Error('invocation-path-mismatch')
    // Smoke the staged CLI before it is renamed into place or activated, so a CLI that cannot run or reports a
    // different version never becomes visible (a failure removes the staging directory in the outer catch).
    const smoke = await import('node:child_process').then(({ spawnSync }) => spawnSync(process.execPath, [join(staged, binRelative), '--version'], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, HOME: input.home, OPENSPEC_NO_UPDATE_CHECK: '1', OPENSPEC_TELEMETRY: '0' } }))
    if (smoke.status !== 0 || !`${smoke.stdout}${smoke.stderr}`.includes(input.version)) throw new Error('cli-smoke-failed')
    await rename(staged, destination)
    // The recorded invocation is never rewritten: the block must name exactly the CLI that was smoked here.
    const invocation = input.invocation
    const generation = await activateGeneration(input.home, input.id, { version: input.version, skills: input.skills, invocation, cli: join(destination, binRelative), sourceHashes: hashes })
    return { ...generation, files: [binRelative, 'dist', 'schemas', 'node_modules', 'package.json'], hashes }
  } catch (error) {
    await rm(staged, { recursive: true, force: true })
    throw error
  }
}
