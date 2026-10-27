import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsHost } from '../src/settings-host.js'
import { SettingsStore } from '../src/settings.js'

function fixture(credentials?: unknown) {
 const ctx = new Context()
 ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source:'process', values:{ OPENROUTER_API_KEY:'test-secret' } }]) as never)
 if (credentials) ctx.provide('credentials', credentials as never)
 ctx.provide('llm', {
  listProviders: () => [{ id:'codex' }],
  listModels: async () => [{ id:'good', name:'Good' },{ id:'broken', name:'Broken' }],
  resolveModelInfo: async (_provider:string,model:string) => { if(model==='broken') throw new Error('catalog failure'); return { reasoning:{efforts:[{id:'medium'}]} } },
 } as never)
 return settingsHost(ctx,new SettingsStore(join(mkdtempSync(join(tmpdir(),'amr-settings-host-')),'config.json')))
}
it.each(['dsh-magpie-connect','dsh-magpie-connector'])('%s catalog and allowlist include only registry providers',async(provider)=>{
 const ctx=new Context()
 ctx.provide('launchEnvironment',createLaunchEnvironmentSnapshot([{source:'process',values:{}}]) as never)
 ctx.provide('llm',{listProviders:()=>[{id:provider},{id:'opencode-go'}],listModels:async()=>[{id:'opencode-go/kimi-k3',name:'Kimi'}],resolveModelInfo:async()=>({reasoning:{efforts:[{id:'high'}],defaultEffort:'high'}})} as never)
 ctx.provide('subagentModelSelection' as never,{current:()=>({enabled:true,allowedModels:[{provider:provider,model:'opencode-go/kimi-k3'},{provider:'opencode-go',model:'opencode-go/kimi-k3'}]})} as never)
 const store=new SettingsStore(join(mkdtempSync(join(tmpdir(),'magpie-catalog-')),'config.json'))
 const catalog=await settingsHost(ctx,store).catalog()
 expect(catalog.models).toEqual([expect.objectContaining({provider,model:'opencode-go/kimi-k3',defaultEffort:'high'})])
 expect(catalog.childAllowlist.allowedModels).toEqual([{provider,model:'opencode-go/kimi-k3'}])
})
it('provider keys are explicit and cannot mutate another service credential',async()=>{
 const writes:unknown[]=[];const refs:unknown[]=[]
 const host=fixture({describe:async(ref:unknown)=>{refs.push(ref);return {configured:false,writable:true}},set:async(ref:unknown,value:string)=>{writes.push([ref,value])},resolve:async(ref:unknown)=>{refs.push(ref);return undefined}})
 expect((await host.endpoint('setKey',{provider:'typesafe',value:'synthetic-key'})).status).toBe(200)
 expect(JSON.stringify(writes)).toContain('TYPESAFE_API_KEY');expect(JSON.stringify(writes)).not.toContain('OPENROUTER_API_KEY')
 expect((await host.endpoint('setKey',{provider:'invalid',value:'synthetic-key'})).status).toBe(400)
 expect(writes).toHaveLength(1)
})
it('readonly_credentials_refuse_both_write_operations_without_leaking',async()=>{
 let writes=0
 const host=fixture({describe:async()=>({configured:true,source:'env',writable:false}),set:async()=>{writes++},unset:async()=>{writes++}})
 for(const value of ['new-secret',null]){
  const response=await host.endpoint('setKey',{value})
  expect(response.status).toBe(409)
  expect(await response.text()).not.toContain('new-secret')
 }
 expect(writes).toBe(0)
})
it('credential_service_failure_never_echoes_error_or_uses_environment_fallback',async()=>{
 const host=fixture({describe:async()=>({configured:true,writable:true}),set:async()=>{throw new Error('test-secret')},resolve:async()=>{throw new Error('secret-resolve')}})
 const response=await host.endpoint('setKey',{value:'new-secret'})
 expect(response.status).toBe(500)
 expect(await response.text()).not.toContain('test-secret')
 await expect(host.credential('OPENROUTER_API_KEY')).rejects.toThrow('secret-resolve')
})
it('absent_credentials_read_launch_environment_and_failed_models_do_not_hide_healthy_catalog',async()=>{
 const host=fixture()
 expect((await host.credential('OPENROUTER_API_KEY'))?.value).toBe('test-secret')
 const view=await host.read()
 expect(view.models).toEqual([{provider:'codex',model:'good',name:'Good',reasoningEfforts:['medium']}])
 expect(view.childAllowlist.status).toBe('unavailable')
 expect(view.key).toMatchObject({configured:true,writable:false,available:false})
 expect(JSON.stringify(view)).not.toContain('test-secret')
})
