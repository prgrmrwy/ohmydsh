import { describe, expect, it, vi } from 'vitest'
import { createGenerationBackedProvider } from '../src/generation-provider.js'
import { activateGeneration } from '../src/generations.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const homes: string[] = []
async function home() { const h = await mkdtemp(join(tmpdir(), 'dsh-openspec-scope-')); homes.push(h); return h }

describe('update notices', () => {
  it('newer_release_notice_once_in_one_result_without_turn_or_install', async () => {
    const check = vi.fn(async () => ({ installed: '1.13.2', available: '1.13.3', managementEntry: 'dsh-openspec-manage' }))
    const scope = {}
    const h = await home()
    await activateGeneration(h, 'g1', { skills: [{ name: 'openspec-apply-change', body: 'official' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'" })
    const provider = createGenerationBackedProvider({ home: h, telemetry: 'adapter-off', updateCheck: 'enabled', check })
    const result = await provider.get({ name: 'openspec-apply-change' }, { scope } as never)
    expect(result?.content).toContain('notice.available=1.13.3'); expect(check).toHaveBeenCalledTimes(1)
    expect(result?.content).not.toContain('Agent.inject')
  })
  it('racing_model_and_gesture_consumers_spend_notice_once', async () => {
    const check = vi.fn(async () => ({ installed: '1.13.2', available: '1.13.3', managementEntry: 'dsh-openspec-manage' }))
    const scope = {}; const h = await home()
    await activateGeneration(h, 'g1', { skills: [{ name: 's', body: 'b' }], invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'" })
    const provider = createGenerationBackedProvider({ home: h, telemetry: 'adapter-off', updateCheck: 'enabled', check })
    const [a,b] = await Promise.all([provider.get({ name:'s' }, { scope }), provider.get({ name:'s' }, { scope })])
    expect(check).toHaveBeenCalledTimes(1)
    expect([a?.content,b?.content].filter(x=>x?.includes('notice.available=1.13.3'))).toHaveLength(1)
  })
  it('newer_pair_renotifies_and_scope_less_lookup_gets_none', async () => {
    let available='1.13.3'; const check=vi.fn(async()=>({installed:'1.13.2',available,managementEntry:'dsh-openspec-manage'})); const h=await home(); const scope={}
    await activateGeneration(h,'g1',{skills:[{name:'s',body:'b'}],invocation:"env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"})
    const p=createGenerationBackedProvider({home:h,telemetry:'adapter-off',updateCheck:'enabled',check})
    const a=await p.get({name:'s'},{scope}); available='1.13.4'; const b=await p.get({name:'s'},{scope}); const c=await p.get({name:'s'})
    expect(a?.content).toContain('notice.available=1.13.3'); expect(b?.content).toContain('notice.available=1.13.4'); expect(c?.content).not.toContain('notice.available')
  })
  it('notice_state_keyed_to_discarded_scope_is_never_read_or_written', async () => {
    let live=true; let resolveCheck!: (v:any)=>void; const check=vi.fn(()=>new Promise(resolve=>{resolveCheck=resolve})); const h=await home(); const scope={}
    await activateGeneration(h,'g1',{skills:[{name:'s',body:'b'}],invocation:"env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"})
    const p=createGenerationBackedProvider({home:h,telemetry:'adapter-off',updateCheck:'enabled',isScopeLive:()=>live,check: async s=>{ return check() }})
    const pending=p.get({name:'s'},{scope});
    while (!resolveCheck) await new Promise(resolve => setTimeout(resolve, 1))
    live=false; resolveCheck({installed:'1.13.2',available:'1.13.3',managementEntry:'dsh-openspec-manage'})
    expect((await pending)?.content).not.toContain('notice.available')
  })
})
