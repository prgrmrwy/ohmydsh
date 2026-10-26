import { expect, it } from 'vitest'
import { mapCatalog } from '../src/host/catalog.js'
import { isVisible, validateVisibility, visibleCatalog } from '../src/host/visibility.js'
import { SettingsController } from '../src/host/routes.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { vi } from 'vitest'
const models = mapCatalog({ data: ['claude/opus','claude/fable','deepseek/flash','codex/nova'].map(id=>({id})) })
it('spec Scenario "未设置时跟随网关"', () => { expect(visibleCatalog(models, {}).map(m=>m.info.id)).toContain('codex/nova'); expect(validateVisibility({future:['unknown']})).toEqual({future:['unknown']}) })
it('spec Scenario "设置后严格按白名单与目录求交集"', () => {
 const saved={claude:['claude/opus','claude/haiku'],deepseek:[]}
 expect(visibleCatalog(models,saved).map(m=>m.info.id)).toEqual(['claude/opus','codex/nova'])
 expect(isVisible(models[1]!,saved)).toBe(false); expect(saved.claude).toContain('claude/haiku')
})
it('settings supports partial preferences and validates the entire update before writing',async()=>{
 const store=new SettingsStore();const set=vi.fn();const runtime=new MagpieRuntime({describe:async()=>({configured:false,writable:true}),resolve:async()=>undefined,set,unset:vi.fn()} as never,store)
 const settings=new SettingsController(runtime)
 expect((await settings.handle({visibleModels:{deepseek:[]}})).status).toBe(200)
 expect(store.value.visibleModels).toEqual({deepseek:[]})
 expect((await settings.handle({key:'new-key',visibleModels:{codex:'wrong'}})).status).toBe(400)
 expect(set).not.toHaveBeenCalled();expect(store.value.visibleModels).toEqual({deepseek:[]})
 await runtime.dispose()
})
it('spec Scenario "形状非法被拒绝"', () => { for(const bad of [null,[],{codex:'codex/luna'},{codex:[1]}]) expect(()=>validateVisibility(bad)).toThrow() })
