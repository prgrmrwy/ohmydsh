import { expect,it } from 'vitest'
import { mapCatalog } from '../src/host/catalog.js'
import { updateDefaultEffort,withDefaultEffort } from '../src/host/default-effort.js'
const catalog=(levels:string[])=>mapCatalog({data:[{id:'codex/astra',reasoning_levels:levels}]})
it('spec Scenario "设置与清除"',()=>{const models=catalog(['high']);let saved=updateDefaultEffort({},{model:'codex/astra',effort:'high'},models);expect(withDefaultEffort(models[0]!,saved).reasoning?.defaultEffort).toBe('high');saved=updateDefaultEffort(saved,{model:'codex/astra',effort:null},models);expect(withDefaultEffort(models[0]!,saved).reasoning).not.toHaveProperty('defaultEffort')})
it('rejects malformed defaults and clears missing models without deleting other preferences',()=>{
 for(const input of [null,[],{model:'codex/astra'},{model:'codex/astra',effort:1},{model:'codex/astra',effort:'high',extra:true},{model:'missing',effort:'high'}]) expect(()=>updateDefaultEffort({},input,catalog(['high']))).toThrow()
 expect(updateDefaultEffort({'gone':'old','codex/astra':'high'},{model:'gone',effort:null},catalog(['high']))).toEqual({'codex/astra':'high'})
})
it('spec Scenario "拒绝非法档位"',()=>{expect(()=>updateDefaultEffort({},{model:'codex/astra',effort:'low'},catalog(['max']))).toThrow()})
it('spec Scenario "档位失效时不下发，恢复后重新下发"',()=>{const saved={'codex/astra':'ultra'};expect(withDefaultEffort(catalog(['high'])[0]!,saved).reasoning).not.toHaveProperty('defaultEffort');expect(withDefaultEffort(catalog(['ultra'])[0]!,saved).reasoning?.defaultEffort).toBe('ultra');expect(saved).toEqual({'codex/astra':'ultra'})})
