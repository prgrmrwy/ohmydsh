import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const skillPath = resolve(import.meta.dirname, '../../../skills/subagent-model-routing/SKILL.md')
const skill = () => existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : ''
const sources = () => {
 const root=resolve(import.meta.dirname,'../src')
 return readdirSync(root,{recursive:true,encoding:'utf8'}).filter(name=>name.endsWith('.ts')).map(file=>[file,readFileSync(resolve(root,file),'utf8')] as const)
}
it('no_local_classifier_or_other_egress', () => {
 for(const [file,text] of sources()) {
  expect(text,file).not.toMatch(/export function (classify|resolveLevel)\b/)
  expect(text,file).not.toMatch(/node:https?|node:child_process/)
  for(const url of text.match(/https?:\/\/[^\s'"`]+/g) ?? []) {
    // SVG namespace identifiers do not initiate network requests.
    if (url === 'http://www.w3.org/2000/svg') continue
    expect(new URL(url).host,file).toBe('openrouter.ai')
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
