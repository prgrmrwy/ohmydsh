import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectionProjection } from '../src/selection-projection.js'
import { FileStateStore } from '../src/state.js'
import { RoutingState, type SessionState, type StateStore } from '../src/state.js'

function fixture() {
  const disk = new Map<string, SessionState>()
  let writes = 0
  const store: StateStore = {
    get: id => { const value = disk.get(id); return value && structuredClone(value) },
    set: (id, value) => { writes++; disk.set(id, structuredClone(value)) },
  }
  return { store, state: new RoutingState(store), writes: () => writes }
}
const pick = { provider: 'codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' } as const
it('latest_historical_pick_survives_request_headers', () => {
 const event={type:'model/selection',data:pick} as never
 let state=selectionProjection.apply(null,event)
 expect(state).toEqual(pick)
 state=selectionProjection.apply(state,{type:'request/header',data:{header:{config:{...pick,reasoningEffort:'xhigh'}}}} as never)
 expect(state).toEqual(pick)
})
it('initialize_anchor_once', () => {
  const { state } = fixture()
  expect(state.read('S').mode).toBe('MANUAL')
  expect(state.initialize('S', pick).anchor).toEqual({ ...pick, provenance: 'initialized' })
  expect(state.initialize('S', { ...pick, reasoningEffort: 'max' }).anchor?.reasoningEffort).toBe('medium')
})
it('selection_updates_anchor', () => {
  const { state } = fixture()
  state.initialize('S', pick)
  const newPick = { provider: 'codex', model: 'gpt-6-astra', reasoningEffort: 'low' } as const
  expect(state.select('S', newPick).anchor).toEqual({ ...newPick, provenance: 'user-selected' })
  const { state: restored } = fixture()
  expect(restored.initialize('S', pick, newPick).anchor).toEqual({ ...newPick, provenance: 'user-selected' })
})
it('anchor_survives_restart_without_drift', () => {
  const { state, store } = fixture()
  state.select('S', pick)
  state.setMode('S', 'AUTO')
  for (const reasoningEffort of ['low', 'xhigh', 'high'] as const) state.initialize('S', { ...pick, reasoningEffort })
  state.setMode('S', 'MANUAL')
  const reloaded = new RoutingState(store).read('S')
  expect(reloaded.anchor).toEqual({ ...pick, provenance: 'user-selected' })
  expect(reloaded.restore).toBe(true)
})
it('disk_store_restores_state_without_task_text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-router-'))
  const id = '../../not-a-path'
  const first = new RoutingState(new FileStateStore(directory))
  first.select(id, pick)
  first.setMode(id, 'AUTO')
  first.setMode(id, 'MANUAL')
  const second = new RoutingState(new FileStateStore(directory))
  expect(second.read(id)).toEqual(first.read(id))
  const files = readdirSync(directory)
  expect(files).toHaveLength(1)
  expect(files[0]).not.toContain('..')
  expect(readFileSync(join(directory, files[0]!), 'utf8')).not.toContain('task')
  expect(second.read('other')).toEqual({ mode: 'MANUAL', restore: false })
})
it('disk_state_rejects_malformed_shape',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-invalid-'))
 const store=new FileStateStore(directory)
 store.set('S',{mode:'MANUAL',restore:false})
 const file=join(directory,readdirSync(directory)[0]!)
 writeFileSync(file,JSON.stringify({mode:'AUTO',restore:'false',anchor:{provider:'p'}}))
 expect(()=>store.get('S')).toThrow()
})
it('repeated_mode_is_noop', () => {
  const { state, writes } = fixture()
  state.initialize('S', pick)
  const before = writes()
  state.setMode('S', 'MANUAL')
  expect(writes()).toBe(before)
  expect(state.read('S').restore).toBe(false)
  state.setMode('S', 'AUTO')
  state.setMode('S', 'MANUAL')
  const after = writes()
  state.setMode('S', 'MANUAL')
  expect(writes()).toBe(after)
  state.setMode('S', 'AUTO')
  expect(state.read('S').restore).toBe(true)
})
it('disable_persists_and_auto_clears',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-disabled-'))
 const state=new RoutingState(new FileStateStore(directory))
 state.setMode('S','AUTO')
 state.disable('S','insufficient-credits',1000)
 const reloaded=new RoutingState(new FileStateStore(directory)).read('S')
 expect(reloaded).toMatchObject({mode:'MANUAL',restore:true,disabled:{category:'insufficient-credits',at:1000}})
 state.setMode('S','MANUAL')
 expect(state.read('S').disabled?.category).toBe('insufficient-credits')
 state.setMode('S','AUTO')
 expect(state.read('S').disabled).toBeUndefined()
})
it('disk_state_without_disabled_is_readable_and_bad_category_rejected',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-legacy-'))
 const store=new FileStateStore(directory)
 store.set('S',{mode:'AUTO',restore:false})
 expect(store.get('S')).toEqual({mode:'AUTO',restore:false})
 const file=join(directory,readdirSync(directory)[0]!)
 writeFileSync(file,JSON.stringify({mode:'MANUAL',restore:false,disabled:{category:'whatever',at:1}}))
 expect(()=>store.get('S')).toThrow()
})
