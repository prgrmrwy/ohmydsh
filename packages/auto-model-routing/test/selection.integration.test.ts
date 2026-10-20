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
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach } from 'vitest'
import * as plugin from '../src/index.js'
import { fakeJev, tier } from './fake-jev.js'

const stops: (() => Promise<void>)[] = []
afterEach(async () => { while (stops.length) await stops.pop()!() })

// Real plugin + real AgentLoop + real official selection; Jev is a loopback fake answering `complex`.
async function harness() {
 const ctx=new Context()
 const jev=await fakeJev(tier('complex'))
 ctx.provide('launchEnvironment',createLaunchEnvironmentSnapshot([{source:'process',values:{OPENROUTER_API_KEY:'sk-or-test'}}]) as never)
 for(const p of [Projections,Sessions,Agents,Prompt,Tools,Llm]) await ctx.plugin(p)
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
 const routes=new Map<string,{fetch:(r:Request)=>Promise<Response>}>()
 let current: unknown
 ctx.provide('connection',{fetch:{register(route:{path:string;fetch:(r:Request)=>Promise<Response>}){routes.set(route.path,route);return async()=>{routes.delete(route.path)}}}} as never)
 ctx.provide('sessionController',{resolveAgent:async()=>({agent:current})} as never)
 const fork=await ctx.plugin(plugin,{home:mkdtempSync(`${tmpdir()}/router-sel-`),jevBase:jev.base})
 const selection:ModelSelectionRef={current:{provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('medium')},assembled:undefined}
 const handle=await ctx.agents.create({sessionId:SessionId(`route-${Math.random()}`),agentOptions:{provider:'test',model:'claude-opus-5-5'},setup(agentCtx){installModelSelection(agentCtx,selection)}})
 const agent=handle.agent
 current=agent
 agent.session.append('model/selection',selection.current!)
 agent.ctx.on('agent/request-error',async()=>({kind:'retry'}))
 stops.push(async()=>{await handle.dispose();await fork.dispose();await jev.close()})
 const call=async(op:string,body:unknown)=>(await routes.get(`/api/auto-model-routing.${op}`)!.fetch(new Request('http://x/api',{method:'POST',body:JSON.stringify(body)}))).json()
 async function run(text:string){agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await agent.whenIdle()}
 const setMode=(mode:'AUTO'|'MANUAL')=>call('setMode',{sessionId:agent.id,mode})
 const read=async()=>call('state',{sessionId:agent.id}) as Promise<{restore:boolean;anchor?:unknown}>
 return {ctx,agent,selection,calls,run,handle,setMode,read,jev,failNext:()=>{fail=true}}
}

it('manual_restore_survives_same_step_retry',async()=>{
 const h=await harness()
 try {
 await h.setMode('AUTO');await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('xhigh')
 h.selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('xhigh')}
 await h.setMode('MANUAL');h.failNext();await h.run('继续')
 expect(h.calls.slice(-2).map(c=>c.reasoningEffort)).toEqual(['medium','medium'])
 expect((await h.read()).restore).toBe(true)
 h.selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('medium')}
 await h.run('继续')
 expect((await h.read()).restore).toBe(false)
 }finally{}
})

it.each(['cancel','prepare-failure'] as const)('restore_survives_preheader_failure (%s)',async(failure)=>{
 const h=await harness()
 try {
 await h.setMode('AUTO');await h.run('排查多个模块')
 await h.setMode('MANUAL')
 h.selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('xhigh')}
 let first=true
 h.agent.ctx.on('agent/request',async(_payload,next)=>{const value=await next();if(first){first=false;if(failure==='cancel')h.agent.cancel({kind:'user'});else throw new Error('before prepareCall')}return value},{prepend:true})
 await h.run('继续')
 expect((await h.read()).restore).toBe(true)
 await h.run('继续')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 }finally{}
})

it('selection_after_assembly_keeps_routes_legal',async()=>{
 const h=await harness()
 try {
 await h.setMode('AUTO')
 let switched=false
 h.agent.ctx.on('agent/request',async(_payload,next)=>{
  if(!switched){switched=true;h.selection.current={provider:'test',model:'gpt-6-astra',reasoningEffort:ReasoningEffortId('low')};h.agent.session.append('model/selection',h.selection.current)}
  return next()
 },{prepend:true})
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.model).toBe('claude-opus-5-5')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('xhigh')
 expect(h.ctx.sessionProjections.stateOf(h.agent.session,'modelSelection')?.pending).toMatchObject({model:'gpt-6-astra'})
 await h.setMode('MANUAL');await h.run('继续')
 expect(h.calls.at(-1)?.model).toBe('gpt-6-astra')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('low')
 expect(h.ctx.sessionProjections.stateOf(h.agent.session,'modelSelection')?.pending).toBeNull()
 expect((await h.read() as {anchor?:unknown}).anchor).toMatchObject({model:'gpt-6-astra',reasoningEffort:'low',provenance:'user-selected'})
 }finally{}
})
