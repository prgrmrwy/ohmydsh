import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeGeneration } from '../src/generation-materializer.js'
import { managedInvocation } from '../src/managed-invocation.js'
import { loadGeneration } from '../src/generations.js'
import { spawnSync } from 'node:child_process'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'generation-closure-')); roots.push(home)
  const source = join(home, 'source'); await mkdir(join(source, 'bin'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2', type: 'module', bin: { openspec: 'bin/openspec.js' }, dependencies: { a: '1', shared: '1' }, optionalDependencies: { 'missing-platform-addon': '1' } }))
  await writeFile(join(source, 'bin/openspec.js'), "import a from 'a'; import shared from 'shared'; if(a!=='nested-v2'||shared!=='root-v1')process.exit(3); console.log('1.13.2')")
  const pkg = async (path: string, value: string, dependencies = {}) => {
    await mkdir(path, { recursive: true }); await writeFile(join(path, 'package.json'), JSON.stringify({ name: path.split('/').at(-1), version: '1.0.0', main: 'index.js', dependencies }))
    await writeFile(join(path, 'index.js'), value)
  }
  await pkg(join(source, 'node_modules/a'), "module.exports=require('shared')", { shared: '2' })
  await pkg(join(source, 'node_modules/a/node_modules/shared'), "module.exports='nested-v2'")
  await pkg(join(source, 'node_modules/shared'), "module.exports='root-v1'")
  const id = 'closure'; const dir = join(home, 'plugins/dsh-openspec/generations', id)
  const input = { home, id, sourceRoot: source, version: '1.13.2', skills: [], invocation: managedInvocation({ node: process.execPath, cli: join(dir, 'bin/openspec.js'), telemetry: 'adapter-off' }) }
  return { home, source, dir, input }
}
describe('generation dependency closure integrity', () => {
  it('nested_versions_and_absent_optional_dependency_work_without_flattening_or_external_links', async () => {
    const f = await fixture(); await materializeGeneration(f.input)
    expect(await readFile(join(f.dir, 'node_modules/a/node_modules/shared/index.js'), 'utf8')).toContain('nested-v2')
    expect((await loadGeneration(f.home)).sourceHashes).toHaveProperty('node_modules')
    await rm(f.source, { recursive: true })
    expect(spawnSync(process.execPath, [join(f.dir, 'bin/openspec.js'), '--version'], { encoding: 'utf8' }).status).toBe(0)
  })
  it('same_identity_with_changed_source_or_tampered_closure_is_refused_without_manifest_overwrite', async () => {
    const f = await fixture()
    // Remove the optional fixture and nested collision to make the integrity regression independent.
    const manifest = JSON.parse(await readFile(join(f.source, 'package.json'), 'utf8')); delete manifest.optionalDependencies
    await writeFile(join(f.source, 'package.json'), JSON.stringify(manifest)); await writeFile(join(f.source, 'bin/openspec.js'), "console.log('1.13.2')")
    await rm(join(f.source, 'node_modules/a/node_modules'), { recursive: true }); await writeFile(join(f.source, 'node_modules/a/package.json'), JSON.stringify({ name: 'a', version: '1', main: 'index.js' }))
    await materializeGeneration(f.input)
    const before = await readFile(join(f.dir, 'generation.json'))
    await writeFile(join(f.dir, 'node_modules/shared/index.js'), "module.exports='tampered'")
    await expect(materializeGeneration(f.input)).rejects.toThrow('generation-integrity-mismatch')
    expect(await readFile(join(f.dir, 'generation.json'))).toEqual(before)
    await writeFile(join(f.dir, 'node_modules/shared/index.js'), "module.exports='root-v1'")
    await writeFile(join(f.source, 'bin/openspec.js'), "console.log('1.13.2'); // source changed")
    await expect(materializeGeneration(f.input)).rejects.toThrow('generation-identity-collision')
    expect(await readFile(join(f.dir, 'generation.json'))).toEqual(before)
  })
  it('dependency_cycles_are_internal_and_substring_version_smoke_is_rejected', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'node_modules/shared/package.json'), JSON.stringify({ name: 'shared', version: '1', main: 'index.js', dependencies: { a: '1' } }))
    await materializeGeneration(f.input)
    await rm(f.source, { recursive: true })
    expect(spawnSync(process.execPath, [join(f.dir, 'bin/openspec.js')]).status).toBe(0)
    const bad = await fixture(); await writeFile(join(bad.source, 'bin/openspec.js'), "console.log('1.13.20')")
    await expect(materializeGeneration(bad.input)).rejects.toThrow('cli-smoke-failed')
  })
  it('concurrent_same_identity_publication_converges_without_staging_leaks', async () => {
    const f = await fixture()
    await Promise.all([materializeGeneration(f.input), materializeGeneration(f.input)])
    expect((await loadGeneration(f.home)).id).toBe(f.input.id)
    expect(await readdir(join(f.home, 'plugins/dsh-openspec/generations'))).toEqual(['closure'])
  })
})
