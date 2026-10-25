import { expect,it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeedbackBook } from '../src/feedback.js'
import { labelEndpoint } from '../src/endpoints.js'
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
 expect(records.at(-1)).toMatchObject({type:'feedback',version:2,feedback:null,decisionId:2,at:expect.any(Number)})
 expect(records.at(-1)).not.toHaveProperty('snapshot')
 expect(new FeedbackBook(file).lookup('s','new')).toMatchObject({snapshot,feedback:null,boundAt:expect.any(Number),feedbackAt:expect.any(Number)})
})
it('persists message-bound feedback with modification cancellation and validation',async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'feedback-')),'feedback.jsonl');const book=new FeedbackBook(file)
 book.bind({sessionId:'s',messageId:'m',decisionId:1,depth:'baseline',model:'sol',effort:'medium'})
 const legacy={lookup:()=>undefined,label:()=>{throw Error('legacy must not write')}}
 const resolve=async()=>({id:'s'})
 const call=(feedback:unknown,messageId='m')=>labelEndpoint({sessionId:'s',messageId,feedback},resolve,legacy,book)
 expect((await call('too-high')).status).toBe(200)
 expect(new FeedbackBook(file).lookup('s','m')?.feedback).toBe('too-high')
 await call('appropriate');expect(book.lookup('s','m')?.feedback).toBe('appropriate')
 await call(null);expect(new FeedbackBook(file).lookup('s','m')?.feedback).toBeNull()
 expect((await call('invalid')).status).toBe(400);expect((await call('appropriate','other')).status).toBe(404)
 expect(book.lookup('other','m')).toBeUndefined()
})
