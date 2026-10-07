import { randomBytes } from 'node:crypto'
import { copyDependencyClosure, generationHashes } from './generation-closure.js'
import { cp, mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { loadGeneration, selectGeneration } from './generations.js'

/** True only when the invocation's final shell argument is exactly the generation's CLI path (POSIX single-quoted). */
function invocationNamesCli(invocation: string, cliPath: string): boolean {
  const quoted = `'${cliPath.replaceAll("'", "'\\''")}'`
  return invocation.endsWith(` ${quoted}`)
}

export async function materializeGeneration(input: { home: string; id: string; sourceRoot: string; version: string; skills: unknown[]; invocation: string; selectionFingerprint?: string; delivery?: string; canActivate?: () => boolean }) {
  const source = resolve(input.sourceRoot)
  const root = join(input.home, 'plugins', 'dsh-openspec')
  const destination = join(root, 'generations', input.id)
  const staged = `${destination}.staging-${process.pid}-${randomBytes(8).toString('hex')}`
  if (!/^[a-z0-9._-]+$/.test(input.id) || !isAbsolute(input.home)) throw new Error('generation-invalid')
  await mkdir(staged, { recursive: true })
  const files = ['bin', 'dist', 'schemas']
  let hashes: Record<string, string> = {}
  try {
    for (const name of files) {
      const from = join(source, name)
      try { await cp(from, join(staged, name), { recursive: true, dereference: true, errorOnExist: true, force: false }) }
      catch (error: any) { if (error?.code !== 'ENOENT') throw error }
    }
    const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    if (packageJson.version !== input.version || packageJson.name !== '@fission-ai/openspec') throw new Error('upstream-identity-mismatch')
    const binRelative = packageJson.bin?.openspec
    if (typeof binRelative !== 'string' || isAbsolute(binRelative) || binRelative.split(/[\\/]/).includes('..')) throw new Error('upstream-identity-mismatch')
    // The entry file need not embed the version (the official bin only imports dist/cli); the authoritative
    // check is executing the materialized CLI with --version after activation-independent staging below.
    await readFile(join(staged, binRelative), 'utf8')
    await copyDependencyClosure(source, join(staged, 'node_modules'))
    await writeFile(join(staged, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: input.version, type: 'module', bin: { openspec: binRelative }, dependencies: packageJson.dependencies }, null, 2) + '\n')
    hashes = await generationHashes(staged)
    await writeFile(join(staged, 'generation.json'), JSON.stringify({ id: input.id, version: input.version, skills: input.skills, invocation: input.invocation, cli: join(destination, binRelative), sourceHashes: hashes, selectionFingerprint: input.selectionFingerprint, delivery: input.delivery }, null, 2) + '\n')
    await mkdir(join(root, 'generations'), { recursive: true })
    const reuse = async () => {
      const existing = await readFile(join(destination, 'generation.json'), 'utf8')
      const manifest = JSON.parse(existing)
      if (manifest.id === input.id && manifest.version === input.version && JSON.stringify(manifest.sourceHashes) === JSON.stringify(hashes) && JSON.stringify(manifest.skills) === JSON.stringify(input.skills) && manifest.invocation === input.invocation && manifest.selectionFingerprint === input.selectionFingerprint && manifest.delivery === input.delivery) {
        if (JSON.stringify(await generationHashes(destination)) !== JSON.stringify(manifest.sourceHashes)) throw new Error('generation-integrity-mismatch')
        await rm(staged, { recursive: true, force: true })
        if (input.canActivate?.() === false) throw new Error('generation-cancelled')
        const active = await loadGeneration(input.home).catch(() => undefined)
        const prior = active?.id === input.id ? active : await selectGeneration(input.home, input.id)
        return { ...prior, files: [binRelative, 'dist', 'schemas', 'node_modules', 'package.json'], hashes: manifest.sourceHashes }
      }
      throw new Error('generation-identity-collision')
    }
    try { return await reuse() } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
    // The recorded invocation must name exactly the CLI this generation will serve; checked before anything is exposed.
    if (!invocationNamesCli(input.invocation, join(destination, binRelative))) throw new Error('invocation-path-mismatch')
    // Smoke the staged CLI before it is renamed into place or activated, so a CLI that cannot run or reports a
    // different version never becomes visible (a failure removes the staging directory in the outer catch).
    const smoke = await import('node:child_process').then(({ spawnSync }) => spawnSync(process.execPath, [join(staged, binRelative), '--version'], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, HOME: input.home, OPENSPEC_NO_UPDATE_CHECK: '1', OPENSPEC_TELEMETRY: '0' } }))
    if (smoke.status !== 0 || !new RegExp(`(?:^|\\s)${input.version.replaceAll('.', '\\.')}\\s*$`).test(`${smoke.stdout}${smoke.stderr}`.trim())) throw new Error('cli-smoke-failed')
    if (input.canActivate?.() === false) throw new Error('generation-cancelled')
    try { await rename(staged, destination) }
    catch (error: any) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      return await reuse()
    }
    // The recorded invocation is never rewritten: the block must name exactly the CLI that was smoked here.
    if (input.canActivate?.() === false) throw new Error('generation-cancelled')
    const generation = await selectGeneration(input.home, input.id)
    return { ...generation, files: [binRelative, 'dist', 'schemas', 'node_modules', 'package.json'], hashes }
  } catch (error) {
    await rm(staged, { recursive: true, force: true })
    throw error
  }
}
