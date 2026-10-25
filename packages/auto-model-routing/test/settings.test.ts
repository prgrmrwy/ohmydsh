import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_SETTINGS, explicitChildRoute, explicitMainEffort, SettingsStore, SettingsValidationError } from '../src/settings.js'
import type { RoutingCatalog } from '../src/settings-contract.js'
const catalog: RoutingCatalog = { models: [{provider:'claude',model:'opus',name:'Opus',reasoningEfforts:['low','medium','high','xhigh']},{provider:'codex',model:'sol',name:'Sol',reasoningEfforts:['low','medium','high','xhigh']}], childAllowlist:{status:'enabled',allowedModels:[{provider:'codex',model:'sol'}]} }
function fixture() { const dir=mkdtempSync(join(tmpdir(),'routing-settings-')); const path=join(dir,'config.json'); return {dir,path,store:new SettingsStore(path)} }
it('AUTO defaults to the new policy without writing files and retains explicit legacy rollback',()=>{
 const {path,store}=fixture()
 expect(store.read().settings.policy).toBe('policy-v2')
 writeFileSync(path,JSON.stringify({defaultMode:'AUTO',childRoutes:{codex:{simple:{model:'sol',reasoningEffort:'low'}}}}))
 expect(store.read().settings).toMatchObject({policy:'policy-v2',defaultMode:'AUTO',childRoutes:{codex:{simple:{model:'sol'}}}})
 expect(JSON.parse(readFileSync(path,'utf8'))).not.toHaveProperty('policy')
 writeFileSync(path,'{}')
 store.save({policy:'policy-v2'},catalog)
 store.save({decisionToast:false},catalog)
 expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({policy:'policy-v2',decisionToast:false})
 expect(()=>store.save({policy:'unknown'},catalog)).toThrow()
 store.save({policy:'legacy'},catalog)
 expect(store.read().settings.policy).toBe('legacy')
})
it('defaults missing or corrupt files and independently defaults invalid ordinary fields',()=>{
 const {path,store}=fixture()
 expect(store.read()).toMatchObject({status:'missing',settings:DEFAULT_SETTINGS})
 writeFileSync(path,'{bad')
 expect(store.read()).toMatchObject({status:'invalid',settings:DEFAULT_SETTINGS})
 writeFileSync(path,JSON.stringify({effortCap:'max',jevTimeoutMs:2000,decisionToast:false}))
 expect(store.read().settings).toMatchObject({effortCap:'xhigh',jevTimeoutMs:2000,decisionToast:false})
 expect(store.read().issues[0]?.path).toBe('effortCap')
})
it('merges ordinary settings without materializing defaults and writes owner-only atomically',()=>{
 const {path,dir,store}=fixture(); writeFileSync(path,'{"decisionToast":false}')
 store.save({defaultMode:'AUTO',jevTimeoutMs:2500},catalog)
 expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({decisionToast:false,defaultMode:'AUTO',jevTimeoutMs:2500})
 expect(statSync(path).mode & 0o777).toBe(0o600)
 expect(statSync(dir).mode & 0o777).toBe(0o700)
 expect(readdirSync(dir)).toEqual(['config.json'])
})
it.each([{jevTimeoutMs:6000},{jevTimeoutMs:1000.5},{effortCap:'max'},{defaultMode:'auto'},{foo:1},{apiKey:'do-not-copy'},{mainEfforts:{claude:{'../bad':{simple:'low'}}}},{mainEfforts:{claude:{'opus\n':{simple:'low'}}}},{childRoutes:{codex:{simple:{model:'sol'}}}},{childRoutes:{codex:{simple:{model:'sol',reasoningEffort:'low',token:'secret'}}}}])('rejects invalid patch without changing bytes: %j',patch=>{
 const {path,store}=fixture(); writeFileSync(path,'{"decisionToast":false}')
 expect(()=>store.save(patch,catalog)).toThrow(SettingsValidationError)
 expect(readFileSync(path,'utf8')).toBe('{"decisionToast":false}')
})
it('stores sparse complete routes, removes a cell to restore default, and prunes empty maps',()=>{
 const {path,store}=fixture()
 store.save({mainEfforts:{claude:{complex:'high',simple:'medium'}},childRoutes:{codex:{complex:{model:'sol',reasoningEffort:'high'}}}},catalog)
 store.save({mainEfforts:{claude:{simple:null}}},catalog)
 expect(store.read().settings.mainEfforts).toEqual({claude:{complex:'high'}})
 store.save({mainEfforts:{claude:{complex:null}},childRoutes:{codex:{complex:null}}},catalog)
 expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({})
})
it('preserves recognizable malformed explicit values rather than falling back and permits unrelated saves',()=>{
 const {path,store}=fixture(); writeFileSync(path,JSON.stringify({mainEfforts:{claude:{simple:'max'}},childRoutes:{codex:{simple:{model:'sol'}}}}))
 const read=store.read(catalog)
 expect(read.settings.mainEfforts?.claude?.simple).toBe('max')
 expect(read.issues.map(i=>i.path)).toContain('mainEfforts.claude.simple')
 store.save({decisionToast:false},catalog)
 expect(JSON.parse(readFileSync(path,'utf8')).childRoutes.codex.simple).toEqual({model:'sol'})
 expect(()=>store.save({mainEfforts:{claude:{simple:'max'}}},catalog)).toThrow(SettingsValidationError)
})
it('checks all cap conflicts and accepts simultaneous explicit repairs',()=>{
 const {path,store}=fixture()
 store.save({mainEfforts:{claude:{complex:'high'}},childRoutes:{codex:{complex:{model:'sol',reasoningEffort:'high'}}}},catalog)
 const before=readFileSync(path,'utf8')
 try {store.save({effortCap:'medium'},catalog); throw Error('expected rejection')} catch(error) {expect((error as SettingsValidationError).issues.map(i=>i.path)).toEqual(['mainEfforts.claude.complex','childRoutes.codex.complex'])}
 expect(readFileSync(path,'utf8')).toBe(before)
 store.save({effortCap:'medium',mainEfforts:{claude:{complex:'medium'}},childRoutes:{codex:{complex:{model:'sol',reasoningEffort:'medium'}}}},catalog)
 expect(store.read().settings.effortCap).toBe('medium')
})
it('rejects malformed exact cells and ancestors instead of resolving defaults',()=>{
 const {path,store}=fixture()
 for (const mainEfforts of [false,{claude:false},{claude:{opus:false}},{claude:{simple:'max'}}]) {
  writeFileSync(path,JSON.stringify({mainEfforts}))
  expect(()=>explicitMainEffort(store.read().settings,'claude','opus','simple',catalog)).toThrow(SettingsValidationError)
 }
 writeFileSync(path,JSON.stringify({childRoutes:{codex:{simple:{model:'sol'}}}}))
 expect(()=>explicitChildRoute(store.read().settings,'codex','simple',catalog)).toThrow(SettingsValidationError)
 expect(explicitChildRoute(store.read().settings,'codex','complex',catalog)).toBeUndefined()
})
it('rejects prototype-looking family/tier keys without pollution',()=>{
 const {path,store}=fixture(); writeFileSync(path,'{}')
 for (const mainEfforts of [JSON.parse('{"__proto__":{"simple":"low"}}'),JSON.parse('{"claude":{"__proto__":"low"}}')]) {
  expect(()=>store.save({mainEfforts},catalog)).toThrow(SettingsValidationError)
  expect(readFileSync(path,'utf8')).toBe('{}')
 }
 expect(({} as Record<string,unknown>).simple).toBeUndefined()
})
it('empty patches preserve malformed roots and explicit edits cannot erase them',()=>{
 const {path,store}=fixture()
 for (const mainEfforts of [false,null]) {
  writeFileSync(path,JSON.stringify({mainEfforts}))
  for (const patch of [{mainEfforts:{}},{mainEfforts:{claude:{}}}]) {
   store.save(patch,catalog)
   expect(JSON.parse(readFileSync(path,'utf8')).mainEfforts).toEqual(mainEfforts)
  }
  const before=readFileSync(path,'utf8')
  expect(()=>store.save({mainEfforts:{claude:{simple:null}}},catalog)).toThrow(SettingsValidationError)
  expect(readFileSync(path,'utf8')).toBe(before)
 }
})
it('legacy families remain diagnostic until explicit family replacement or reset',()=>{
 const {path,store}=fixture()
 for (const family of [false,{opus:{simple:'low',complex:'high'}},{simple:{complex:'high'}},{__invalid:'high'}]) {
  writeFileSync(path,JSON.stringify({mainEfforts:{claude:family}}))
  expect(store.read(catalog).status).toBe('invalid')
  expect(()=>explicitMainEffort(store.read().settings,'claude','opus','complex',catalog)).toThrow(SettingsValidationError)
  store.save({decisionToast:false,mainEfforts:{claude:{}}},catalog)
  expect(JSON.parse(readFileSync(path,'utf8')).mainEfforts.claude).toEqual(family)
  store.save({mainEfforts:{claude:{simple:'medium'}}},catalog)
  expect(store.read().settings.mainEfforts).toEqual({claude:{simple:'medium'}})
  store.save({mainEfforts:{claude:null}},catalog)
  expect(store.read().settings.mainEfforts).toBeUndefined()
 }
})
it('validates explicit effort against every current family model, not child allowlist',()=>{
 const {path,store}=fixture(); writeFileSync(path,'{}')
 const current:RoutingCatalog={...catalog,models:[...catalog.models,{provider:'claude',model:'limited',name:'Limited',reasoningEfforts:['medium']}]}
 expect(()=>store.save({mainEfforts:{claude:{simple:'low'}}},current)).toThrow(SettingsValidationError)
 expect(readFileSync(path,'utf8')).toBe('{}')
 store.save({mainEfforts:{claude:{simple:'medium'}}},current)
 expect(explicitMainEffort(store.read().settings,'claude','opus','simple',current)).toBe('medium')
 expect(()=>store.save({mainEfforts:{codex:{simple:'low'}}},{...catalog,models:[]})).toThrow(SettingsValidationError)
})
it('cap reduction cannot hide identifiable conflicts inside legacy maps',()=>{
 const {path,store}=fixture(); writeFileSync(path,JSON.stringify({mainEfforts:{claude:{opus:{complex:'high'}}}}))
 expect(()=>store.save({effortCap:'medium'},catalog)).toThrow(SettingsValidationError)
 store.save({mainEfforts:{claude:null},effortCap:'medium'},catalog)
 expect(store.read().settings.mainEfforts).toBeUndefined()
})
it('empty child patches preserve malformed roots and reject partial edits through them',()=>{
 const {path,store}=fixture()
 for (const childRoutes of [false,null,{codex:false}]) {
  writeFileSync(path,JSON.stringify({childRoutes}))
  store.save({childRoutes:{codex:{}}},catalog)
  expect(JSON.parse(readFileSync(path,'utf8')).childRoutes).toEqual(childRoutes)
  const before=readFileSync(path,'utf8')
  expect(()=>store.save({childRoutes:{codex:{simple:{model:'sol',reasoningEffort:'low'}}}},catalog)).toThrow(SettingsValidationError)
  expect(readFileSync(path,'utf8')).toBe(before)
 }
})
it('cap reduction also catches identifiable effort conflicts in malformed historic child cells',()=>{
 const {path,store}=fixture()
 writeFileSync(path,JSON.stringify({childRoutes:{codex:{complex:{reasoningEffort:'high'}}}}))
 const before=readFileSync(path,'utf8')
 expect(()=>store.save({effortCap:'medium'},catalog)).toThrow(SettingsValidationError)
 expect(readFileSync(path,'utf8')).toBe(before)
})
it('uses the fresh supplied catalog and preserves untouched unavailable routes',()=>{
 const {store}=fixture(); store.save({childRoutes:{codex:{simple:{model:'sol',reasoningEffort:'low'}}}},catalog)
 const unavailable:RoutingCatalog={...catalog,childAllowlist:{status:'unavailable',allowedModels:[]}}
 expect(()=>store.save({decisionToast:false},unavailable)).not.toThrow()
 expect(()=>store.save({decisionToast:true,childRoutes:{codex:{simple:{model:'sol',reasoningEffort:'low'}}}},unavailable)).not.toThrow()
 expect(()=>store.save({childRoutes:{codex:{simple:{model:'sol',reasoningEffort:'medium'}}}},unavailable)).toThrow(SettingsValidationError)
 expect(store.read(unavailable).issues.some(i=>i.code==='allowlist-unavailable')).toBe(true)
})
