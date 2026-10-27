import { expect,it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeedbackBook } from '../src/feedback.js'
import { labelEndpoint, observeEndpoint } from '../src/endpoints.js'
it('observes only a bound root reply and ignores duplicate observations',async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'observe-')),'data.jsonl');const book=new FeedbackBook(file)
 book.bind({sessionId:'s',messageId:'m',decisionId:1,depth:'baseline',model:'sol',effort:'medium'})
 const resolve=async()=>({id:'s'})
 expect((await observeEndpoint({},resolve,book,()=>{})).status).toBe(400)
 expect(await (await observeEndpoint({sessionId:'s',messageId:'missing'},resolve,book,()=>{})).json()).toEqual({})
 for(let i=0;i<2;i++)expect((await observeEndpoint({sessionId:'s',messageId:'m'},resolve,book,()=>{})).status).toBe(200)
 expect(book.facts('s',1)).toEqual({exposed:expect.any(Number)})
 expect((await observeEndpoint({sessionId:'s',messageId:'m'},async()=>({id:'s',origin:'subagent'}),book,()=>{})).status).toBe(404)
 book.fact=()=>{throw Error('disk failure')};let warned=false
 expect((await observeEndpoint({sessionId:'s',messageId:'m'},resolve,book,()=>{warned=true})).status).toBe(200)
 expect(warned).toBe(true)
})
it('keeps immutable snapshot and separate timestamped feedback events with old records readable',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'feedback-eval-')),'data.jsonl')
 const old={sessionId:'s',messageId:'old',decisionId:1,depth:'lower',model:'sol',effort:'low'}
 writeFileSync(file,JSON.stringify(old)+'\n'+JSON.stringify({...old,feedback:'appropriate'})+'\n')
 const book=new FeedbackBook(file)
 expect(book.lookup('s','old')).toMatchObject({feedback:'appropriate'});expect(book.lookup('s','old')?.snapshot).toBeUndefined()
 const snapshot={decidedAt:1,appliedAt:2,policyVersion:'p',mappingVersion:'m',decisionProvider:'openrouter',decisionModel:'jev',ms:20,confidence:.55,probabilities:{lower:.7,baseline:.3,higher:0},provider:'codex',requestSeq:8}
 book.bind({...old,messageId:'new',decisionId:2,snapshot})
 book.set('s','new','too-high');book.set('s','new',null)
 const records=readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.parse(line))
 expect(records.at(-1)).toMatchObject({type:'feedback',feedback:null,decisionId:2,at:expect.any(Number)})
 expect(records.at(-1)).not.toHaveProperty('snapshot')
 expect(new FeedbackBook(file).lookup('s','new')).toMatchObject({snapshot,feedback:null,boundAt:expect.any(Number),feedbackAt:expect.any(Number)})
})
it('keeps first decision facts separate from immutable bindings and feedback',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'facts-')),'feedback.jsonl');const book=new FeedbackBook(file)
 book.bind({sessionId:'s',messageId:'m',decisionId:1,depth:'baseline',model:'sol',effort:'medium'})
 book.set('s','m','appropriate');const before=book.lookup('s','m')
 book.fact('s',1,'exposed');book.fact('s',1,'manual-switch');book.fact('s',1,'exposed')
 expect(book.facts('s',1)).toEqual({exposed:expect.any(Number),'manual-switch':expect.any(Number)})
 expect(book.lookup('s','m')).toEqual(before)
 expect(new FeedbackBook(file).facts('s',1)).toEqual(book.facts('s',1))
 expect(readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>r.type==='fact')).toHaveLength(2)
 expect(book.facts('other',1)).toEqual({})
})
it('persists message-bound feedback with modification cancellation and validation',async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'feedback-')),'feedback.jsonl');const book=new FeedbackBook(file)
 book.bind({sessionId:'s',messageId:'m',decisionId:1,depth:'baseline',model:'sol',effort:'medium'})
 const resolve=async()=>({id:'s'})
 const call=(feedback:unknown,messageId='m')=>labelEndpoint({sessionId:'s',messageId,feedback},resolve,book)
 expect((await call('too-high')).status).toBe(200)
 expect(new FeedbackBook(file).lookup('s','m')?.feedback).toBe('too-high')
 await call('appropriate');expect(book.lookup('s','m')?.feedback).toBe('appropriate')
 await call(null);expect(new FeedbackBook(file).lookup('s','m')?.feedback).toBeNull()
 expect((await call('invalid')).status).toBe(400);expect((await call('appropriate','other')).status).toBe(404)
 expect(book.lookup('other','m')).toBeUndefined()
})
it('spec Scenario "新旧记录并存"',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'feedback-mixed-')),'data.jsonl')
 const oldSnapshot={decidedAt:1,appliedAt:2,policyVersion:'policy-v2-d774ffe6',mappingVersion:'capability-slots-2-magpie',decisionProvider:'openrouter',decisionModel:'jev',ms:20,provider:'claude',requestSeq:8}
 writeFileSync(file,JSON.stringify({sessionId:'s',messageId:'old',decisionId:1,depth:'baseline',model:'claude-opus-5-5',effort:'medium',snapshot:oldSnapshot,boundAt:3})+'\n'+JSON.stringify({type:'feedback',version:2,sessionId:'s',messageId:'old',decisionId:1,at:4,feedback:'appropriate'})+'\n')
 const book=new FeedbackBook(file)
 const snapshot={decidedAt:5,appliedAt:6,strategy:'codex',decisionProvider:'openrouter',decisionModel:'jev',ms:20,provider:'codex',requestSeq:9}
 book.bind({sessionId:'s',messageId:'new',decisionId:2,depth:'higher',model:'gpt-6.1-sol',effort:'high',snapshot})
 const reread=new FeedbackBook(file)
 expect(reread.lookup('s','old')).toMatchObject({snapshot:oldSnapshot,feedback:'appropriate'})
 expect(reread.lookup('s','old')!.snapshot).not.toHaveProperty('strategy')
 expect(reread.lookup('s','new')!.snapshot).toEqual(snapshot)
 book.set('s','new','too-high')
 const rows=readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l))
 expect(rows.at(-2).snapshot).not.toHaveProperty('policyVersion');expect(rows.at(-2).snapshot).not.toHaveProperty('mappingVersion')
 expect(rows.at(-1)).toMatchObject({type:'feedback',feedback:'too-high'});expect(rows.at(-1)).not.toHaveProperty('version')
 expect(new FeedbackBook(file).lookup('s','new')).toMatchObject({snapshot,feedback:'too-high'})
})
it('spec Scenario "新旧事件格式混读"',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'feedback-events-')),'data.jsonl')
 const bind=(m:string,d:number)=>JSON.stringify({sessionId:'s',messageId:m,decisionId:d,depth:'baseline',model:'sol',effort:'medium'})
 const lines=[bind('a',1),bind('b',2),bind('c',3),
  JSON.stringify({type:'feedback',version:2,sessionId:'s',messageId:'a',decisionId:1,at:10,feedback:'too-low'}),
  JSON.stringify({type:'fact',version:1,sessionId:'s',decisionId:1,fact:'exposed',at:11}),
  JSON.stringify({type:'feedback',sessionId:'s',messageId:'b',decisionId:2,at:12,feedback:'appropriate'}),
  JSON.stringify({type:'fact',sessionId:'s',decisionId:2,fact:'manual-switch',at:13}),
  JSON.stringify({type:'feedback',sessionId:'s',messageId:'c',decisionId:3,at:14,feedback:'unknown',extra:1})]
 writeFileSync(file,lines.join('\n')+'\n')
 const book=new FeedbackBook(file)
 expect(book.lookup('s','a')).toMatchObject({feedback:'too-low',feedbackAt:10})
 expect(book.lookup('s','b')).toMatchObject({feedback:'appropriate',feedbackAt:12})
 expect(book.lookup('s','c')).not.toHaveProperty('feedback')
 expect(book.facts('s',1)).toEqual({exposed:11})
 expect(book.facts('s',2)).toEqual({'manual-switch':13})
 // A retired version value other than the original one is not accepted.
 writeFileSync(file,[bind('a',1),JSON.stringify({type:'feedback',version:3,sessionId:'s',messageId:'a',decisionId:1,at:10,feedback:'too-low'})].join('\n')+'\n')
 expect(new FeedbackBook(file).lookup('s','a')).not.toHaveProperty('feedback')
})
