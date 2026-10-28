import { expect,it,vi } from 'vitest'
import { CardsController } from '../src/host/cards.js'
import { MagpieRuntime } from '../src/host/runtime.js'
const card=(readAt='T0',provider='codex',user:string|undefined='u@example.com')=>({provider,...(user===undefined?{}:{user}),readAt})
const reply=(cards:unknown[])=>Response.json({data:cards,debug:{authorization:'secret'}})
const deferred=()=>{let resolve!:(r:Response)=>void;const promise=new Promise<Response>(r=>resolve=r);return {promise,resolve}}
async function setup(initial:unknown[]=[card()]) {
 const gen={id:1,baseUrl:'http://mock/v1',catalog:[],bgAbort:new AbortController()}
 const request=vi.fn(async(_connection:unknown,_method:string,_path:string,_init?:unknown)=>reply(initial)); const release=vi.fn()
 const runtime={formatErrorBody:MagpieRuntime.prototype.formatErrorBody,current:gen,beginOperation:async()=>({gen:runtime.current,baseUrl:runtime.current.baseUrl,key:'secret',release}),isCurrent:(g:unknown)=>g===runtime.current,redact:(s:string)=>s.replaceAll('secret','[redacted]').replaceAll('active-key','[redacted]'),transport:{request}}
 const c=new CardsController(runtime as unknown as MagpieRuntime);await c.get();request.mockClear()
 return {c,request,runtime,gen}
}
const body=async(r:Response)=>await r.json() as {cards:ReturnType<typeof card>[];error?:string;status:string}
const flush=async()=>{for(let i=0;i<12;i++) await Promise.resolve()}
it('spec Scenario "刷新单张卡片"',async()=>{const {c,request}=await setup();request.mockResolvedValue(reply([card('T2')]));expect((await body(await c.refresh({provider:'codex',user:'u@example.com'}))).cards[0]?.readAt).toBe('T2');expect(request.mock.calls[0]?.[2]).toBe('/magpie/quotas/refresh?provider=codex&user=u%40example.com')})
it('spec Scenario "冷启动时刷新全部"',async()=>{const {c,request}=await setup([]);request.mockResolvedValue(reply([card(),card('T0','claude')]));expect((await body(await c.refresh({all:true}))).cards).toHaveLength(2);expect(request.mock.calls[0]?.[2]).toBe('/magpie/quotas/refresh')})
it('spec Scenario "节流期内返回旧读数"',async()=>{const {c}=await setup();expect((await body(await c.refresh({all:true}))).cards[0]?.readAt).toBe('T0')})
it('spec Scenario "非法刷新目标被拒绝"',async()=>{const {c,request}=await setup();for(const value of [{provider:''},{provider:'codex'},{provider:'codex',user:'other'},{provider:'codex',user:'u@example.com',all:true},{all:true,extra:1},{all:false}])expect((await c.refresh(value)).status).toBe(400);expect(request).not.toHaveBeenCalled()})
it('spec Scenario "并发刷新复用进行中的那一次"',async()=>{const {c,request}=await setup();const d=deferred();request.mockReturnValue(d.promise);const a=c.refresh({all:true});await flush();const b=c.refresh({provider:'codex',user:'u@example.com'});await flush();expect(request).toHaveBeenCalledTimes(1);d.resolve(reply([card('T2')]));expect((await body(await a)).cards).toEqual((await body(await b)).cards)})
it('spec Scenario "旧响应晚到不覆盖新结果"',async()=>{const {c,request}=await setup();const d=deferred();request.mockReturnValueOnce(d.promise).mockResolvedValueOnce(reply([card('T2')]));const old=c.get();await flush();await c.refresh({all:true});d.resolve(reply([card('T1')]));expect((await body(await old)).cards[0]?.readAt).toBe('T2')})
it('spec Scenario "刷新进行中打开的页面得到刷新结果"',async()=>{const {c,request}=await setup();const d=deferred();request.mockReturnValue(d.promise);const f=c.refresh({all:true});await flush();const g=c.get();await flush();d.resolve(reply([card('T2')]));await f;expect((await body(await g)).cards[0]?.readAt).toBe('T2');expect(request).toHaveBeenCalledTimes(1)})
it('spec Scenario "单卡刷新进行中时点刷新全部"',async()=>{const {c,request}=await setup();const d=deferred();request.mockReturnValueOnce(d.promise).mockResolvedValueOnce(reply([card('ALL')]));const a=c.refresh({provider:'codex',user:'u@example.com'});await flush();const b=c.refresh({all:true});await flush();expect(request).toHaveBeenCalledTimes(1);d.resolve(reply([card('A')]));await a;expect((await body(await b)).cards[0]?.readAt).toBe('ALL');expect(request).toHaveBeenCalledTimes(2)})
it('spec Scenario "等待中的刷新不被跟随者压过"',async()=>{const {c,request}=await setup([card(),card('T0','claude')]);const a=deferred(),b=deferred();request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);const fa=c.refresh({provider:'codex',user:'u@example.com'});await flush();const fb=c.refresh({provider:'claude',user:'u@example.com'});const g=c.get();a.resolve(reply([card('TA'),card('T0','claude')]));await fa;expect((await body(await g)).cards[0]?.readAt).toBe('TA');await flush();expect(request).toHaveBeenCalledTimes(2);b.resolve(reply([card('TA'),card('TB','claude')]));expect((await body(await fb)).cards[1]?.readAt).toBe('TB')})
it('spec Scenario "刷新失败后闸门释放"',async()=>{const {c,request}=await setup();request.mockResolvedValueOnce(new Response('bad',{status:502})).mockResolvedValueOnce(reply([card('T2')]));expect((await c.refresh({all:true})).status).toBe(502);expect((await body(await c.refresh({all:true}))).cards[0]?.readAt).toBe('T2')})
it('spec Scenario "受限 key 冷启动刷新全部仍为空"',async()=>{const {c,request}=await setup([]);expect((await body(await c.refresh({all:true}))).cards).toEqual([]);expect(request).toHaveBeenCalledTimes(1)})
it('spec Scenario "刷新失败保留原卡片"',async()=>{const {c,request}=await setup();request.mockResolvedValue(new Response('secret failure',{status:502}));const r=await body(await c.refresh({all:true}));expect(r.cards[0]?.readAt).toBe('T0');expect(r.error).toContain('502');expect(JSON.stringify(r)).not.toContain('secret')})
it('same-card refresh and cache reads each reuse one outbound operation',async()=>{
 const {c,request}=await setup();const a=deferred();request.mockReturnValueOnce(a.promise)
 const x=c.refresh({provider:'codex',user:'u@example.com'});await flush();const y=c.refresh({provider:'codex',user:'u@example.com'});await flush();expect(request).toHaveBeenCalledTimes(1);a.resolve(reply([card('T2')]));expect(await body(await x)).toEqual(await body(await y))
 request.mockClear();const b=deferred();request.mockReturnValueOnce(b.promise);const r1=c.get(),r2=c.get();await flush();expect(request).toHaveBeenCalledTimes(1);b.resolve(reply([card('T3')]));expect(await body(await r1)).toEqual(await body(await r2))
})
it('an uncovered waiter proceeds after failure and rechecks a newly held gate',async()=>{
 const {c,request}=await setup();const a=deferred(),b=deferred();request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
 const first=c.refresh({provider:'codex',user:'u@example.com'});await flush();const all1=c.refresh({all:true}),all2=c.refresh({all:true});await flush();a.resolve(new Response('failure',{status:502}));expect((await first).status).toBe(502);await flush();expect(request).toHaveBeenCalledTimes(2);b.resolve(reply([card('ALL')]));expect(await body(await all1)).toEqual(await body(await all2));expect(request).toHaveBeenCalledTimes(2)
})
it('a card without user uses provider-only target and GET never calls refresh',async()=>{
 const {c,request}=await setup([{provider:'claude',readAt:'T0'}]);await c.get();expect(request.mock.calls[0]?.[1]).toBe('GET');expect(request.mock.calls[0]?.[2]).toBe('/magpie/quotas/cards');request.mockClear();await c.refresh({provider:'claude'});expect(request.mock.calls[0]?.[2]).toBe('/magpie/quotas/refresh?provider=claude')
})
it('failed requests do not advance the committed watermark or replace cards',async()=>{
 const {c,request,gen}=await setup();const state=()=>gen as typeof gen & {magpieCards:{seq:number;committed:number;cards:unknown[]}}
 const before=state().magpieCards.committed;request.mockRejectedValue(new Error('secret network failure'));expect((await c.refresh({all:true})).status).toBe(502);expect(state().magpieCards.committed).toBe(before);expect(state().magpieCards.cards).toEqual([card()])
})
it('projects fixed fields and redacts all strings before caching',async()=>{const {c,request}=await setup();request.mockResolvedValue(reply([{provider:'codex',user:'secret',error:'active-key',windows:[{name:'secret',used:0,display:'active-key',debug:'secret'}],resets:{count:2,debug:'secret'},debug:'secret'}]));const r=await body(await c.get());expect(JSON.stringify(r)).not.toContain('secret');expect(JSON.stringify(r)).not.toContain('active-key');expect(JSON.stringify(r)).not.toContain('debug');expect(r.cards[0]).toHaveProperty('error','[redacted]')})
it('invalid request does not release another gate; waiting refresh is discarded on rotation',async()=>{const {c,request,runtime,gen}=await setup();const d=deferred();request.mockReturnValue(d.promise);const a=c.refresh({provider:'codex',user:'u@example.com'});await flush();expect((await c.refresh({provider:'codex'})).status).toBe(400);const b=c.refresh({all:true});await flush();expect(request).toHaveBeenCalledTimes(1);runtime.current={...gen,id:2};d.resolve(reply([card('OLD')]));expect((await a).status).toBe(409);expect((await b).status).toBe(409);expect(request).toHaveBeenCalledTimes(1)})
