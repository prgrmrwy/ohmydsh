import { afterEach, expect, it, vi } from 'vitest'
import { JevClient } from '../src/jev.js'
import { DECISION_SERVICES, resolveDecisionService, validDecisionEndpoint, type DecisionConfig } from '../src/decision-service.js'
import { toastText } from '../src/client/control.js'
afterEach(()=>vi.unstubAllGlobals())
it('validates exact endpoints and preserves explicit model identity',()=>{
 for(const p of ['openrouter','typesafe','concentrate'] as const) expect(resolveDecisionService({provider:p}).endpoint).toBe(DECISION_SERVICES[p].endpoint)
 for(const url of ['http://remote.test/x','https://user:key@host/x','https://host/x?key=secret','https://host/x#secret','file:///tmp/x',''])expect(validDecisionEndpoint(url)).toBe(false)
 expect(validDecisionEndpoint('http://127.0.0.1:8000/v1/systemone')).toBe(true)
 expect(resolveDecisionService({provider:'custom',endpoint:'https://my.example/v1/systemone',model:'jev-1.14.0'}).model).toBe('jev-1.14.0')
})
it('snapshots provider before async credential resolution and never mixes key or follows redirects',async()=>{
 let config:DecisionConfig={provider:'typesafe'}
 const requests:{url:string;init:RequestInit}[]=[];const refs:string[]=[]
 vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{requests.push({url,init});return Response.json({answers:{depth:{choice:'higher',confidence:.83,probabilities:{higher:.9,baseline:.1,bad:2}},capability:{choice:'analytical',confidence:.61}}})})
 const client=new JevClient({get:async name=>{refs.push(name);config={provider:'concentrate'};return {value:'synthetic-test-key'}}},undefined,3000,()=>config)
 const result=await client.judgePolicy('public synthetic task',new AbortController().signal,'child')
 expect(result).toMatchObject({decisionProvider:'typesafe',decisionModel:'jev-1.13.0',confidence:.83,capabilityConfidence:.61,probabilities:{higher:.9,baseline:.1}})
 expect((result as {probabilities:object}).probabilities).not.toHaveProperty('bad')
 expect(refs).toEqual(['TYPESAFE_API_KEY']);expect(requests[0]?.url).toBe(DECISION_SERVICES.typesafe.endpoint);expect(requests[0]?.init.redirect).toBe('error')
 await client.judgePolicy('public task',new AbortController().signal,'main');expect(refs[1]).toBe('CONCENTRATE_API_KEY')
})
it('all presets send their own key and model, errors never fall back',async()=>{
 const urls:string[]=[];const refs:string[]=[]
 vi.stubGlobal('fetch',async(url:string)=>{urls.push(url);return Response.json({}, {status:451})})
 for(const provider of ['openrouter','typesafe','concentrate'] as const){
  const client=new JevClient({get:name=>{refs.push(name);return {value:'synthetic-key'}}},undefined,3000,()=>({provider}))
  expect(await client.judgePolicy('public task',new AbortController().signal,'main')).toEqual({kind:'failed',category:'region-blocked'})
 }
 expect(refs).toEqual(['OPENROUTER_API_KEY','TYPESAFE_API_KEY','CONCENTRATE_API_KEY']);expect(urls).toHaveLength(3)
})
it('shows each dimension distribution in policy order including zero and context outcomes',()=>{
 const text=toastText({id:2,source:'subagent',tier:'bounded',depth:'baseline',capability:'bounded',effort:'medium',ms:1,probabilities:{higher:.2,lower:0,baseline:.8},capabilityProbabilities:{frontier:.1,bounded:.6,analytical:.25,insufficient_context:.05}}).join('\n')
 expect(text).toContain('能力分布：bounded 60% / analytical 25% / frontier 10% / insufficient_context 5%')
 expect(text).toContain('投入分布：lower 0% / baseline 80% / higher 20%')
})
it('missing confidences remain unknown rather than a synthetic total',()=>{
 const text=toastText({id:1,source:'subagent',tier:'bounded',depth:'baseline',capability:'bounded',effort:'medium',confidence:.8,ms:42,status:'applied'}).join('\n')
 expect(text).toContain('已应用');expect(text).toContain('能力 bounded · 判定确定度 未提供');expect(text).toContain('投入 baseline · 判定确定度 80%');expect(text).toContain('不是任务成功率');expect(text).toContain('能力分布：未提供');expect(text).toContain('投入分布：未提供')
})
