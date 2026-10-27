import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json, deferred } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
async function setup() { const a=await createGateway(), b=await createGateway(); const c=credentialsMock('K1'); const store=new SettingsStore(); store.value.baseUrl=a.baseUrl; const r=new MagpieRuntime(c.service,store); cleanup.push(a.close,b.close,()=>r.dispose()); a.handlers.set('GET /v1/models',json({data:[{id:'A'}]})); b.handlers.set('GET /v1/models',json({data:[{id:'B1'},{id:'B2'}]})); c.onChange(()=>r.invalidateCredential()); return {a,b,c,r} }
test('spec Scenario "换地址后不显示旧目录"',async()=>{const {a,b,r}=await setup(); await r.start(); b.handlers.set('GET /v1/models',json({},503)); await r.settings({baseUrl:b.baseUrl}); expect(r.current.catalog).toHaveLength(0); expect(r.current.lastSyncError).toBeTruthy(); expect(a.requests).toHaveLength(1)})
test('spec Scenario "换 key 后不显示旧卡片"',async()=>{const {r}=await setup(); await r.start(); r.current.cards=[{provider:'codex'}]; await r.settings({key:'K2'}); expect(r.current.cards).toBeUndefined()})
test('spec Scenario "旧代晚到的响应被丢弃"',async()=>{const {a,b,r}=await setup(); const entered=deferred(),gate=deferred(); a.handlers.set('GET /v1/models',async res=>{entered.resolve();await gate.promise;json({data:[{id:'OLD'}]})(res,{} as never)});const old=r.start();await entered.promise;await r.settings({baseUrl:b.baseUrl});gate.resolve();await old;expect(r.current.catalog.map(m=>m.info.id)).toEqual(['B1','B2'])})
test('spec Scenario "外部改 key 触发换代"',async()=>{const {r,c,a}=await setup();await r.start();const old=r.current;r.current.cards=['old'];c.change('K2',true);expect(r.current).not.toBe(old);expect(r.current.catalog).toHaveLength(0);expect(r.current.cards).toBeUndefined();await r.syncCatalog();expect(a.requests.at(-1)?.headers.authorization).toBe('Bearer K2')})
test('spec Scenario "未收到事件时新操作发现 key 变化"',async()=>{const {r,c}=await setup();await r.start();const old=r.current;c.change('K2');const op=await r.beginOperation();expect(op.gen).not.toBe(old);expect(op.key).toBe('K2');expect(old.bgAbort.signal.aborted).toBe(true);op.release()})
