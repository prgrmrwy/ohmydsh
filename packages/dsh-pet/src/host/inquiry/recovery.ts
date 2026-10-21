import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import { inquiryMemberKey, parseInquiry, type InquiryScope } from './ledger.js'
import { parseInquiryHandoff, type InquiryHandoff } from './handoff-store.js'
import { parseInquiryOutboxRecord, type InquiryOutboxRecord } from './outbox.js'
import { parseInquiryAnswer } from './answer.js'
import { parseInquiryWork, type InquiryWork } from './work-store.js'

export type SessionEvidence = { readonly kind: 'pending' | 'claimed' | 'absent' | 'unknown'; readonly turn?: number; readonly active?: boolean }
export type WorkEvidence = 'valid' | 'terminal' | 'unknown'
type RecoveryDomain = Domain<typeof petDomainSpec>
export type RecoveryAction = Readonly<{kind:string;inquiryId:string;phase:'target'|'result'|'legacy';messageId?:string;scope?:InquiryScope;workId?:string;reason:string}>
export interface InquiryRecoveryInput { readonly domain:RecoveryDomain; readonly currentScope:InquiryScope; readonly sessionEvidence:(sessionId:string,messageId:string)=>Promise<SessionEvidence>; readonly workEvidence:(work:InquiryHandoff['work'],inquiry:ReturnType<typeof parseInquiry>)=>WorkEvidence; readonly ready:boolean }
const maxRows=10_000, same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b), scopeSame=(a:InquiryScope,b:InquiryScope)=>inquiryMemberKey(a)===inquiryMemberKey(b)
function rows<T>(table:{entries():Iterable<[string,unknown]>},parse:(v:unknown)=>T,key:(v:T)=>string):T[]{const out:T[]=[];for(const[k,v]of table.entries()){if(out.length>=maxRows)throw new Error('row-limit');const r=parse(v);if(key(r)!==k)throw new Error('key-mismatch');out.push(r)}return out}
/** Read-only bounded restart classification. It never mutates durable state or emits messages. */
export async function planInquiryRecovery(input:InquiryRecoveryInput):Promise<readonly RecoveryAction[]>{
 const {domain,currentScope}=input,actions:RecoveryAction[]=[]
 let inquiries:ReturnType<typeof parseInquiry>[],handoffs:InquiryHandoff[],results:InquiryOutboxRecord[],works:InquiryWork[]
 try { inquiries=rows(domain.table('inquiries'),parseInquiry,r=>r.id); handoffs=rows(domain.table('inquiry_handoffs'),parseInquiryHandoff,r=>JSON.stringify([r.inquiryId,r.phase])); results=rows(domain.table('inquiry_results'),parseInquiryOutboxRecord,r=>r.dedupKey); rows(domain.table('inquiry_answers'),parseInquiryAnswer,r=>r.inquiryId); works=rows(domain.table('inquiry_works'),parseInquiryWork,r=>JSON.stringify([r.sessionId,r.workId])) }
 catch {return Object.freeze([{kind:'read-failed',inquiryId:'',phase:'legacy',reason:'durable-state-unverifiable'}])}
 const workMap=new Map(works.map(w=>[JSON.stringify([w.sessionId,w.workId]),w]))
 for(const i of inquiries){
  if(i.status==='queued'){
   const h=handoffs.find(x=>x.inquiryId===i.id&&x.phase==='target');if(!h){actions.push({kind:'legacy-disposition-required',inquiryId:i.id,phase:'legacy',reason:'target-intent-missing'});continue}
   const w=h.work.kind==='local'?workMap.get(JSON.stringify([h.work.sessionId,h.work.workId])):undefined
   if(h.state!=='intent'||!scopeSame(i.target,h.scope)||!scopeSame(currentScope,i.target)||(h.work.kind==='local'&&(!w||w.state==='settled'||w.scopeGeneration!==(i.requester.kind==='child'?i.requester.generation:0)))){actions.push({kind:'needs-review',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,reason:'target-proof-inconsistent'});continue}
   const we=input.workEvidence(h.work,i);if(we!=='valid'){actions.push({kind:we==='terminal'?'retain-disposition':'needs-review',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,...(h.work.kind==='local'?{workId:h.work.workId}:{}),reason:'work-not-confirmed-valid'});continue}
   const ev=await input.sessionEvidence(h.scope.sessionId,h.messageId)
   if(ev.kind==='pending')actions.push({kind:'await-same-message',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,reason:'session-pending'})
   else if(ev.kind==='absent')actions.push({kind:input.ready?'enqueue-existing-message':'unavailable',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,...(h.work.kind==='local'?{workId:h.work.workId}:{}),reason:input.ready?'confirmed-absent':'host-not-ready'})
   else actions.push({kind:'needs-review',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,reason:'session-outcome-uncertain'})
  } else if(i.status==='executing'){
   const h=handoffs.find(x=>x.inquiryId===i.id&&x.phase==='target');if(!h||h.state!=='claimed'||!scopeSame(i.target,h.scope)||h.claimTurn===null||!i.appliedEventIds.includes(`handoff:${h.messageId}`)){actions.push({kind:'needs-review',inquiryId:i.id,phase:'target',reason:'claim-proof-inconsistent'});continue}
   const ev=await input.sessionEvidence(h.scope.sessionId,h.messageId)
   if(ev.kind==='claimed'&&ev.turn===h.claimTurn&&ev.active===true)actions.push({kind:'already-claimed',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,reason:'matching-durable-claim'})
   else actions.push({kind:'needs-review',inquiryId:i.id,phase:'target',messageId:h.messageId,scope:h.scope,reason:'claimed-outcome-uncertain'})
  }
 }
 for(const r of results){
  const i=inquiries.find(x=>x.id===r.inquiryId),h=handoffs.find(x=>x.inquiryId===r.inquiryId&&x.phase==='result')
  if(r.status==='delivered'){
   if(i&&h&&h.state==='claimed'&&h.claimTurn!==null&&r.deliveredSegmentId===JSON.stringify([{sessionId:h.scope.sessionId,turn:h.claimTurn}])&&i.status==='result-delivered')actions.push({kind:'done',inquiryId:r.inquiryId,phase:'result',messageId:h.messageId,scope:h.scope,reason:'exact-delivery-proof'})
   else actions.push({kind:'needs-review',inquiryId:r.inquiryId,phase:'result',reason:'delivered-proof-inconsistent'});continue
  }
  if(r.status!=='pending')continue
  if(!i||!h||!scopeSame(r.requester,i.requester)||!same(r.resumeWork,i.origin)||!scopeSame(currentScope,r.requester)||h.state!=='intent'||!scopeSame(h.scope,r.requester)){actions.push({kind:'needs-review',inquiryId:r.inquiryId,phase:'result',reason:'result-proof-inconsistent'});continue}
  const original=handoffs.find(x=>x.inquiryId===i.id&&x.phase==='target');if(!original||!same(h.work,original.work)||h.parentInquiryId!==original.parentInquiryId){actions.push({kind:'needs-review',inquiryId:i.id,phase:'result',messageId:h.messageId,scope:h.scope,reason:'result-work-not-valid'});continue}if(h.work.kind==='local'){const w=workMap.get(JSON.stringify([h.work.sessionId,h.work.workId]));if(!w||w.state==='settled'){actions.push({kind:'needs-review',inquiryId:i.id,phase:'result',messageId:h.messageId,scope:h.scope,reason:'result-work-not-valid'});continue}}const we=input.workEvidence(h.work,i);if(we!=='valid'){actions.push({kind:we==='terminal'?'retain-disposition':'needs-review',inquiryId:i.id,phase:'result',messageId:h.messageId,scope:h.scope,reason:'result-work-not-valid'});continue}
  const ev=await input.sessionEvidence(h.scope.sessionId,h.messageId)
  if(ev.kind==='pending')actions.push({kind:'await-same-message',inquiryId:i.id,phase:'result',messageId:h.messageId,scope:h.scope,reason:'session-pending'})
  else if(ev.kind==='absent')actions.push({kind:input.ready?'enqueue-existing-message':'unavailable',inquiryId:i.id,phase:'result',messageId:h.messageId,scope:h.scope,...(h.work.kind==='local'?{workId:h.work.workId}:{}),reason:input.ready?'confirmed-absent':'host-not-ready'})
  else actions.push({kind:'needs-review',inquiryId:i.id,phase:'result',messageId:h.messageId,scope:h.scope,reason:ev.kind==='claimed'?'claimed-result-delivery-unproven':'session-outcome-uncertain'})
 }
 return Object.freeze(actions.map(x=>Object.freeze(x)))
}
