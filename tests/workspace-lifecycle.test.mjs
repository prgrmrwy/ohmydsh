import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const ROOT=path.resolve(import.meta.dirname,'..')
const CLEAN_PACKAGES=['sidebar-session-provider-icon','worktree-session','cockpit-memex-browse-shim','session-title-copy','sidebar-session-resources','home-network-model-guard','system-clock','dsh-openspec','dsh-memex','cockpit-worktree-open-shim','dsh-pet']
const pkg=async name=>JSON.parse(await readFile(path.join(ROOT,'packages',name,'package.json'),'utf8'))
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'ohmydsh lifecycle 中文 '))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return root
}
function nodeInline(script){
  const match=/^node -e "((?:\\"|[^"])*)"$/.exec(script)
  assert.ok(match,'lifecycle must use one Node inline program, not POSIX tooling: '+script)
  return match[1].replace(/\\"/g,'"')
}

test('workspace clean and build lifecycle scripts do not rely on POSIX tools',async()=>{
  const packages=await readdir(path.join(ROOT,'packages'),{withFileTypes:true})
  for(const entry of packages.filter(entry=>entry.isDirectory())){
    const file=path.join(ROOT,'packages',entry.name,'package.json')
    if(!existsSync(file))continue
    const manifest=JSON.parse(await readFile(file,'utf8'))
    for(const [name,command]of Object.entries(manifest.scripts??{})){
      if(!/^(?:clean|build(?::.*)?|prepare|prepack)$/.test(name))continue
      assert.doesNotMatch(command,/(?:^|&&\s*)(?:rm\s+-|mkdir\s+-p|chmod\s|if\s|cp\s)|\bthen\b/,`${entry.name}:${name}`)
    }
  }
})

test('all workspace clean scripts remove only package-local lib and are idempotent',async t=>{
  const root=await fixture(t)
  for(const name of CLEAN_PACKAGES){
    const cwd=path.join(root,name)
    await mkdir(path.join(cwd,'lib/nested'),{recursive:true})
    await mkdir(path.join(cwd,'src'),{recursive:true})
    await writeFile(path.join(cwd,'lib/nested/generated.js'),'generated')
    await writeFile(path.join(cwd,'src/keep.ts'),'keep')
    const program=nodeInline((await pkg(name)).scripts.clean)
    assert.match(program,/\.rm\('lib'/,'delete target must remain literal package-local lib')
    // cwd is a fixture-owned package root; no production output is removed.
    for(let repeat=0;repeat<2;repeat++){
      const result=spawnSync(process.execPath,['-e',program],{cwd,encoding:'utf8',shell:false})
      assert.equal(result.status,0,result.stderr)
    }
    assert.equal(existsSync(path.join(cwd,'lib')),false)
    assert.equal(await readFile(path.join(cwd,'src/keep.ts'),'utf8'),'keep')
  }
})

test('collab-kernel build copies convention markdown including empty-source case without shell',async t=>{
  const root=await fixture(t)
  const build=(await pkg('collab-kernel')).scripts.build
  assert.match(build,/^tsc -p tsconfig\.json && node scripts\/copy-convention\.mjs$/)
  await mkdir(path.join(root,'scripts'),{recursive:true})
  await mkdir(path.join(root,'src/convention'),{recursive:true})
  await writeFile(path.join(root,'package.json'),'{"type":"module"}')
  await cp(path.join(ROOT,'packages/collab-kernel/scripts/copy-convention.mjs'),path.join(root,'scripts/copy-convention.mjs'))
  const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/copy-convention.mjs')],{cwd:root,encoding:'utf8',shell:false})
  assert.equal(run().status,0)
  assert.ok((await stat(path.join(root,'lib/convention'))).isDirectory())
  await writeFile(path.join(root,'src/convention/v1.md'),'# convention 中文\n')
  await writeFile(path.join(root,'src/convention/quoted # convention.md'),'# literal filename\n')
  await writeFile(path.join(root,'src/convention/ignore.ts'),'not markdown')
  await mkdir(path.join(root,'src/convention/nested.md'))
  const result=run()
  assert.equal(result.status,0,result.stderr)
  assert.equal(await readFile(path.join(root,'lib/convention/v1.md'),'utf8'),'# convention 中文\n')
  assert.equal(await readFile(path.join(root,'lib/convention/quoted # convention.md'),'utf8'),'# literal filename\n')
  assert.equal(existsSync(path.join(root,'lib/convention/ignore.ts')),false)
  assert.equal(existsSync(path.join(root,'lib/convention/nested.md')),false)
})

test('workspace CLI build permission step is Node-only and preserves POSIX executable bits',async t=>{
  const root=await fixture(t)
  for(const [name,entry]of [['worktree-session','lib/cli.js'],['dsh-memex','lib/cli/recall-report.js']]){
    const script=(await pkg(name)).scripts['build:host']
    assert.ok(script.startsWith('tsc -p tsconfig.json && '))
    const program=nodeInline(script.slice('tsc -p tsconfig.json && '.length))
    const file=path.join(root,entry)
    await mkdir(path.dirname(file),{recursive:true})
    await writeFile(file,'#!/usr/bin/env node\n')
    const result=spawnSync(process.execPath,['-e',program],{cwd:root,encoding:'utf8',shell:false})
    assert.equal(result.status,0,result.stderr)
    if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o111,0o111)
  }
})
