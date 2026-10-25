// Production plugin + official tool/provider chain, fake LLM/Jev only; no active GUI.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import * as Plugin from '../lib/index.js'
const requireHost = createRequire(join(resolve(process.argv[2]), 'package.json'))
const load = n => import(pathToFileURL(requireHost.resolve(`@deepseek-ai/${n}`)))
const names = ['cordis','dsh-agent','dsh-agent-loop','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-llm','dsh-subagent','dsh-subagent-spawn-in-process','dsh-experimental-agent-team','dsh-tool-subagent','dsh-experimental-tool-agent-team','dsh-session-persistence-jsonl','dsh-session-query-sqlite','dsh-launch-environment']
for (const name of names) {
 const pkg = JSON.parse(await readFile(requireHost.resolve(`@deepseek-ai/${name}/package.json`),'utf8'))
 assert.equal(pkg.version,name === 'cordis' ? '4.0.4' : '0.2.0-rc.2')
}
const [{Context},Agents,Loop,Sessions,Projections,Prompt,Tools,Llm,Subagents,Spawn,Teams,SubTool,TeamTools,Persistence,Query,Environment] = await Promise.all(names.map(load))
const home = await mkdtemp(join(tmpdir(),'policy-v2-official-'))
await mkdir(join(home,'plugins/dsh-auto-model-routing'),{recursive:true})
await writeFile(join(home,'plugins/dsh-auto-model-routing/config.json'),JSON.stringify({ defaultMode:'AUTO' }))
const jevBodies = []
const server = createServer(async (req,res) => {
 let text='';for await(const chunk of req) text+=chunk
 jevBodies.push(JSON.parse(text));res.setHeader('Content-Type','application/json')
 res.end(JSON.stringify({answers:{capability:{choice:'bounded'},depth:{choice:'baseline'}}}))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base = `http://127.0.0.1:${server.address().port}`
const originalFetch = globalThis.fetch
globalThis.fetch = (url,...args) => {
 assert(String(url).startsWith(base+'/'),'External network is forbidden')
 return originalFetch(url,...args)
}
const transport = process.argv.includes('--magpie') ? 'dsh-magpie-connect' : 'claude'
const modelId = id => transport === 'dsh-magpie-connect' ? `claude/${id}` : id
const calls = [], childIds = []
async function host() {
 const ctx=new Context(),plugins=[]
 class Adapter extends Llm.LlmAdapter {
  async listModels(provider){return ['claude-opus-5-5','claude-haiku-5-5','claude-sonnet-5-5'].map(id=>({provider,id:modelId(id),name:id}))}
  async resolveModel(provider,id){return {provider,id,name:id,reasoning:{efforts:['low','medium','high','xhigh'].map(id=>({id,name:id}))}}}
  async *stream(request){calls.push(request);yield {type:'finish',reason:{kind:'stop'}}}
 }
 for(const p of [Projections,Sessions,Agents,Prompt,Tools,Llm])plugins.push(await ctx.plugin(p.default))
 plugins.push(await ctx.plugin(Persistence.default,{root:join(home,'sessions'),compression:'none'}))
 plugins.push(await ctx.plugin(Query.default,{path:':memory:',openAt:'never'}))
 plugins.push(await ctx.plugin(Loop.default,{agents:[]}))
 ctx.llm.registerAdapter([transport],new Adapter())
 ctx.provide('launchEnvironment',Environment.createLaunchEnvironmentSnapshot([{source:'process',values:{OPENROUTER_API_KEY:'synthetic'}}]))
 // Explicit official-policy-shaped catalog seam; no subscriptions adapter or live allowlist is loaded.
 ctx.provide('subagentModelSelection',{current:()=>({enabled:true,allowedModels:['claude-opus-5-5','claude-haiku-5-5','claude-sonnet-5-5'].map(model=>({provider:transport,model:modelId(model)}))})})
 plugins.push(await ctx.plugin(Subagents.default))
 plugins.push(await ctx.plugin(Spawn,{providerName:'spawn'}))
 plugins.push(await ctx.plugin(Teams.default))
 plugins.push(await ctx.plugin(SubTool,{provider:'spawn',toolName:'subagent',backgroundMode:'continuable',modelSelectionSettings:false}))
 plugins.push(await ctx.plugin(TeamTools))
 plugins.push(await ctx.plugin(Plugin,{home,jevBase:base}))
 ctx.on('agent/created',({agent})=>{if(agent.session.header.origin==='subagent')childIds.push(agent.id);return undefined})
 return {ctx,async close(){for(const p of plugins.reverse())await p.dispose()}}
}
const content=text=>[{type:'text',text}]
const signal=AbortSignal.timeout(30_000)
const check=id=>{
 const call=calls.findLast(c=>c.sessionId===id)
 assert(call,`No actual call for ${id}`);assert.equal(call.model,modelId('claude-haiku-5-5'));assert.equal(call.reasoningEffort,'medium')
}
let h
try {
 h=await host()
 let parent=await h.ctx.agents.create({sessionId:'parent',agentOptions:{provider:transport,model:modelId('claude-opus-5-5'),reasoningEffort:'medium'}})
 const invoke=(name,args,id)=>h.ctx.tools.execute({name,arguments:args,agent:parent.agent,callId:id,signal})
 const first=await invoke('subagent',{description:'synthetic task',prompt:'Apply the specified mechanical edit',run_in_background:true},'ordinary')
 assert(!first.isError,JSON.stringify(first))
 const team=await invoke('spawn_teammate',{name:'probe-worker',description:'synthetic',prompt:'Apply exact supplied transformation',context:'fresh'},'team')
 assert(!team.isError,JSON.stringify(team))
 // Official continuable runs naturally settle and unload; observe actual calls by stable identity.
 assert.equal(new Set(childIds).size,2)
 for(const id of new Set(childIds)){
  const live=h.ctx.agents.get(id);if(live)await live.whenIdle();check(id)
 }
 assert.equal(jevBodies.length,2)
 const ids=[...new Set(childIds)]

 await parent.dispose();await h.close()
 h=await host()
 parent=await h.ctx.agents.resume({resumeSessionId:'parent',agentOptions:{provider:transport,model:modelId('claude-opus-5-5'),reasoningEffort:'medium'}})
 await h.ctx.subagents.sendMessage(parent.agent,ids[0],content('new message after full host restart'),{signal})
 const live=h.ctx.agents.get(ids[0]);if(live)await live.whenIdle();check(ids[0])
 await h.ctx.agentTeams.sendMessage(parent.agent,{target:'probe-worker',content:content('later teammate task after cold restart'),signal})
 const member=h.ctx.agents.get(ids[1]);if(member)await member.whenIdle();check(ids[1])
 assert.equal(jevBodies.length,2,'Cold resume must not reclassify')
 await parent.dispose()
 console.log('PASS production plugin + official ordinary/fresh teammate tools/providers + actual fake-adapter request')
 console.log('PASS full host cold resume: exact identity route restored for ordinary and teammate without new Jev calls')
 console.log('LIMIT: synthetic allowlist seam, fake model/Jev; no real provider history compatibility or GUI deployment')
}finally{if(h)await h.close();globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve))}
