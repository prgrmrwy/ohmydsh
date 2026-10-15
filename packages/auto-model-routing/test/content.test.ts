import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const skillPath = resolve(import.meta.dirname, '../../../skills/subagent-model-routing/SKILL.md')
const skill = () => existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : ''
it('source_has_no_egress_primitives', () => {
 const root=resolve(import.meta.dirname,'../src')
 for(const file of readdirSync(root,{recursive:true,encoding:'utf8'}).filter(name=>name.endsWith('.ts'))) {
  expect(readFileSync(resolve(root,file),'utf8')).not.toMatch(/fetch\(|node:https?|node:child_process/)
 }
})
it('skill_required_guidance',()=>{
 for(const text of ['reasoning_effort','[model·effort]','新建','独立','list_subagent_models','允许','不可用']) expect(skill()).toContain(text)
})
it('skill_tier_table',()=>{
 for(const row of [
  '| simple | claude-haiku-5-5 / low | gpt-6-luna / medium |',
  '| standard | claude-sonnet-5-5 / medium | gpt-6.1-sol / medium |',
  '| complex | claude-opus-5-5 / xhigh | gpt-6.1-sol / xhigh |',
  '| escalated | claude-fable-5-1 / high | gpt-6-astra / medium |',
 ]) expect(skill()).toContain(row)
})
it('skill_provider_family',()=>{
 const rows=skill().split('\n').filter(row=>/^\| (simple|standard|complex|escalated) \|/.test(row))
 expect(rows).toHaveLength(4)
 for(const row of rows){const cells=row.split('|').map(s=>s.trim()); expect(cells[2]).toMatch(/^claude-/);expect(cells[3]).not.toMatch(/^claude-/)}
})
