import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { expect, it } from 'vitest'

const skillPath = resolve(import.meta.dirname, '../skills/subagent-model-routing/SKILL.md')
const skill = () => existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : ''
it('report_skill_is_on_demand_only', () => {
 const text = readFileSync(resolve(import.meta.dirname, '../skills/auto-model-routing-report/SKILL.md'), 'utf8')
 const [, front = '', body = ''] = text.split(/^---$/m)
 for (const part of [front, body]) { expect(part).toContain('仅当用户明确要求'); expect(part).toMatch(/不得主动执行[^。\n]*定时任务/) }
 const files = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')).files as string[]
 expect(files).toEqual(expect.arrayContaining(['lib', 'skills', 'scripts/label-report.mjs']))
})
const sources = () => {
 const root=resolve(import.meta.dirname,'../src')
 return readdirSync(root,{recursive:true,encoding:'utf8'}).filter(name=>name.endsWith('.ts')).map(file=>[file,readFileSync(resolve(root,file),'utf8')] as const)
}
it('runtime_relative_imports_resolve_inside_the_standalone_package', () => {
 const root = resolve(import.meta.dirname, '..')
 for (const [file, text] of sources()) {
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
   const target = resolve(root, 'src', dirname(file), match[1]!)
   const rel = relative(root, target)
   expect(rel, `${file}: ${match[1]}`).not.toMatch(/^\.\.(?:[/\\]|$)/)
   expect(isAbsolute(rel), file).toBe(false)
   const source = target.replace(/\.js$/, '.ts')
   expect(existsSync(target) || existsSync(source), `${file}: ${match[1]}`).toBe(true)
  }
 }
 const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
 for (const dependencies of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
  for (const value of Object.values(dependencies ?? {})) expect(value).not.toMatch(/^(?:workspace:|file:|link:)/)
 }
})
it('no_local_classifier_or_other_egress', () => {
 for(const [file,text] of sources()) {
  expect(text,file).not.toMatch(/export function (classify|resolveLevel)\b/)
  expect(text,file).not.toMatch(/node:https?|node:child_process/)
  for(const url of text.match(/https?:\/\/[^\s'"`]+/g) ?? []) {
    // SVG namespace identifiers do not initiate network requests.
    if (url === 'http://www.w3.org/2000/svg') continue
    // github.com is a static help link the user opens in a new tab; the code never fetches it.
    expect(['openrouter.ai','api.typesafe.ai','api.concentrate.ai','example.com','github.com']).toContain(new URL(url).host)
   }
 }
 expect(sources().map(([file])=>file)).not.toContain('classifier.ts')
})
it('skill_contains_eight_rules',()=>{
 const text=skill()
 for(const rule of ['route_subagent','reasoning_effort','[model·effort]','独立','claude/codex','暂停委派并询问用户','新建','子会话 Jev 选模未启用','routed: false','按官方默认委派','只指定模型']) expect(text,rule).toContain(rule)
 expect(text).not.toMatch(/claude-haiku-5-5|claude-fable-5-1|gpt-6-luna|gpt-6-astra|claude-opus-5-5|gpt-6\.1-sol|claude-sonnet-5-5/)
})
it('client_sources_stay_browser_safe',()=>{
 // The client bundle runs in the browser: it may reach only browser-safe modules (no node: built-ins via jev.ts).
 for(const [file,text] of sources().filter(([file])=>file.startsWith('client/')||file==='hints.ts')) {
  expect(text,file).not.toMatch(/from '(\.\.\/)?(\.\/)?(jev|context|index|router|state|judgements)\.js'/)
  expect(text,file).not.toMatch(/node:/)
 }
})
