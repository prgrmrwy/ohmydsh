import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents, { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Loop from '@deepseek-ai/dsh-agent-loop'
import * as plugin from '../src/index.js'

it('host mounts authenticated routes and routes a real agent', async () => {
 const home=mkdtempSync(join(tmpdir(),'router-host-'))
 const oldHome=process.env.DSH_HOME;process.env.DSH_HOME=home
 const ctx=new Context()
 const calls:GenerateOptions[]=[]
 const routes=new Map<string,{fetch:(r:Request)=>Promise<Response>}>()
 let agent: Awaited<ReturnType<typeof ctx.agents.create>>['agent'] | undefined
 class Adapter extends LlmAdapter {
  async resolveModel(provider:string,model:string){return {provider,id:model,name:model,reasoning:{efforts:['low','medium','xhigh','max'].map(id=>({id:ReasoningEffortId(id),name:id}))}}}
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{calls.push(options);yield {type:'finish',reason:{kind:'stop'}}}
 }
 const forks=[]
 for(const p of [Projections,Sessions,Agents,Prompt,Tools,Llm]) forks.push(await ctx.plugin(p))
 forks.push(await ctx.plugin(Loop,{agents:[]}))
 ctx.llm.registerAdapter(['test'],new Adapter())
 ctx.provide('connection', {fetch:{register(route:{path:string;fetch:(r:Request)=>Promise<Response>}){routes.set(route.path,route);return async()=>{routes.delete(route.path)}}}} as never)
 ctx.provide('sessionController',{resolveAgent:async(id:string)=>agent?.id===id?{agent}:{error:new Error('unknown')}} as never)
 forks.push(await ctx.plugin(plugin))
 // Injection callbacks are asynchronous: wait for the observable route registration.
 await expect.poll(()=>routes.size).toBe(2)
 const selection:ModelSelectionRef={current:{provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('medium')},assembled:undefined}
 const handle=await ctx.agents.create({sessionId:SessionId('host-route'),agentOptions:{provider:'test',model:'claude-opus-5-5'},setup(c){installModelSelection(c,selection)}})
 agent=handle.agent
 const invoke=async(op:string,body:unknown)=>routes.get(`/api/auto-model-routing.${op}`)!.fetch(new Request('http://localhost/api',{method:'POST',body:JSON.stringify(body)}))
 const rpcResponse=await invoke('state',{type:'client-request',rpcId:'probe-1',method:'auto-model-routing.state',payload:{sessionId:agent.id}})
 expect(await rpcResponse.json()).toMatchObject({type:'server-response',rpcId:'probe-1',result:{ok:true}})
 try {
  const response=await invoke('setMode',{sessionId:agent.id,mode:'AUTO'})
  expect(response.status).toBe(200)
  agent.followup(createUserMessage({content:[{type:'text',text:'排查多个模块'}],source:{kind:'user'}}));await agent.whenIdle()
  expect(calls.at(-1)?.reasoningEffort).toBe('xhigh')
  expect(calls.at(-1)?.model).toBe('claude-opus-5-5')
  expect(await (await invoke('state',{sessionId:agent.id})).json()).toMatchObject({mode:'AUTO',reason:'classified',anchor:{reasoningEffort:ReasoningEffortId('medium')}})
  await invoke('setMode',{sessionId:agent.id,mode:'MANUAL'})
  selection.current={provider:'test',model:'claude-opus-5-5',reasoningEffort:ReasoningEffortId('xhigh')}
  agent.followup(createUserMessage({content:[{type:'text',text:'继续'}],source:{kind:'user'}}));await agent.whenIdle()
  expect(calls.at(-1)?.reasoningEffort).toBe('medium')
 }finally{
  await handle.dispose()
  for(const fork of forks.reverse()) await fork.dispose()
  if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
 }
})
