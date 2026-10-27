import {expect,it} from 'vitest'
import {mapCatalog} from '../src/host/catalog.js'
import {SpeedController} from '../src/host/speed.js'
const models=mapCatalog({data:[{id:'codex/responses',service_tiers:[{id:'priority'}],native_endpoints:['/v1/responses']},{id:'codex/chat',service_tiers:[{id:'priority'}]},{id:'deepseek/flash'}]})
it('spec Scenario "快速模式请求带 priority（两种协议）"',()=>{const c=new SpeedController();c.set('S','fast');for(const m of models.slice(0,2))expect(c.priority('S',m)).toBe('priority');expect(c.get('S',models)).toEqual({tier:'fast',fastModels:['codex/responses','codex/chat']})})
it('spec Scenario "标准模式与其它会话不带字段"',()=>{const c=new SpeedController();c.set('A','fast');expect(c.get('A').tier).toBe('fast');expect(c.priority('B',models[0]!)).toBeUndefined();c.set('A','standard');expect(c.priority('A',models[0]!)).toBeUndefined();expect(c.get('A').tier).toBe('standard')})
it('spec Scenario "不支持的模型不显示且不带字段"',()=>{const c=new SpeedController();c.set('S','fast');expect(c.get('S',models).fastModels).toContain('codex/responses');expect(c.get('S',models).fastModels).not.toContain('deepseek/flash');expect(c.priority('S',models[2]!)).toBeUndefined()})
it('spec Scenario "host 重启后回到标准"',()=>{const c=new SpeedController();c.set('S','fast');expect(c.get('S').tier).toBe('fast');expect(new SpeedController().priority('S',models[0]!)).toBeUndefined();expect(new SpeedController().get('S').tier).toBe('standard')})
it('spec Scenario "非法 tier 被拒绝"',()=>{const c=new SpeedController();expect(()=>c.set('S','turbo')).toThrow();expect(c.get('S').tier).toBe('standard');for(const session of ['',null,'x'.repeat(257)])expect(()=>c.set(session,'fast')).toThrow()})
