import { expect, it } from 'vitest'
import { endpoint, labelEndpoint } from '../src/endpoints.js'
import { RoutingState, type SessionState } from '../src/state.js'
import type { FeedbackBook } from '../src/feedback.js'
function fixture(){
 const disk=new Map<string,SessionState>();const state=new RoutingState({get:id=>disk.get(id),set:(id,value)=>{disk.set(id,value)}})
 const agents=[{id:'S1'},{id:'S2'},{id:'child',origin:'subagent'}]
 for(const agent of agents.slice(0,2)) state.setMode(agent.id,'AUTO')
 return {disk,state,resolve:async(id:string)=>agents.find(a=>a.id===id)}
}
it('spec Scenario "无效会话被拒绝且无副作用"',async()=>{
 const {disk,state,resolve}=fixture();const before=JSON.stringify([...disk])
 for(const body of [{mode:'MANUAL'},{sessionId:42,mode:'MANUAL'},{sessionId:'unknown',mode:'MANUAL'},{sessionId:'child',mode:'MANUAL'},{sessionId:'S1',mode:'bad'}]) {
  const response=await endpoint('setMode',body,resolve,state)
  expect(response.status).toBeGreaterThanOrEqual(400);expect(response.status).toBeLessThan(500)
  expect(JSON.stringify([...disk])).toBe(before)
 }
 expect(state.read('S1').mode).toBe('AUTO')
})
it('spec Scenario "只修改目标会话"',async()=>{
 const {state,resolve}=fixture();const before=state.read('S2')
 expect((await endpoint('setMode',{sessionId:'S1',mode:'MANUAL'},resolve,state)).status).toBe(200)
 expect(state.read('S1')).toEqual({mode:'MANUAL'})
 expect(state.read('S2')).toEqual(before)
 state.disable('S1','rate-limited',5)
 expect(await (await endpoint('state',{sessionId:'S1'},resolve,state)).json()).toMatchObject({disabled:{category:'rate-limited',at:5}})
 await endpoint('setMode',{sessionId:'S1',mode:'AUTO'},resolve,state)
 expect((await (await endpoint('state',{sessionId:'S1'},resolve,state)).json()).disabled).toBeUndefined()
 expect(state.read('S2')).toEqual(before)
})
it('label_rejects_invalid_and_returns_empty_for_unbound',async()=>{
 const {resolve}=fixture()
 const writes:unknown[]=[]
 const book={lookup:(sessionId:string,messageId:string)=>sessionId==='S1'&&messageId==='m2'?{sessionId,messageId,decisionId:1,depth:'higher',model:'claude-opus-5-5',effort:'high'}:undefined,set:(...args:unknown[])=>{writes.push(args)}} as unknown as FeedbackBook
 for(const body of [{sessionId:'S1',messageId:'m2',label:'simple'},{sessionId:'S1',messageId:'m2',feedback:'huge'},{sessionId:'child',messageId:'m2'},{sessionId:'S1',messageId:42},{messageId:'m2'},null]){
  const response=await labelEndpoint(body,resolve,book)
  expect(response.status,JSON.stringify(body)).toBeGreaterThanOrEqual(400);expect(response.status).toBeLessThan(500)
 }
 const unknown=await labelEndpoint({sessionId:'S1',messageId:'m-unknown'},resolve,book)
 expect(unknown.status).toBe(200);expect(await unknown.json()).toEqual({})
 expect(writes).toEqual([])
})
