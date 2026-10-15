import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoutingChip, apply } from '../src/client/index.js'
import { callRouting, chipOrder } from '../src/client/control.js'
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
  router.begin(agent,turn,[{source:{kind:'user'},content:[{type:'text',text:'排查多个模块'}]}])
  router.request(agent,turn,{provider:'claude',model:'claude-opus-5-5',reasoningEffort:'medium'},['medium','xhigh'])
 }
 expect(router.status(agent)).toMatchObject({effort:'xhigh',reason:'classified'})
 expect(router.status(agent).history).toHaveLength(20)
 const view={...state.read(agent.id),...router.status(agent)}
 const markup=renderToStaticMarkup(createElement(RoutingChip,{sessionId:agent.id,rpc:{call:async()=>({ok:true})},initialView:view,initiallyOpen:true}))
 expect(markup).toContain('claude-opus-5-5')
 expect(markup).toContain('xhigh')
 expect(markup).toContain('classified')
 expect(markup.match(/<li>/g)).toHaveLength(20)
 expect(new Router(state).status(agent).history).toHaveLength(0)
})
