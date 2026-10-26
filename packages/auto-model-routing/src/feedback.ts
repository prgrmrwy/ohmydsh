import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
export const allocationFeedback = ['appropriate', 'too-high', 'too-low', 'unknown'] as const
const probability = z.number().min(0).max(1)
const snapshot = z.object({
  decidedAt: z.number(), appliedAt: z.number(), policyVersion: z.string(), mappingVersion: z.string(),
  decisionProvider: z.string(), decisionModel: z.string(), ms: z.number(),
  confidence: probability.optional(), probabilities: z.record(z.string(), probability).optional(),
  provider: z.string(), requestSeq: z.number(), requestTurn: z.number().optional(),
}).strict()
const schema = z.object({ sessionId:z.string(), messageId:z.string(), decisionId:z.number(), depth:z.string(), model:z.string(), effort:z.string(), snapshot:snapshot.optional(), boundAt:z.number().optional(), feedback:z.enum(allocationFeedback).nullable().optional(), feedbackAt:z.number().optional() }).strict()
const feedbackEvent = z.object({ type:z.literal('feedback'), version:z.literal(2), sessionId:z.string(), messageId:z.string(), decisionId:z.number(), at:z.number(), feedback:z.enum(allocationFeedback).nullable() }).strict()
const factEvent = z.object({ type:z.literal('fact'), version:z.literal(1), sessionId:z.string().min(1), decisionId:z.number(), fact:z.enum(['exposed','manual-switch']), at:z.number().finite() }).strict()
export type FeedbackFact = z.infer<typeof factEvent>['fact']
export type FeedbackRecord = z.infer<typeof schema>
/** Immutable decision bindings and separate feedback events; never includes task text or credentials. */
export class FeedbackBook {
  private records = new Map<string, FeedbackRecord>()
  private factRecords = new Map<string, Partial<Record<FeedbackFact, number>>>()
  constructor(private file:string) {
    let text:string
    try { text=readFileSync(file,'utf8') } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error }
    for(const line of text.split('\n'))try{
      const raw:unknown=JSON.parse(line)
      const fact=factEvent.safeParse(raw)
      if(fact.success){const e=fact.data;const key=JSON.stringify([e.sessionId,e.decisionId]);const facts=this.factRecords.get(key)??{};facts[e.fact]??=e.at;this.factRecords.set(key,facts);continue}
      const event=feedbackEvent.safeParse(raw)
      if(event.success){const e=event.data;const key=this.key(e.sessionId,e.messageId);const r=this.records.get(key);if(r?.decisionId===e.decisionId)this.records.set(key,{...r,feedback:e.feedback,feedbackAt:e.at});continue}
      const r=schema.parse(raw);const key=this.key(r.sessionId,r.messageId);const existing=this.records.get(key)
      // Old full-record feedback lines remain readable, but cannot replace the original decision.
      if(!existing)this.records.set(key,r)
      else if(existing.decisionId===r.decisionId&&Object.hasOwn(r,'feedback'))this.records.set(key,{...existing,feedback:r.feedback})
    }catch{/* incomplete/corrupt lines cannot create a binding */}
  }
  private key(sessionId:string,messageId:string){return JSON.stringify([sessionId,messageId])}
  lookup(sessionId:string,messageId:string){const r=this.records.get(this.key(sessionId,messageId));return r&&structuredClone(r)}
  /** All folded bindings in file order (read-only; used by the usage report). */
  entries(){return [...this.records.values()].map(r=>structuredClone(r))}
  bind(record:FeedbackRecord){if(this.lookup(record.sessionId,record.messageId))return;const r=schema.parse({...record,boundAt:Date.now()});this.append(r);this.records.set(this.key(r.sessionId,r.messageId),r)}
  set(sessionId:string,messageId:string,feedback:typeof allocationFeedback[number]|null){
    const r=this.lookup(sessionId,messageId);if(!r)throw Error('No applied decision')
    const event=feedbackEvent.parse({type:'feedback',version:2,sessionId,messageId,decisionId:r.decisionId,at:Date.now(),feedback})
    this.append(event);this.records.set(this.key(sessionId,messageId),{...r,feedback,feedbackAt:event.at})
  }
  facts(sessionId:string,decisionId:number){return {...this.factRecords.get(JSON.stringify([sessionId,decisionId]))}}
  fact(sessionId:string,decisionId:number,fact:FeedbackFact){
    const key=JSON.stringify([sessionId,decisionId]);const facts=this.factRecords.get(key)??{}
    if(facts[fact]!==undefined)return
    const event=factEvent.parse({type:'fact',version:1,sessionId,decisionId,fact,at:Date.now()})
    this.append(event);this.factRecords.set(key,{...facts,[fact]:event.at})
  }
  private append(record:unknown){mkdirSync(dirname(this.file),{recursive:true});appendFileSync(this.file,JSON.stringify(record)+'\n',{mode:0o600})}
}
