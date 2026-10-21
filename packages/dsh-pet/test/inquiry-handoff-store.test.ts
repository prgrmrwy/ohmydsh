import { describe,it,expect } from 'vitest'
import { openPetHarness } from './harness.js'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { InquiryHandoffStore } from '../src/host/inquiry/handoff-store.js'
import { InquiryWorkStore } from '../src/host/inquiry/work-store.js'
import { InquiryAnswerStore } from '../src/host/inquiry/answer-store.js'
import { InquiryAcceptanceStore } from '../src/host/inquiry/acceptance-store.js'
const at=1_800_000_000_000, requester={kind:'main',sessionId:'session-a'} as const,target={kind:'child',sessionId:'session-b',locusId:'locus-b',generation:2} as const
async function seeded(h:Awaited<ReturnType<typeof openPetHarness>>, id='inq') {const l=new InquiryLedgerStore(h.domain);await l.accept({target,question:'Q?',purpose:'P',declaredOrigin:null},{inquiryId:id,requester,circleParentSessionId:'session-a',origin:{kind:'local'},audience:{kind:'local-session',sessionId:'session-a'},createdAt:at});return l}
async function root(h:Awaited<ReturnType<typeof openPetHarness>>,id='root'){return new InquiryWorkStore(h.domain).claimLocalWork(requester,id,1,at)}
const targetIntent=(messageId='msg-1',over:Record<string,unknown>={})=>({inquiryId:'inq',phase:'target',scope:target,messageId,work:{kind:'local',sessionId:'session-a',workId:'root'},parentInquiryId:null,createdAt:at,...over})
describe('inquiry handoff protocol store',()=>{
 it('requires actual root work before reserving and rejects foreign work',async()=>{const h=await openPetHarness();try{await seeded(h);const s=new InquiryHandoffStore(h.domain);await expect(s.reserve(targetIntent())).rejects.toThrow();await root(h,'foreign');await expect(s.reserve(targetIntent('m',{work:{kind:'local',sessionId:'session-a',workId:'absent'}}))).rejects.toThrow();await root(h);expect(await s.reserve(targetIntent())).toMatchObject({state:'intent'})}finally{await h.close()}})
 it('claims with exact current scope and rejects a rebuilt same-session generation',async()=>{const h=await openPetHarness();try{await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);await s.reserve(targetIntent());await expect(s.claim({...target,generation:3},'msg-1',1,at+2)).rejects.toThrow();const claimed=await s.claim(target,'msg-1',1,at+2);expect(claimed).toMatchObject({state:'claimed',claimTurn:1,claimAt:at+2});expect(h.domain.table('inquiries').get('inq')).toMatchObject({status:'executing'})}finally{await h.close()}})
 it('does not execute getters and strictly parses enums',async()=>{const h=await openPetHarness();try{let n=0;const x={kind:'main',sessionId:'session-a'};Object.defineProperty(x,'sessionId',{get(){n++;return 'session-a'},enumerable:true});await expect(seeded(h)).resolves.toBeDefined();const s=new InquiryHandoffStore(h.domain);await expect(s.reserve(targetIntent('m',{scope:x}))).rejects.toThrow();expect(n).toBe(0)}finally{await h.close()}})
 it('atomically delivers an actual answer to exact turn segment and exact duplicate only',async()=>{const h=await openPetHarness();try{const l=await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);await s.reserve(targetIntent());await new InquiryWorkStore(h.domain).registerBranch(requester,'root','inq',requester);await s.claim(target,'msg-1',1,at+1);const answer=new InquiryAnswerStore(h.domain);await answer.commit({inquiryId:'inq',answeredBy:target,answer:'A',confidence:'confirmed',recency:'current',sources:['proof'],answeredAt:at+2} as never,'answer');const result={inquiryId:'inq',phase:'result',scope:requester,messageId:'result-1',work:{kind:'local',sessionId:'session-a',workId:'root'},parentInquiryId:null,createdAt:at+2};await s.reserve(result);const claimed=await s.claim(requester,'result-1',2,at+3);expect(claimed).toMatchObject({state:'claimed',claimTurn:2,claimAt:at+3});expect(h.domain.table('inquiry_results').get(JSON.stringify(['result','inq','answer'])).status).toBe('delivered');expect(h.domain.table('inquiry_results').get(JSON.stringify(['result','inq','answer'])).deliveredSegmentId).toBe(JSON.stringify([{sessionId:'session-a',turn:2}]));expect(h.domain.table('inquiries').get('inq')).toMatchObject({status:'result-delivered'});expect(await s.claim(requester,'result-1',2,at+3)).toEqual(claimed);await expect(s.claim(requester,'result-1',2,at+4)).rejects.toThrow();await expect(s.claim(requester,'result-1',3,at+3)).rejects.toThrow();void l}finally{await h.close()}})
 it('rejects missing or wrong result proof and terminal inquiry state without writes',async()=>{const h=await openPetHarness();try{const l=await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);const row=targetIntent();await s.reserve(row);await s.claim(target,'msg-1',1,at+1);await l.applyEvent('inq',{type:'unavailable',eventId:'fail',at:at+2,reason:'gone'});const before=JSON.stringify(h.medium);await expect(s.claim(target,'msg-1',1,at+3)).rejects.toThrow();expect(JSON.stringify(h.medium)).toBe(before)}finally{await h.close()}})
 it.each([1,2,3,4])('rolls back injected batch failure at write %i',async(n)=>{const h=await openPetHarness();try{const l=await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);await s.reserve(targetIntent());await new InquiryWorkStore(h.domain).registerBranch(requester,'root','inq',requester);await s.claim(target,'msg-1',1,at+1);await new InquiryWorkStore(h.domain).endTurn(requester,'root',1);expect(new InquiryWorkStore(h.domain).get('session-a','root')?.state).toBe('waiting');await new InquiryAnswerStore(h.domain).commit({inquiryId:'inq',answeredBy:target,answer:'A',confidence:'confirmed',recency:'current',sources:['proof'],answeredAt:at+2} as never,'answer');const intent={inquiryId:'inq',phase:'result',scope:requester,messageId:'result-fault',work:{kind:'local',sessionId:'session-a',workId:'root'},parentInquiryId:null,createdAt:at+2};await s.reserve(intent);const before=JSON.stringify(h.medium);h.failNextAtomicBatch(n);await expect(s.claim(requester,'result-fault',2,at+3)).rejects.toThrow();expect(JSON.stringify(h.medium)).toBe(before);expect(await s.claim(requester,'result-fault',2,at+3)).toMatchObject({state:'claimed'});expect((await s.get('inq','result')).state).toBe('claimed');expect(new InquiryWorkStore(h.domain).get('session-a','root')).toMatchObject({state:'active',continuationTurn:2,openInquiryIds:[]});await expect(s.claim(requester,'result-fault',2,at+3)).resolves.toEqual(await s.get('inq','result'));await expect(new InquiryWorkStore(h.domain).endTurn(requester,'root',2)).resolves.toMatchObject({state:'settled'});await expect(s.claim(requester,'result-fault',2,at+3)).resolves.toEqual(await s.get('inq','result'));void l}finally{await h.close()}})
 it('rejects duplicate message collision even when the colliding inquiry is absent',async()=>{const h=await openPetHarness();try{await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);await s.reserve(targetIntent());await expect(s.reserve(targetIntent('msg-1',{inquiryId:'missing'}))).rejects.toThrow()}finally{await h.close()}})
 it('requires exact claim timestamp for retries',async()=>{const h=await openPetHarness();try{await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);await s.reserve(targetIntent());await s.claim(target,'msg-1',1,at+1);await expect(s.claim(target,'msg-1',1,at+2)).rejects.toThrow()}finally{await h.close()}})
  it('does not rebind a local result to another active root in the same session',async()=>{const h=await openPetHarness();try{const l=await seeded(h);await root(h,'root-a');const s=new InquiryHandoffStore(h.domain);await s.reserve(targetIntent('target',{work:{kind:'local',sessionId:'session-a',workId:'root-a'}}));await s.claim(target,'target',1,at+1);const answer=new InquiryAnswerStore(h.domain);await answer.commit({inquiryId:'inq',answeredBy:target,answer:'A',confidence:'confirmed',recency:'current',sources:['proof'],answeredAt:at+2} as never,'answer');await root(h,'root-b');const intent={inquiryId:'inq',phase:'result',scope:requester,messageId:'result',work:{kind:'local',sessionId:'session-a',workId:'root-b'},parentInquiryId:null,createdAt:at+2};await expect(s.reserve(intent)).rejects.toThrow();void l}finally{await h.close()}})
  it('returns immutable existing target identity on same-message reserve retry after claim',async()=>{const h=await openPetHarness();try{await seeded(h);await root(h);const s=new InquiryHandoffStore(h.domain);const intent=targetIntent();const original=await s.reserve(intent);const claimed=await s.claim(target,'msg-1',1,at+1);expect(await s.reserve(intent)).toEqual(claimed);expect(await s.get('inq','target')).toEqual(claimed);expect(original.state).toBe('intent')}finally{await h.close()}})
  it('nested local branch closes against its root work, not parent child turn', async () => {
    const h = await openPetHarness()
    try {
      const acceptance = new InquiryAcceptanceStore(h.domain), ledger = new InquiryLedgerStore(h.domain), handoffs = new InquiryHandoffStore(h.domain), works = new InquiryWorkStore(h.domain), answers = new InquiryAnswerStore(h.domain)
      const a = { kind: 'main', sessionId: 'session-a' } as const, b = target, c = { kind: 'child', sessionId: 'session-c', locusId: 'locus-c', generation: 3 } as const
      const work = { kind: 'local', sessionId: a.sessionId, workId: 'root-a' } as const, audience = { kind: 'local-session', sessionId: a.sessionId } as const
      const facts = (inquiryId: string, requester: typeof a | typeof b, origin: {kind:'local'} | {kind:'inquiry';parentInquiryId:string}, createdAt: number) => ({inquiryId,requester,circleParentSessionId:a.sessionId,origin,audience,createdAt})
      const request = {target:b,question:'Q1',purpose:'handoff',declaredOrigin:null}
      await works.claimLocalWork(a,work.workId,1,at)
      await acceptance.accept({request,facts:facts('root-inq',a,{kind:'local'},at),work,messageId:'target-1'})
      await handoffs.claim(b,'target-1',2,at+1)
      await works.endTurn(a,work.workId,1)
      const nested = await acceptance.accept({request:{...request,target:c,question:'Q2'},facts:facts('nested-inq',b,{kind:'inquiry',parentInquiryId:'root-inq'},at+2),work,messageId:'target-2'})
      expect(nested.trace.rootInquiryId).toBe('root-inq')
      await handoffs.claim(c,'target-2',3,at+3)
      await answers.commit({inquiryId:'nested-inq',answeredBy:c,answer:'proof',confidence:'confirmed',recency:'current',sources:['proof'],answeredAt:at+4} as never,'answer-nested')
      const result = {inquiryId:'nested-inq',phase:'result',scope:b,messageId:'result-2',work,parentInquiryId:'root-inq',createdAt:at+5}
      await handoffs.reserve(result)
      const beforeRetry = JSON.stringify(h.medium)
      await expect(handoffs.reserve({...result,work:{...work,workId:'other-root'}})).rejects.toThrow()
      expect(JSON.stringify(h.medium)).toBe(beforeRetry)
      const delivered = await handoffs.claim(b,'result-2',4,at+6)
      expect(delivered).toMatchObject({state:'claimed',claimTurn:4})
      expect(works.get(a.sessionId,work.workId)).toMatchObject({state:'waiting',continuationTurn:null,openInquiryIds:['root-inq']})
      expect(ledger.get('root-inq')).toMatchObject({status:'executing'})
      expect(ledger.get('nested-inq')).toMatchObject({status:'result-delivered'})
      expect(h.domain.table('inquiry_results').get(JSON.stringify(['result','nested-inq','answer']))).toMatchObject({status:'delivered',deliveredSegmentId:JSON.stringify([{sessionId:b.sessionId,turn:4}])})
      expect(await handoffs.claim(b,'result-2',4,at+6)).toEqual(delivered)
    } finally { await h.close() }
  })
  it('returns a nested delivery answer without manufacturing local root work', async () => {
    const h = await openPetHarness()
    try {
      const acceptance = new InquiryAcceptanceStore(h.domain), ledger = new InquiryLedgerStore(h.domain), handoffs = new InquiryHandoffStore(h.domain), answers = new InquiryAnswerStore(h.domain)
      const a = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const, b = target, c = { kind: 'child', sessionId: 'session-c', locusId: 'locus-c', generation: 3 } as const
      const audience = { kind: 'feishu-chat', chatId: 'chat-1' } as const, work = {kind:'delivery',id:'delivery-1'} as const, origin = {kind:'feishu-delivery',deliveryId:'delivery-1'} as const
      const rootFacts = {inquiryId:'delivery-root',requester:a,circleParentSessionId:'session-parent',origin,audience,createdAt:at}, rootRequest = {target:b,question:'Q1',purpose:'delivery handoff',declaredOrigin:origin}
      const first = await acceptance.accept({request:rootRequest,facts:rootFacts,work,messageId:'delivery-target-1'})
      expect(first.status).toBe('queued')
      await handoffs.claim(b,'delivery-target-1',2,at+1)
      const nested = await acceptance.accept({request:{...rootRequest,target:c,question:'Q2',declaredOrigin:null},facts:{...rootFacts,inquiryId:'delivery-nested',requester:b,origin:{kind:'inquiry',parentInquiryId:'delivery-root'},createdAt:at+2},work,messageId:'delivery-target-2'})
      expect(nested.trace.rootInquiryId).toBe('delivery-root')
      await handoffs.claim(c,'delivery-target-2',3,at+3)
      await answers.commit({inquiryId:'delivery-nested',answeredBy:c,answer:'delivery proof',confidence:'confirmed',recency:'current',sources:['proof'],answeredAt:at+4} as never,'delivery-answer')
      await handoffs.reserve({inquiryId:'delivery-nested',phase:'result',scope:b,messageId:'delivery-result-2',work,parentInquiryId:'delivery-root',createdAt:at+5})
      const result = await handoffs.claim(b,'delivery-result-2',4,at+6)
      expect(result).toMatchObject({state:'claimed',claimTurn:4})
      expect(h.domain.table('inquiry_works').size).toBe(0)
      expect(h.domain.table('inquiry_results').get(JSON.stringify(['result','delivery-nested','answer']))).toMatchObject({status:'delivered',deliveredSegmentId:JSON.stringify([{sessionId:b.sessionId,turn:4}])})
      expect(ledger.get('delivery-root')).toMatchObject({status:'executing'})
      expect(ledger.get('delivery-nested')).toMatchObject({status:'result-delivered'})
    } finally { await h.close() }
  })
})
