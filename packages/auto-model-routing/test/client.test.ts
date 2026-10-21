import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoutingChip, apply } from '../src/client/index.js'
import { callRouting, chipOrder, panelOpenAfter, toastText, nextToast } from '../src/client/control.js'
import { Router } from '../src/router.js'
import { RoutingState, type SessionState } from '../src/state.js'
it('chip_negative_order',()=>{
 expect(chipOrder).toBeLessThan(0)
 let registration: {name:string;order:number} | undefined
 const ctx={slots:{inject:(_name:string,callback:()=>void)=>callback(),register:(options:{name:string;order:number})=>{registration=options;return ()=>{}}}}
 apply(ctx as never)
 expect(registration).toMatchObject({name:'conversation.input.right',order:-10})
})
it('toggle_plugin_endpoint_only',async()=>{
 const calls:unknown[][]=[]
 const rpc={call:async(...args:unknown[])=>{calls.push(args);return {ok:true,value:{mode:'AUTO'}}}}
 expect(await callRouting(rpc,'S','AUTO')).toEqual({mode:'AUTO'})
 expect(calls).toEqual([['/api','auto-model-routing.setMode',{sessionId:'S',mode:'AUTO'}]])
 await callRouting(rpc,'S')
 expect(calls[1]).toEqual(['/api','auto-model-routing.state',{sessionId:'S'}])
})
it('panel_state_and_history_bound',()=>{
 const disk=new Map<string,SessionState>();const state=new RoutingState({get:id=>disk.get(id),set:(id,value)=>{disk.set(id,value)}})
 const router=new Router(state),agent={id:'S'}
 router.setMode(agent,'AUTO')
 for(let turn=1;turn<=25;turn++){
  if(router.begin(agent,turn,[{source:{kind:'user'},content:[{type:'text',text:'排查多个模块'}]}]))router.resolve(agent,turn,'complex')
  router.request(agent,turn,{provider:'claude',model:'claude-opus-5-5',reasoningEffort:'medium'},['medium','xhigh'])
 }
 expect(router.status(agent)).toMatchObject({effort:'xhigh',reason:'jev'})
 expect(router.status(agent).history).toHaveLength(20)
 const view={...state.read(agent.id),...router.status(agent)}
 const markup=renderToStaticMarkup(createElement(RoutingChip,{sessionId:agent.id,rpc:{call:async()=>({ok:true})},initialView:view,initiallyOpen:true}))
 expect(markup).toContain('xhigh')
 expect(markup).toContain('本回合插件输出')
 expect(markup).not.toContain('锚点')
 expect(markup).toContain('jev')
 expect(markup).not.toMatch(/<li>|<ol/)
 expect(new Router(state).status(agent).history).toHaveLength(0)
})
it('disabled_visible_in_chip_and_panel',()=>{
 const base={mode:'MANUAL' as const,history:[{reason:'jev-failed',category:'insufficient-credits'}]}
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
it('chip_style_and_hover_panel',()=>{
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
it('toast_once_and_expires',()=>{
 expect(toastText({id:1,source:'main',tier:'complex',effort:'xhigh',confidence:0.92,probabilities:{escalated:0.03,simple:0.01,complex:0.92,standard:0.04},ms:530}))
  .toEqual(['主会话判断 · complex → xhigh · 置信 92% · 0.53s','simple 1% / standard 4% / complex 92% / escalated 3%'])
 expect(toastText({id:2,source:'subagent',tier:'complex',model:'claude-opus-5-5',effort:'xhigh',confidence:0.8,ms:1234}))
  .toEqual(['子会话判断 · complex → claude-opus-5-5 · xhigh · 置信 80% · 1.23s'])
 expect(toastText({id:3,source:'main',tier:'simple',effort:'low',probabilities:{simple:1},ms:400}))
  .toEqual(['主会话判断 · simple → low · 0.40s','simple 100%'])
 // Only a new id shows; the same id never re-shows; it expires after 1 second.
 let seen:number|undefined
 let shown=nextToast(seen,{id:7,source:'main',tier:'complex',effort:'xhigh',confidence:0.9,ms:500})
 expect(shown).toMatchObject({id:7});seen=shown!.id
 expect(nextToast(seen,{id:7,source:'main',tier:'complex',effort:'xhigh',confidence:0.9,ms:500})).toBeUndefined()
 expect(nextToast(seen,undefined)).toBeUndefined()
 const markup=renderToStaticMarkup(createElement(RoutingChip,{sessionId:'S',rpc:{call:async()=>({ok:true})},initialView:{mode:'AUTO'},initialToast:{id:7,lines:['主会话判断 · complex → xhigh','simple 1% / complex 99%']}}))
 expect(markup).toContain('role="status"')
 expect(markup).toContain('主会话判断 · complex → xhigh')
 expect(markup).toContain('simple 1% / complex 99%')
 expect(markup).toContain('pointer-events:none')
})
