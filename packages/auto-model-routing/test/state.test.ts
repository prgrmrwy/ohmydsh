import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
it('disk_store_restores_state_without_task_text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-router-'))
  const id = '../../not-a-path'
  const first = new RoutingState(new FileStateStore(directory))
  first.setMode(id, 'AUTO')
  first.setMode(id, 'MANUAL')
  const second = new RoutingState(new FileStateStore(directory))
  expect(second.read(id)).toEqual(first.read(id))
  const files = readdirSync(directory)
  expect(files).toHaveLength(1)
  expect(files[0]).not.toContain('..')
  expect(readFileSync(join(directory, files[0]!), 'utf8')).not.toContain('task')
  expect(second.read('other')).toEqual({ mode: 'MANUAL' })
})
it('disk_state_rejects_malformed_shape',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-invalid-'))
 const store=new FileStateStore(directory)
 store.set('S',{mode:'MANUAL'})
 const file=join(directory,readdirSync(directory)[0]!)
 writeFileSync(file,JSON.stringify({mode:'SOMETIMES'}))
 expect(()=>store.get('S')).toThrow()
})
it('repeated_mode_is_noop', () => {
  const { state, writes } = fixture()
  state.setMode('S', 'MANUAL')
  expect(writes()).toBe(0)
  state.setMode('S', 'AUTO')
  state.setMode('S', 'MANUAL')
  const after = writes()
  state.setMode('S', 'MANUAL')
  expect(writes()).toBe(after)
  expect(state.read('S')).toEqual({ mode: 'MANUAL' })
})
it('disable_persists_and_auto_clears',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-disabled-'))
 const state=new RoutingState(new FileStateStore(directory))
 state.setMode('S','AUTO')
 state.disable('S','insufficient-credits',1000)
 const reloaded=new RoutingState(new FileStateStore(directory)).read('S')
 expect(reloaded).toEqual({mode:'MANUAL',disabled:{category:'insufficient-credits',at:1000}})
 state.setMode('S','MANUAL')
 expect(state.read('S').disabled?.category).toBe('insufficient-credits')
 state.setMode('S','AUTO')
 expect(state.read('S').disabled).toBeUndefined()
})
it('legacy_state_file_is_readable',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-legacy-'))
 const store=new FileStateStore(directory)
 store.set('S',{mode:'AUTO'})
 const file=join(directory,readdirSync(directory)[0]!)
 writeFileSync(file,JSON.stringify({mode:'MANUAL',restore:true,anchor:{provider:'claude',model:'claude-opus-5-5',reasoningEffort:'medium',provenance:'user-selected'},disabled:{category:'timeout',at:7}}))
 expect(store.get('S')).toEqual({mode:'MANUAL',disabled:{category:'timeout',at:7}})
 const state=new RoutingState(store)
 state.setMode('S','AUTO')
 expect(JSON.parse(readFileSync(file,'utf8'))).toEqual({mode:'AUTO'})
 writeFileSync(file,JSON.stringify({mode:'MANUAL',disabled:{category:'whatever',at:1}}))
 expect(()=>store.get('S')).toThrow()
})
it('previous_tier_persists_and_survives_mode_changes',()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-previous-'))
 const state=new RoutingState(new FileStateStore(directory))
 state.setMode('S','AUTO')
 state.remember('S','complex')
 state.setMode('S','MANUAL'); state.setMode('S','AUTO')
 state.disable('S','timeout',1)
 expect(new RoutingState(new FileStateStore(directory)).read('S')).toEqual({mode:'MANUAL',previous:'complex',disabled:{category:'timeout',at:1}})
 state.setMode('S','AUTO')
 expect(state.read('S')).toEqual({mode:'AUTO',previous:'complex'})
 const file=join(directory,readdirSync(directory)[0]!)
 writeFileSync(file,JSON.stringify({mode:'AUTO',previous:'huge'}))
 expect(()=>new FileStateStore(directory).get('S')).toThrow()
})
