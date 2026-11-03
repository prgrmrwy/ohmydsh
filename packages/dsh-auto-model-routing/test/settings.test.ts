import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_SETTINGS, SettingsStore, SettingsValidationError } from '../src/settings.js'
import { closeHarness, depth, harness } from './host-harness.js'
function fixture() { const dir=mkdtempSync(join(tmpdir(),'routing-settings-')); const path=join(dir,'config.json'); return {dir,path,store:new SettingsStore(path)} }
it('spec Scenario "设置文件损坏"',()=>{
 const {path,store}=fixture()
 expect(store.read()).toMatchObject({status:'missing',settings:DEFAULT_SETTINGS})
 writeFileSync(path,'{bad')
 expect(store.read()).toMatchObject({status:'invalid',settings:DEFAULT_SETTINGS})
 writeFileSync(path,JSON.stringify({effortCap:'max',jevTimeoutMs:2000,decisionToast:false}))
 expect(store.read().settings).toMatchObject({effortCap:'xhigh',jevTimeoutMs:2000,decisionToast:false})
 expect(store.read().issues[0]?.path).toBe('effortCap')
})
it('spec Scenario "保存普通设置"',()=>{
 const {path,dir,store}=fixture(); writeFileSync(path,'{"decisionToast":false}')
 store.save({defaultMode:'AUTO',jevTimeoutMs:2500})
 expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({decisionToast:false,defaultMode:'AUTO',jevTimeoutMs:2500})
 expect(statSync(path).mode & 0o777).toBe(0o600)
 expect(statSync(dir).mode & 0o777).toBe(0o700)
 expect(readdirSync(dir)).toEqual(['config.json'])
 // The next read (what the next request or new session uses) reflects the saved values without a restart.
 expect(store.read().settings).toMatchObject({defaultMode:'AUTO',jevTimeoutMs:2500,decisionToast:false})
})
it.each([{jevTimeoutMs:9000},{jevTimeoutMs:999},{jevTimeoutMs:1000.5},{effortCap:'max'},{defaultMode:'auto'},{foo:1},{apiKey:'do-not-copy'},{mainEfforts:{}}])('spec Scenario "非法设置整体拒绝": %j',patch=>{
 const {path,store}=fixture(); writeFileSync(path,'{"decisionToast":false}')
 expect(()=>store.save(patch)).toThrow(SettingsValidationError)
 expect(readFileSync(path,'utf8')).toBe('{"decisionToast":false}')
})
it('spec Scenario "提交旧映射字段被拒"',()=>{
 const {path,store}=fixture(); writeFileSync(path,'{"defaultMode":"AUTO"}')
 for (const patch of [{policy:'legacy'},{mainEfforts:{claude:{simple:'low'}}},{childRoutes:{}}]) {
  let error: unknown
  try { store.save(patch) } catch (e) { error = e }
  expect(error,JSON.stringify(patch)).toBeInstanceOf(SettingsValidationError)
  expect((error as SettingsValidationError).issues.map(i=>i.path)).toContain(Object.keys(patch)[0])
  expect(readFileSync(path,'utf8')).toBe('{"defaultMode":"AUTO"}')
 }
})
it('spec Scenario "旧映射配置不影响路由并在保存时移除"', async () => {
 const config = { policy: 'legacy', decisionToast: true, mainEfforts: { codex: { simple: 'medium' } }, childRoutes: { claude: { simple: { model: 'claude-haiku-5-5', reasoningEffort: 'high' } } } }
 const h = await harness(depth('baseline'), { config })
 try {
  await h.setMode('AUTO'); await h.run('main request')
  expect(h.calls.at(-1)).toMatchObject({ model: 'claude-opus-5-5', reasoningEffort: 'medium' })
  const read = await h.invoke('settings', {})
  expect(read.configStatus).toBe('ok')
  expect(read.deprecated).toEqual(['childRoutes', 'mainEfforts', 'policy'])
  await h.invoke('saveSettings', { decisionToast: false })
  expect(JSON.parse(readFileSync(join(h.home, 'plugins/dsh-auto-model-routing/config.json'), 'utf8'))).toEqual({ decisionToast: false })
  expect((await h.invoke('settings', {})).deprecated).toEqual([])
 } finally { await closeHarness() }
})
it('Jev deadline defaults to 5000 ms and accepts up to 8000 ms',()=>{
 const {path,store}=fixture()
 expect(DEFAULT_SETTINGS.jevTimeoutMs).toBe(5000)
 expect(store.read().settings.jevTimeoutMs).toBe(5000)
 store.save({jevTimeoutMs:8000})
 expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({jevTimeoutMs:8000})
 writeFileSync(path,JSON.stringify({jevTimeoutMs:8001}))
 expect(store.read().settings.jevTimeoutMs).toBe(5000)
})
