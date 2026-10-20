import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Real package-owned projection; do not reproduce the fold in the test.
const require = createRequire(import.meta.url)
const controllerEntry = require.resolve('@deepseek-ai/dsh-api-session-controller')
const { installModelSelectionProjection } = await import(pathToFileURL(resolve(dirname(controllerEntry), 'types/model-selection-projection.js')).href)
import { Context } from '@deepseek-ai/cordis'
import Agents, { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, LlmError, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Loop from '@deepseek-ai/dsh-agent-loop'
import { Router } from '../src/router.js'
import { RoutingState, type SessionState } from '../src/state.js'

async function harness() {
 const ctx=new Context()
 for(const plugin of [Projections,Sessions,Agents,Prompt,Tools,Llm]) await ctx.plugin(plugin)
 await ctx.plugin(Loop,{agents:[]})
 installModelSelectionProjection(ctx)
 const calls: GenerateOptions[]=[]
 let fail=false
 class Adapter extends LlmAdapter {
  async resolveModel(provider:string,model:string) { return {provider,id:model,name:model,reasoning:{efforts:['low','medium','high','xhigh','max'].map(id=>({id:ReasoningEffortId(id),name:id}))}} }
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
   calls.push(options)
   if(fail){fail=false;throw new LlmError('injected retry','TEST')}
   yield {type:'finish',reason:{kind:'stop'}}
  }
 }
 ctx.llm.registerAdapter(['test'],new Adapter())
 const disk=new Map<string,SessionState>()
 const state=new RoutingState({get:id=>disk.get(id),set:(id,value)=>{disk.set(id,value)}})
 const router=new Router(state)
 const selection:ModelSelectionRef={current:{provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('medium')},assembled:undefined}
 const handle=await ctx.agents.create({sessionId:SessionId('route-test'),agentOptions:{provider:'test',model:'claude-opus-5-5'},setup(agentCtx){installModelSelection(agentCtx,selection)}})
 const agent=handle.agent
 state.select(agent.id,{provider:'test',model:'claude-opus-5-5',reasoningEffort:'medium'})
 agent.ctx.on('agent/pre-step',async(payload,next)=>{if(payload.step===1&&router.begin(agent,payload.turn,payload.messages))router.resolve(agent,payload.turn,'complex');return next()})
 agent.ctx.on('agent/request',async(payload,next)=>{
  const config=await next()
  return router.request(agent,payload.turn,config as never,['low','medium','high','xhigh','max'],agent.session.requestHeader()?.config as never) as unknown as typeof config
 },{prepend:true})
 agent.ctx.on('agent/request-error',async()=>({kind:'retry'}))
 async function run(text:string){agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await agent.whenIdle()}
 return {ctx,agent,router,state,selection,calls,run,handle,failNext:()=>{fail=true}}
}

it('restore_survives_retry_until_convergence',async()=>{
 const h=await harness()
 try {
 h.router.setMode(h.agent,'AUTO');await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('xhigh')
 h.selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('xhigh')}
 h.router.setMode(h.agent,'MANUAL');h.failNext();await h.run('继续')
 expect(h.calls.slice(-2).map(c=>c.reasoningEffort)).toEqual(['medium','medium'])
 expect(h.state.read(h.agent.id).restore).toBe(true)
 h.selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('medium')}
 await h.run('继续')
 expect(h.state.read(h.agent.id).restore).toBe(false)
 }finally{await h.handle.dispose()}
})

it.each(['cancel','prepare-failure'] as const)('restore_survives_preheader_failure (%s)',async(failure)=>{
 const h=await harness()
 try {
 h.router.setMode(h.agent,'AUTO');await h.run('排查多个模块')
 h.router.setMode(h.agent,'MANUAL')
 h.selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('xhigh')}
 let first=true
 h.agent.ctx.on('agent/request',async(_payload,next)=>{const value=await next();if(first){first=false;if(failure==='cancel')h.agent.cancel({kind:'user'});else throw new Error('before prepareCall')}return value},{prepend:true})
 await h.run('继续')
 expect(h.state.read(h.agent.id).restore).toBe(true)
 await h.run('继续')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 }finally{await h.handle.dispose()}
})

it('selection_after_assembly_keeps_routes_legal',async()=>{
 const h=await harness()
 try {
 h.router.setMode(h.agent,'AUTO')
 let switched=false
 h.agent.ctx.on('agent/request',async(_payload,next)=>{
  if(!switched){switched=true;h.selection.current={provider:'test',model:'gpt-6-astra',reasoningEffort:ReasoningEffortId('low')};h.state.select(h.agent.id,{provider:'test',model:'gpt-6-astra',reasoningEffort:'low'});h.agent.session.append('model/selection',h.selection.current)}
  return next()
 },{prepend:true})
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.model).toBe('claude-opus-5-5')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('xhigh')
 expect(h.ctx.sessionProjections.stateOf(h.agent.session,'modelSelection')?.pending).toMatchObject({model:'gpt-6-astra'})
 h.router.setMode(h.agent,'MANUAL');await h.run('继续')
 expect(h.calls.at(-1)?.model).toBe('gpt-6-astra')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('low')
 expect(h.ctx.sessionProjections.stateOf(h.agent.session,'modelSelection')?.pending).toBeNull()
 }finally{await h.handle.dispose()}
})
