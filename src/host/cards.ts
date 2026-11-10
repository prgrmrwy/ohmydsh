import type { Generation, MagpieRuntime, Operation } from './runtime.js'
import type { Card } from '../client/view-model.js'
type Target = {all:true} | {provider:string;user?:string}
/** One reset credit as the host keeps it: the browser never sees the id, the reset flow needs it. */
export interface HostCredit { id:string; until?:string }
interface Result { status:number; body:{status:'ok'|'forbidden'|'error'|'unconfigured';cards:Card[];error?:string} }
interface State { cards:Card[]; credits:Map<string,HostCredit[]>; seq:number; committed:number; read?:Promise<Result>; gate?:{target:Target;promise:Promise<Result>} }
/** Host-side key of one card: the same pair the refresh target names. */
const creditKey = (provider:string,user:string|undefined) => `${provider}\u0000${user ?? ''}`
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
/**
 * Reset credits, projected to their fixed fields; each credit keeps only when it
 * runs out and its window. The `id` is deliberately split out: it stays in the
 * host (see {@link projectCards}'s second return value) so a browser response
 * cannot name a credit.
 */
function projectResets(raw:Record<string,unknown>, redact:(s:string)=>string):{resets:Record<string,unknown>;credits:HostCredit[]} {
  const resets=pick(raw,['count','until','byWindow','fiveHour','weekly'],redact)
  const credits:HostCredit[]=[]
  if(Array.isArray(raw.each)) {
    const each=raw.each.filter(record).map(item=>{
      const id=typeof item.id==='string'?item.id:''
      const until=typeof item.until==='string'?item.until:undefined
      if(id)credits.push({id,...(until===undefined?{}:{until})})
      return pick(item,['until','window'],redact)
    })
    if(each.length)resets.each=each
  }
  return {resets,credits}
}
/**
 * Cards as the browser sees them, plus the credits the reset flow selects from.
 * `redeemable` only says "this card could offer the button": provider codex, a
 * named account, not a by-window plan, and at least one credit with an id.
 */
export function projectCards(body:unknown, redact:(s:string)=>string):{cards:Card[];credits:Map<string,HostCredit[]>} {
  if (!record(body) || !Array.isArray(body.data)) throw new Error('Invalid cards response')
  const credits=new Map<string,HostCredit[]>()
  const cards=body.data.flatMap(raw=>{
    if (!record(raw) || typeof raw.provider!=='string' || !raw.provider) return []
    const card=pick(raw,['provider','name','icon','user','plan','until','renew','balance','readAt','asOf','error'],redact)
    if (Array.isArray(raw.windows)) card.windows=raw.windows.filter(record).map(w=>pick(w,['name','used','resetsAt','unlimited','display'],redact)) as never
    if (record(raw.resets)) {
      const projected=projectResets(raw.resets,redact)
      const user=typeof card.user==='string'?card.user:undefined
      if(projected.credits.length)credits.set(creditKey(raw.provider,user),projected.credits)
      const redeemable=raw.provider==='codex' && !!user && projected.resets.byWindow!==true && projected.credits.length>0
      card.resets=(redeemable?{...projected.resets,redeemable:true}:projected.resets) as never
    }
    return [card as unknown as Card]
  })
  return {cards,credits}
}
export class CardsController {
  constructor(readonly runtime:MagpieRuntime) {}
  private state(gen:Generation):State { return (gen.magpieCards ??= {cards:[],credits:new Map(),seq:0,committed:0}) as State }
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
    if (!op.baseUrl || !key) return {status:200,body:{status:'unconfigured',cards:[]}}
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
      const projected=projectCards(await response.json(),s=>this.runtime.redact(s))
      if (!this.runtime.isCurrent(gen)) return this.stale()
      if (seq>state.committed) {state.cards=projected.cards;state.credits=projected.credits;state.committed=seq}
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
      const result=await this.run(op,body)
      return this.response(result)
    } finally {op.release()}
  }
  /**
   * A forced read of one card for the reset flow: same gate as a user refresh, so
   * it never runs beside one. Only a 2xx result counts — a failed read leaves the
   * previous (older) cards in place, and those must not authorise spending a
   * credit, so every failure is returned as such. A caller-supplied operation stays
   * retained by that caller through its subsequent write and response projection.
   */
  async fresh(target:{provider:string;user:string},operation?:Operation):Promise<{ok:true;card:Card|undefined;credits:HostCredit[]}|{ok:false;status:number;error:string}> {
    const op=operation ?? await this.runtime.beginOperation()
    try {
      let result:Result
      try {result=await this.run(op,target)} catch(error) {
        return {ok:false,status:502,error:this.runtime.redact(error instanceof Error?error.message:String(error))}
      }
      if (!this.runtime.isCurrent(op.gen)) return {ok:false,status:409,error:'MAGPIE_GENERATION_CHANGED'}
      if (result.status!==200 || result.body.status!=='ok') return {ok:false,status:result.status,error:result.body.error ?? `HTTP ${result.status}`}
      const key=creditKey(target.provider,target.user)
      return {ok:true,card:result.body.cards.find(card=>card.provider===target.provider && card.user===target.user),credits:this.state(op.gen).credits.get(key) ?? []}
    } finally {if (!operation) op.release()}
  }
  /** Validate + run one read under the caller's operation; shared by `refresh` and `fresh`. */
  private async run(op:Operation,body:unknown):Promise<Result> {
    const state=this.state(op.gen)
    let target:Target
    try {target=this.validate(body,state)} catch(error) {return {status:400,body:{status:'error',cards:state.cards,error:this.runtime.redact((error as Error).message)}}}
    while (this.runtime.isCurrent(op.gen)) {
      const gate=state.gate
      if (gate) {
        const covers='all' in gate.target || (!('all' in target) && gate.target.provider===target.provider && gate.target.user===target.user)
        const result=await gate.promise
        if (covers) return this.runtime.isCurrent(op.gen) ? result : this.stale()
        continue
      }
      const gateNew={target,promise:Promise.resolve(this.stale())}
      state.gate=gateNew
      gateNew.promise=this.send(op,state,target).finally(()=>{if(state.gate===gateNew) delete state.gate})
      return await gateNew.promise
    }
    return this.stale()
  }
}
