import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { officialStageDependencies } from '../src/stage-official.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function stage(extra: string, version = '1.13.2') {
  const root = await mkdtemp(join(tmpdir(), 'stage-official-')); roots.push(root)
  await mkdir(join(root, 'dist/core/shared'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version, type: 'module', bin: { openspec: 'bin/openspec.js' } }))
  const workflows = ['propose','explore','new','continue','apply','update','ff','sync','archive','bulk-archive','verify','onboard']
  await writeFile(join(root, 'dist/core/shared/skill-generation.js'), `const ids=${JSON.stringify(workflows)}; export function getSkillTemplates(selected) { return (selected??ids).map(workflowId=>({workflowId,dirName:'official-'+workflowId,template:{}})).map(entry=>{${extra};return entry}) } export function generateSkillContent() {return 'official instructions'};`)
  return root
}
describe('official target staging contract', () => {
  it('full_catalog_including_noncore_custom_name_collision_and_unknown_workflow_is_rejected', async () => {
    const deps = officialStageDependencies('/unused')
    const collision = await stage("if(entry.workflowId==='verify')entry.dirName='openspec-upgrade'")
    expect(await deps.parity(collision, '1.13.2')).toBe(false)
    const unknown = await stage("if(entry.workflowId==='onboard')entry.workflowId='unmapped'")
    expect(await deps.parity(unknown, '1.13.2')).toBe(false)
    const good = await stage('')
    expect(await deps.parity(good, '1.13.2')).toBe(true)
  })
  it('package_identity_and_exact_cli_smoke_version_are_checked', async () => {
    const deps = officialStageDependencies('/unused')
    const wrong = await stage('', '9.9.9')
    expect(await deps.parity(wrong, '1.13.2')).toBe(false)
    const root = await stage(''); await mkdir(join(root, 'bin'))
    await writeFile(join(root, 'bin/openspec.js'), "console.log('1.13.20')")
    expect(await deps.smoke(root, '1.13.2')).toBe(false)
  })
  it('installed_official_release_passes_full_catalog_parity', async () => {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('@fission-ai/openspec')
    expect(await officialStageDependencies('/unused').parity(join(entry, '../..'), '1.13.2')).toBe(true)
  })
})
