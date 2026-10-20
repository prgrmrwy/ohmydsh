import { expect, it } from 'vitest'
import { endpoint } from '../src/endpoints.js'
import { Router } from '../src/router.js'
import { RoutingState, type SessionState } from '../src/state.js'
function fixture(){
 const disk=new Map<string,SessionState>();const state=new RoutingState({get:id=>disk.get(id),set:(id,value)=>{disk.set(id,value)}})
 const agents=[{id:'S1'},{id:'S2'},{id:'child',origin:'subagent'}]
 const router=new Router(state)
 for(const agent of agents.slice(0,2)) router.setMode(agent,'AUTO')
 return {disk,state,router,resolve:async(id:string)=>agents.find(a=>a.id===id)}
}
it('invalid_targets_rejected',async()=>{
 const {disk,state,router,resolve}=fixture();const before=JSON.stringify([...disk])
 for(const body of [{mode:'MANUAL'},{sessionId:42,mode:'MANUAL'},{sessionId:'unknown',mode:'MANUAL'},{sessionId:'child',mode:'MANUAL'},{sessionId:'S1',mode:'bad'}]) {
  const response=await endpoint('setMode',body,resolve,router,state)
  expect(response.status).toBeGreaterThanOrEqual(400);expect(response.status).toBeLessThan(500)
  expect(JSON.stringify([...disk])).toBe(before)
 }
})
it('set_mode_targets_one_session',async()=>{
 const {state,router,resolve}=fixture();const before=state.read('S2')
 expect((await endpoint('setMode',{sessionId:'S1',mode:'MANUAL'},resolve,router,state)).status).toBe(200)
 expect(state.read('S1')).toMatchObject({mode:'MANUAL',restore:true})
 expect(state.read('S2')).toEqual(before)
 const response=await endpoint('state',{sessionId:'S1'},resolve,router,state)
 expect(await response.json()).toMatchObject({mode:'MANUAL',history:[]})
 state.disable('S1','rate-limited',5)
 expect(await (await endpoint('state',{sessionId:'S1'},resolve,router,state)).json()).toMatchObject({disabled:{category:'rate-limited',at:5}})
 await endpoint('setMode',{sessionId:'S1',mode:'AUTO'},resolve,router,state)
 expect((await (await endpoint('state',{sessionId:'S1'},resolve,router,state)).json()).disabled).toBeUndefined()
 expect(state.read('S2')).toEqual(before)
})
