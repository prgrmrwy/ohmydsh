import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoutingChip, apply } from '../src/client/index.js'
import { callRouting, chipOrder, panelOpenAfter, toastText, nextToast } from '../src/client/control.js'
it('spec Scenario "芯片注册在速度芯片左侧"',()=>{
 expect(chipOrder).toBeLessThan(0)
 const registrations: {name:string;order:number}[] = []
 const ctx={effect:(callback:()=>unknown)=>callback(),slots:{inject:(_name:string,callback:()=>void)=>callback(),register:(options:{name:string;order:number})=>{registrations.push(options);return ()=>{}}}}
 apply(ctx as never)
 expect(registrations).toContainEqual(expect.objectContaining({name:'conversation.input.right',order:-10}))
 expect(registrations).toContainEqual(expect.objectContaining({name:'settings.section',order:300}))
})
it('spec Scenario "切换模式只调用插件接口"',async()=>{
 const calls:unknown[][]=[]
 const rpc={call:async(...args:unknown[])=>{calls.push(args);return {ok:true,value:{mode:'AUTO'}}}}
 expect(await callRouting(rpc,'S','AUTO')).toEqual({mode:'AUTO'})
 expect(calls).toEqual([['/api','auto-model-routing.setMode',{sessionId:'S',mode:'AUTO'}]])
 await callRouting(rpc,'S')
 expect(calls[1]).toEqual(['/api','auto-model-routing.state',{sessionId:'S'}])
})
it('spec Scenario "面板展示本回合状态且无历史"',()=>{
 const view={mode:'AUTO',depth:'higher',effort:'high',reason:'jev'}
 const markup=renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:view as never,initiallyOpen:true})).replace(/<[^>]+>/g,' ')
 for(const text of ['high','jev','AUTO · higher','本回合插件输出']) expect(markup).toContain(text)
 expect(markup).not.toContain('锚点')
})
it('spec Scenario "停用状态在芯片与面板可见"',()=>{
 const base={mode:'MANUAL' as const}
 const render=(view:object,open:boolean)=>renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:view as never,initiallyOpen:open}))
 const chip=render({...base,disabled:{category:'insufficient-credits',at:Date.UTC(2026,9,20,7,0)}},false)
 const visible=chip.replace(/<[^>]+>/g,' ')
 expect(visible).toContain('Jev 停用')
 expect(chip).toMatch(/title="[^"]*余额不足/)
 expect(chip).toContain('data-disabled="true"')
 const panel=render({...base,disabled:{category:'insufficient-credits',at:Date.UTC(2026,9,20,7,0)}},true).replace(/<[^>]+>/g,' ')
 for(const text of ['insufficient-credits','余额不足','点击 AUTO 重试']) expect(panel).toContain(text)
 const normal=render({mode:'MANUAL'},false)
 expect(normal.replace(/<[^>]+>/g,' ')).not.toContain('Jev 停用')
 expect(normal).not.toContain('data-disabled="true"')
})
it('spec Scenario "芯片样式与悬停面板"',()=>{
 const render=(open:boolean)=>renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:{mode:'MANUAL'},initiallyOpen:open}))
 const closed=render(false)
 // One button: mode text first, the switch icon after it; no border.
 expect(closed.match(/<button/g)).toHaveLength(1)
 expect(closed).toMatch(/<button[^>]*>\s*<span[^>]*>MANUAL<\/span>\s*<svg/)
 expect(closed).not.toMatch(/border:1px/)
 expect(closed).toMatch(/border:(none|0)/)
 expect(closed).not.toContain('▾')
 // Panel is not rendered until hover or focus opens it.
 expect(closed).not.toContain('aria-label="自动路由状态"')
 expect(render(true)).toContain('aria-label="自动路由状态"')
 // Hover/focus wiring is a pure function; real pointer timing is checked in the GUI.
 expect((['enter','focus','leave','blur'] as const).map(panelOpenAfter)).toEqual([true,true,false,false])
})
it('decision_hint_shows_once',()=>{
 const d={id:7,source:'main' as const,depth:'higher',effort:'high',status:'applied',confidence:0.9,ms:500}
 let seen:number|undefined
 const shown=nextToast(seen,d)
 expect(shown).toMatchObject({id:7});seen=shown!.id
 expect(nextToast(seen,d)).toBeUndefined()
 expect(nextToast(seen,undefined)).toBeUndefined()
 const markup=renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:{mode:'AUTO'},initialToast:{id:7,lines:toastText(d)}}))
 expect(markup).toContain('role="status"')
 expect(markup).toContain('主会话 · 已应用')
 expect(markup).toContain('pointer-events:none')
})
it('spec Scenario "悬停面板显示最近一次决策分布"',()=>{
 const render=(view:object)=>renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:view as never,initiallyOpen:true})).replace(/<[^>]+>/g,' ')
 const panel=render({mode:'AUTO',decision:{id:1,source:'main',tier:'higher',depth:'higher',status:'applied',probabilities:{baseline:0.3,higher:0.7},provider:'claude',model:'claude-opus-5-5',effort:'high',ms:780,decisionProvider:'openrouter',decisionModel:'typesafe/jev-1.13'}})
 expect(panel).toContain('最近决策')
 expect(panel).toContain('主会话 · 已应用')
 expect(panel).toContain('投入分布：baseline 30% / higher 70%')
 expect(render({mode:'AUTO'})).not.toContain('最近决策')
})
it('locked_chip_explains_the_claude_gpt_support_scope',()=>{
 const view={mode:'MANUAL',autoSupport:{supported:false,provider:'opencode-go',model:'deepseek-v4.1-flash'}}
 const markup=renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:view as never,initiallyOpen:true}))
 expect(markup).toContain('data-locked="true"')
 expect(markup).toContain('aria-disabled="true"')
 expect(markup).toContain('data-info-outline="true"')
 expect(markup).toContain('仅支持 Claude / GPT')
 expect(markup).toContain('https://github.com/prgrmrwy/dsh-auto-model-routing')
 expect(markup).toContain('target="_blank"')
 expect(markup).not.toContain('amr-swap')
 expect(markup).not.toContain('点击切换自动推理强度')
 const supported=renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:{mode:'MANUAL',autoSupport:{supported:true}} as never,initiallyOpen:false}))
 expect(supported).toContain('amr-swap')
 expect(supported).not.toContain('data-locked="true"')
 expect(supported).toContain('点击切换自动推理强度')
})
