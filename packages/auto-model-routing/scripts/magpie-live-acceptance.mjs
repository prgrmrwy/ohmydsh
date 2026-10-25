// Authorized minimal synthetic acceptance. No local subscription adapter, no raw history output.
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as Plugin from '../lib/index.js'
const requireHost=createRequire(join(resolve(process.argv[2]),'package.json'))
const load=n=>import(pathToFileURL(requireHost.resolve(`@deepseek-ai/${n}`)))
const [{Context},Agents,Loop,Sessions,Projection,Prompt,Tools,Llm,Subagents,Spawn,SubTool,Environment]=await Promise.all(['cordis','dsh-agent','dsh-agent-loop','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-llm','dsh-subagent','dsh-subagent-spawn-in-process','dsh-tool-subagent','dsh-launch-environment'].map(load))
const magpiePath=resolve(process.argv[3])
const {MagpieAdapter,ModelCatalog}=await import(pathToFileURL(join(magpiePath,'lib/index.js')))
const settings=JSON.parse(await readFile(join(homedir(),'.dsh-magpie-connect/settings.json'),'utf8'))
const launcher=process.argv[4]
const {parseCredentialsDocument}=await import(pathToFileURL(join(resolve(launcher),'node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js')))
const credFile=join(homedir(),'.dsh/.credentials.yaml')
const key=process.env.OPENROUTER_API_KEY??parseCredentialsDocument(await readFile(credFile,'utf8'),credFile).refs.get('OPENROUTER_API_KEY')
assert(key,'Configured Jev credential required')
const home=await mkdtemp(join(tmpdir(),'magpie-live-acceptance-'))
await mkdir(join(home,'plugins/dsh-auto-model-routing'),{recursive:true})
await writeFile(join(home,'plugins/dsh-auto-model-routing/config.json'),JSON.stringify({policy:'policy-v2',defaultMode:'AUTO',timeoutMs:20000}))
const ctx=new Context(),plugins=[],summary=[]
const catalog=new ModelCatalog({baseUrl:settings.baseUrl,apiKey:settings.apiKey,refreshSeconds:3600})
try{
 await catalog.refreshOnce()
 assert.equal(catalog.snapshot().status,'ready','Live gateway catalog required')
 for(const p of [Projection,Sessions,Agents,Prompt,Tools,Llm])plugins.push(await ctx.plugin(p.default))
 const Persistence=await load('dsh-session-persistence-jsonl')
 plugins.push(await ctx.plugin(Persistence.default,{root:join(home,'sessions'),compression:'none'}))
 plugins.push(await ctx.plugin(Loop.default,{agents:[]}))
 const adapter=new MagpieAdapter(catalog,{baseUrl:settings.baseUrl,apiKey:settings.apiKey,maxRetries:0,timeoutMs:120000,firstEventTimeoutMs:90000,idleTimeoutMs:30000})
 ctx.llm.registerAdapter(['dsh-magpie-connect'],adapter)
 ctx.provide('launchEnvironment',Environment.createLaunchEnvironmentSnapshot([{source:'process',values:{OPENROUTER_API_KEY:key}}]))
 ctx.provide('subagentModelSelection',{current:()=>({enabled:true,allowedModels:catalog.list().map(model=>({provider:'dsh-magpie-connect',model}))})})
 plugins.push(await ctx.plugin(Subagents.default));plugins.push(await ctx.plugin(Spawn,{providerName:'spawn'}))
 plugins.push(await ctx.plugin(SubTool,{provider:'spawn',toolName:'subagent',backgroundMode:'continuable',modelSelectionSettings:false}))
 plugins.push(await ctx.plugin(Plugin,{home}))
 const records=[]
 ctx.on('agent/created',({agent})=>{if(agent.session.header.origin==='subagent')records.push(agent);return undefined})
 for(const family of (process.argv.includes('--gpt-only') ? ['codex'] : process.argv.includes('--claude-only') ? ['claude'] : ['claude','codex'])){
 const parent=await ctx.agents.create({sessionId:`acceptance-${family}`,agentOptions:{provider:'dsh-magpie-connect',model:family==='claude'?'claude/claude-opus-5-5':'codex/gpt-6.1-sol',reasoningEffort:'medium',maxTokens:1024}})
 const task='Return only the JSON array of these unique integers sorted ascending: 7,2,7,0,-3,2. No tools, no commentary.'
 const start=performance.now()
 const result=await ctx.tools.execute({name:'subagent',arguments:{description:'synthetic deterministic acceptance',prompt:task,run_in_background:true},agent:parent.agent,callId:`acceptance-${family}`,signal:AbortSignal.timeout(150000)})
 assert(!result.isError,JSON.stringify(result))
 const child=records.at(-1);assert(child);await child.whenIdle()
 const events=child.session.snapshotEvents()
 const request=events.findLast(e=>e.type==='request/header')?.data?.header?.config
 const texts=events.filter(e=>e.type==='assistant/message').flatMap(e=>e.data.message.content.filter(c=>c.type==='text').map(c=>c.text))
 assert(texts.length,`No text output; turn result: ${JSON.stringify(events.findLast(e=>e.type==='turn/end')?.data)}`)
 const output=texts.join('\n').trim().replace(/^```(?:json)?\s*|\s*```$/g,'')
 assert.deepEqual(JSON.parse(output),[-3,0,2,7],'Independent deterministic oracle failed')
 assert.equal(request.provider,'dsh-magpie-connect')
 assert(request.model.startsWith(`${family}/`))
 summary.push({family,policy:'policy-v2',passed:true,request,ms:Math.round(performance.now()-start)})
 console.log(JSON.stringify(summary.at(-1)))
 await parent.dispose()
 }
 await writeFile(join(home,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600})
 console.log('PASS real Magpie + real Jev + official ordinary creation; evidence',join(home,'summary.json'))
}finally{for(const p of plugins.reverse())await p.dispose();catalog.stop?.()}
