import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

export type Generation = { id: string; [key: string]: unknown }
export class GenerationInvalidError extends Error {
  readonly code = 'generation-invalid'
  constructor() { super('generation-invalid'); this.name = 'GenerationInvalidError' }
}
const base = (home: string) => join(home, 'plugins', 'dsh-openspec')

export async function activateGeneration(home: string, id: string, data: Record<string, unknown>): Promise<Generation> {
  if (!/^[a-z0-9._-]+$/.test(id)) throw new GenerationInvalidError()
  const root = base(home)
  const generationDir = join(root, 'generations', id)
  await mkdir(generationDir, { recursive: true })
  const generation: Generation = { ...data, id }
  const tmp = join(generationDir, `.generation-${randomBytes(8).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(generation))
  await rename(tmp, join(generationDir, 'generation.json'))
  const activeTmp = join(root, `.active-${randomBytes(8).toString('hex')}.tmp`)
  await mkdir(dirname(activeTmp), { recursive: true })
  await writeFile(activeTmp, JSON.stringify({ id }))
  await rename(activeTmp, join(root, 'active.json'))
  return generation
}

export async function selectGeneration(home: string, id: string): Promise<Generation> {
  const generation = await loadGeneration(home, id)
  const root = base(home)
  const activeTmp = join(root, `.active-${randomBytes(8).toString('hex')}.tmp`)
  await mkdir(dirname(activeTmp), { recursive: true })
  await writeFile(activeTmp, JSON.stringify({ id }))
  await rename(activeTmp, join(root, 'active.json'))
  return generation
}

export async function loadGeneration(home: string, id?: string): Promise<Generation> {
  try {
    const selected = id ?? JSON.parse(await readFile(join(base(home), 'active.json'), 'utf8')).id
    if (typeof selected !== 'string' || !/^[a-z0-9._-]+$/.test(selected)) throw new Error()
    const generation = JSON.parse(await readFile(join(base(home), 'generations', selected, 'generation.json'), 'utf8'))
    if (generation?.id !== selected || typeof generation !== 'object' || Array.isArray(generation)) throw new Error()
    return generation
  } catch {
    throw new GenerationInvalidError()
  }
}

export async function recoverGeneration(home: string): Promise<{ state: 'none' | 'recovery-required' | 'committed'; previousGeneration?: Generation; journal?: Record<string, unknown> }> {
  try {
    const journalPath = join(base(home), 'upgrade-journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    if (journal.phase === 'committed' || journal.phase === 'rolled-back') return { state: 'committed', journal }
    const active = await loadGeneration(home)
    return { state: 'recovery-required', previousGeneration: active, journal }
  } catch (error) {
    if (error instanceof GenerationInvalidError) throw error
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { state: 'none' }
    throw new GenerationInvalidError()
  }
}

export async function removeGeneration(home: string, id: string): Promise<void> {
  const active = JSON.parse(await readFile(join(base(home), 'active.json'), 'utf8').catch(() => '{"id":null}'))
  if (active.id === id) throw new GenerationInvalidError()
  await rm(join(base(home), 'generations', id), { recursive: true, force: true })
}
