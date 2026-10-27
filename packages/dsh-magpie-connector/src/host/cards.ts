import type { Generation, MagpieRuntime, Operation } from './runtime.js'
import type { Card } from '../client/view-model.js'
type Target = {all:true} | {provider:string;user?:string}
interface Result { status:number; body:{status:'ok'|'forbidden'|'error'|'unconfigured';cards:Card[];error?:string} }
interface State { cards:Card[]; seq:number; committed:number; read?:Promise<Result>; gate?:{target:Target;promise:Promise<Result>} }
const record=(v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
function pick(raw:Record<string,unknown>, fields:string[], redact:(s:string)=>string) {
  const result:Record<string,unknown>={}
  for(const k of fields) {
    const v=raw[k]
    if(typeof v==='string')result[k]=redact(v)
    else if(typeof v==='boolean' || (typeof v==='number' && Number.isFinite(v)))result[k]=v
  }
  return result
}
export function projectCards(body:unknown, redact:(s:string)=>string):Card[] {
  if (!record(body) || !Array.isArray(body.data)) throw new Error('Invalid cards response')
  return body.data.flatMap(raw=>{
    if (!record(raw) || typeof raw.provider!=='string' || !raw.provider) return []
    const card=pick(raw,['provider','name','icon','user','plan','until','renew','balance','readAt','asOf','error'],redact)
    if (Array.isArray(raw.windows)) card.windows=raw.windows.filter(record).map(w=>pick(w,['name','used','resetsAt','unlimited','display'],redact)) as never
    if (record(raw.resets)) card.resets=pick(raw.resets,['count','until'],redact) as never
    return [card as unknown as Card]
  })
}
export class CardsController {
  constructor(readonly runtime:MagpieRuntime) {}
  private state(gen:Generation):State { return (gen.magpieCards ??= {cards:[],seq:0,committed:0}) as State }
  private stale():Result { return {status:409,body:{status:'error',cards:[],error:'MAGPIE_GENERATION_CHANGED'}} }
  private response(result:Result) { return Response.json(result.body,{status:result.status}) }
  private validate(body:unknown,state:State):Target {
    if (!record(body)) throw new Error('Invalid refresh target')
    const keys=Object.keys(body)
    if (body.all===true && keys.length===1) return {all:true}
    if (keys.some(k=>!['provider','user'].includes(k)) || typeof body.provider!=='string' || !body.provider || ('user' in body && typeof body.user!=='string')) throw new Error('Invalid refresh target')
    const target={provider:body.provider,...('user' in body ? {user:body.user as string} : {})}
    if (!state.cards.some(c=>c.provider===target.provider && c.user===target.user)) throw new Error('Unknown refresh target')
    return target
  }
  private async send(op:Operation,state:State,target?:Target):Promise<Result> {
    const {gen,key}=op
    if (!this.runtime.isCurrent(gen)) return this.stale()
    if (!gen.baseUrl || !key) return {status:200,body:{status:'unconfigured',cards:[]}}
    const seq=++state.seq
    let path=target ? '/magpie/quotas/refresh' : '/magpie/quotas/cards'
    if (target && !('all' in target)) path+=`?provider=${encodeURIComponent(target.provider)}${target.user===undefined?'':`&user=${encodeURIComponent(target.user)}`}`
    let httpError: string | undefined
    try {
      const response=await this.runtime.transport.request(op,target?'POST':'GET',path,{signal:gen.bgAbort.signal})
      if (!response.ok) {
        httpError=`HTTP ${response.status}: ${this.runtime.formatErrorBody(await response.text())}`
        throw Object.assign(new Error(httpError),{status:response.status})
      }
      const cards=projectCards(await response.json(),s=>this.runtime.redact(s))
      if (!this.runtime.isCurrent(gen)) return this.stale()
      if (seq>state.committed) {state.cards=cards;state.committed=seq}
      return {status:200,body:{status:'ok',cards:state.cards}}
    } catch(error) {
      if (!this.runtime.isCurrent(gen)) return this.stale()
      const status=(error as {status?:number}).status ?? 502
      return {status,body:{status:status===403?'forbidden':'error',cards:state.cards,error:httpError??this.runtime.redact(error instanceof Error?error.message:String(error))}}
    }
  }
  async get():Promise<Response> {
    const op=await this.runtime.beginOperation()
    try {
      const state=this.state(op.gen)
      if (state.gate) return this.response(await state.gate.promise)
      if (!state.read) {
        const promise=this.send(op,state)
        state.read=promise
        void promise.finally(()=>{if(state.read===promise) delete state.read})
      }
      return this.response(await state.read)
    } finally {op.release()}
  }
  async refresh(body:unknown):Promise<Response> {
    const op=await this.runtime.beginOperation()
    try {
      const state=this.state(op.gen)
      let target:Target
      try {target=this.validate(body,state)} catch(error) {return Response.json({error:this.runtime.redact((error as Error).message)},{status:400})}
      while (this.runtime.isCurrent(op.gen)) {
        const gate=state.gate
        if (gate) {
          const covers='all' in gate.target || (!('all' in target) && gate.target.provider===target.provider && gate.target.user===target.user)
          const result=await gate.promise
          if (covers) return this.response(result)
          continue
        }
        const gateNew={target,promise:Promise.resolve(this.stale())}
        state.gate=gateNew
        gateNew.promise=this.send(op,state,target).finally(()=>{if(state.gate===gateNew) delete state.gate})
        return this.response(await gateNew.promise)
      }
      return this.response(this.stale())
    } finally {op.release()}
  }
}
