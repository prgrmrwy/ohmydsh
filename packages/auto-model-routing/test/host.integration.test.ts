import { afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { json } from './fake-jev.js'
import { closeHarness, depth, harness, lastAssistantId, SECRET } from './host-harness.js'
let cleanup: (() => Promise<void>) | undefined = closeHarness
afterEach(async () => { await closeHarness() })

it('spec Scenario "手动及新回合隔离"',async()=>{
 const h=await harness(json(200,{answers:{depth:{choice:'baseline'}}}),{answer:()=> 'synthetic reply'})
  await h.setMode('AUTO');await h.run('first user task')
 const ids=()=>h.agent.session.snapshotEvents().filter(e=>e.type==='assistant/message').map(e=>(e.data as any).message.id)
 const first=ids().at(-1)!
 expect(await h.invoke('label',{sessionId:h.agent.id,messageId:first})).toMatchObject({depth:'baseline',effort:'medium',snapshot:{decisionProvider:'openrouter',provider:'test',requestSeq:expect.any(Number),decidedAt:expect.any(Number),appliedAt:expect.any(Number)}})
 await h.invoke('label',{sessionId:h.agent.id,messageId:first,feedback:'too-high'})
 await h.restart();expect(await h.invoke('label',{sessionId:h.agent.id,messageId:first})).toMatchObject({feedback:'too-high'})
 await h.setMode('MANUAL');await h.run('manual task')
 expect(await h.invoke('label',{sessionId:h.agent.id,messageId:ids().at(-1)!})).toEqual({})
})
it('records a mid-turn MANUAL switch without recording failed or unbound switches',async()=>{
 const h=await harness(json(200,{answers:{depth:{choice:'baseline'}}}),{answer:()=> 'reply'})
 await h.setMode('AUTO')
 h.ctx.on('session/event',(session,event)=>{
  if(session.id===h.agent.id&&event.type==='request/header')void h.setMode('MANUAL')
 })
 await h.run('task')
 const rows=readFileSync(join(h.home,'state/auto-model-routing/allocation-feedback.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l))
 expect(rows.filter(r=>r.type==='fact')).toEqual([expect.objectContaining({fact:'manual-switch'})])
 await h.invoke('setMode',{sessionId:'missing',mode:'MANUAL'})
 expect(readFileSync(join(h.home,'state/auto-model-routing/allocation-feedback.jsonl'),'utf8').trim().split('\n')).toHaveLength(rows.length)
})
it('MANUAL facts follow the current decision and failed switches write nothing',async()=>{
 const h=await harness(json(200,{answers:{depth:{choice:'baseline'}}}),{answer:()=> 'reply'})
 await h.setMode('AUTO');await h.run('first')
 const first=await h.invoke('label',{sessionId:h.agent.id,messageId:lastAssistantId(h)})
 h.jev.set(json(200,{answers:{depth:{choice:'higher'}}}));await h.run('second')
 const second=await h.invoke('label',{sessionId:h.agent.id,messageId:lastAssistantId(h)})
 await h.invoke('setMode',{sessionId:h.agent.id,mode:'invalid'})
 const facts=()=>readFileSync(join(h.home,'state/auto-model-routing/allocation-feedback.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>r.type==='fact')
 expect(facts()).toEqual([])
 await h.setMode('MANUAL')
 expect(facts()).toEqual([expect.objectContaining({decisionId:second.decisionId,fact:'manual-switch'})])
 expect(facts()[0].decisionId).not.toBe(first.decisionId)
})
it('records MANUAL switches before invalidate clears the applied decision',async()=>{
 const h=await harness(json(200,{answers:{depth:{choice:'baseline'}}}),{answer:()=> 'reply'})
 await h.setMode('AUTO');await h.run('task')
 const view=await h.invoke('label',{sessionId:h.agent.id,messageId:lastAssistantId(h)})
 await h.setMode('MANUAL');await h.setMode('MANUAL')
 const rows=readFileSync(join(h.home,'state/auto-model-routing/allocation-feedback.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l))
 expect(rows.filter(r=>r.type==='fact')).toEqual([expect.objectContaining({decisionId:view.decisionId,fact:'manual-switch'})])
 await h.run('manual task');expect(await h.invoke('observe',{sessionId:h.agent.id,messageId:lastAssistantId(h)})).toEqual({})
})
it('unchanged requests bind the new main decision to the effective header', async () => {
 const h=await harness(json(200,{answers:{depth:{choice:'baseline'}}}),{answer:()=> 'reply'})
 await h.setMode('AUTO');await h.run('first')
 const headers=()=>h.agent.session.snapshotEvents().filter(e=>e.type==='request/header')
 const firstHeader=headers().at(-1)!
 const firstId=lastAssistantId(h)
 const first=await h.invoke('label',{sessionId:h.agent.id,messageId:firstId})
 await h.run('second')
 expect(headers()).toHaveLength(1)
 const second=await h.invoke('label',{sessionId:h.agent.id,messageId:lastAssistantId(h)})
 expect(second).toMatchObject({snapshot:{requestSeq:firstHeader.seq,requestTurn:2}})
 expect(second.decisionId).not.toBe(first.decisionId)
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({decision:{status:'applied'}})
})
it('a request changed after routing never binds the recommended decision', async () => {
 const h=await harness(json(200,{answers:{depth:{choice:'baseline'}}}),{answer:()=> 'reply'})
 await h.setMode('AUTO');await h.run('first')
 h.ctx.on('agent/request',async (_payload,next)=>({...await next(),reasoningEffort:ReasoningEffortId('high')}),{prepend:true})
 await h.run('second')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 expect(await h.invoke('label',{sessionId:h.agent.id,messageId:lastAssistantId(h)})).toEqual({})
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({decision:{status:'failed'}})
})
it('mode roundtrip invalidates existing and pending decisions', async () => {
 const h=await harness(json(200,{answers:{depth:{choice:'higher'}}}))
  await h.setMode('AUTO');await h.run('initial task')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 await h.setMode('MANUAL');await h.setMode('AUTO')
 expect(await h.invoke('state',{sessionId:h.agent.id})).not.toHaveProperty('depth')
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 h.jev.set((_req,res)=>{void gate.then(()=>{res.writeHead(402);res.end('{}')})})
 const running=h.run('pending task')
 await expect.poll(()=>h.jev.bodies.length).toBe(2)
 await h.setMode('MANUAL');await h.setMode('AUTO');release();await running
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({mode:'AUTO'})
 expect(await h.invoke('state',{sessionId:h.agent.id})).not.toHaveProperty('disabled')
})
it('host_routes_and_rpc_envelope', async () => {
 const h = await harness(depth('lower'))
 const rpc = await h.invoke('state', { type: 'client-request', rpcId: 'probe-1', method: 'auto-model-routing.state', payload: { sessionId: h.agent.id } })
 expect(rpc).toMatchObject({ type: 'server-response', rpcId: 'probe-1', result: { ok: true } })
})

it('rejected_step_skips_jev', async () => {
 let reject = true
 const h = await harness(depth('higher'), { reject: () => reject })
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.jev.bodies).toHaveLength(0)
 reject = false
 await h.run('排查多个模块')
 expect(h.jev.bodies).toHaveLength(1)
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
})

it('mode_change_during_jev_discards_result', async () => {
 for (const answer of [depth('higher'), json(402, {})]) {
  let release!: () => void
  const gate = new Promise<void>(done => { release = done })
  const h = await harness((req, res, body) => { void gate.then(() => answer(req, res, body)) })
  await h.setMode('AUTO')
  const running = h.run('排查多个模块')
  await expect.poll(() => h.jev.bodies.length).toBe(1)
  await h.setMode('MANUAL')
  release()
  await running
  expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
  const state = await h.invoke('state', { sessionId: h.agent.id })
  expect(state.mode).toBe('MANUAL')
  expect(state.disabled).toBeUndefined()
  await cleanup?.(); cleanup = undefined
 }
})

it('failure_disables_without_rewrite', async () => {
 const h = await harness(depth('higher'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 h.jev.set(json(402, {}))
 await h.run('下一个任务')
 // No rewrite after the failure: the request carries whatever the official selection assembled.
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state).toMatchObject({ mode: 'MANUAL', disabled: { category: 'insufficient-credits' } })
 expect(state).not.toHaveProperty('restore')
 const sent = h.jev.bodies.length
 await h.run('再下一个')
 expect(h.jev.bodies.length).toBe(sent)
 expect((await h.invoke('state', { sessionId: h.agent.id })).disabled?.category).toBe('insufficient-credits')
})
it('auto_clears_disabled', async () => {
 const h = await harness(json(504, {}))
 await h.setMode('AUTO')
 await h.run('任务')
 expect((await h.invoke('state', { sessionId: h.agent.id })).disabled?.category).toBe('unavailable')
 await h.run('完成复原')
 h.jev.set(depth('lower'))
 await h.setMode('AUTO')
 expect((await h.invoke('state', { sessionId: h.agent.id })).disabled).toBeUndefined()
 await h.run('小改动')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('low')
})

it('cancel_is_not_failure', async () => {
 const h = await harness(() => { /* hold */ })
 await h.setMode('AUTO')
 const running = h.run('排查多个模块')
 await expect.poll(() => h.jev.bodies.length).toBe(1)
 h.agent.cancel({ kind: 'user' })
 await running
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state.mode).toBe('AUTO')
 expect(state.disabled).toBeUndefined()
 h.jev.set(depth('baseline'))
 await h.run('再试')
 expect(h.jev.bodies).toHaveLength(2)
})

it('no_secret_or_body_leak', async () => {
 const h = await harness(json(401, { error: { message: 'SECRET-BODY' } }))
 await h.setMode('AUTO')
 await h.run('任务')
 const text = JSON.stringify(await h.invoke('state', { sessionId: h.agent.id }))
 const dir = join(h.home, 'state/auto-model-routing/sessions')
 const disk = readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
 for (const blob of [text, disk]) { expect(blob).not.toContain(SECRET); expect(blob).not.toContain('SECRET-BODY') }
 expect(text).toContain('unauthorized')
})

it('toast_switch_default_on_only_false_is_off', async () => {
 const h = await harness(depth('higher', { confidence: 0.9 }))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 // Missing file: on by default.
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ decisionToast: true, decision: { source: 'main', confidence: 0.9 } })
 const dir = join(h.home, 'plugins/dsh-auto-model-routing'); mkdirSync(dir, { recursive: true })
 for (const body of ['{not json', JSON.stringify({ decisionToast: 'no' }), JSON.stringify(null), '{}']) {
  writeFileSync(join(dir, 'config.json'), body)
  expect((await h.invoke('state', { sessionId: h.agent.id })).decisionToast).toBe(true)
 }
 h.toast(false)
 expect(await h.invoke('state', { sessionId: h.agent.id })).not.toHaveProperty('decisionToast')
})

it('spec Scenario "开关关闭或判断失败不提示" (host)', async () => {
 const h = await harness(depth('higher', { confidence: 0.9 }))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 // Switch off: the latest decision is still returned (for the hover panel) but no hint is requested.
 h.toast(false)
 const off = await h.invoke('state', { sessionId: h.agent.id })
 expect(off.decision).toMatchObject({ source: 'main', depth: 'higher' })
 expect(off).not.toHaveProperty('decisionToast')
 h.toast(true)
 expect((await h.invoke('state', { sessionId: h.agent.id })).decisionToast).toBe(true)
 const before = (await h.invoke('state', { sessionId: h.agent.id })).decision.id
 h.jev.set(json(402, {}))
 await h.run('下一个任务')
 // A failed judgment produces no new decision (the session is now MANUAL and shows none).
 const after = await h.invoke('state', { sessionId: h.agent.id })
 expect(after.decision?.id ?? before).toBe(before)
 expect(after).toMatchObject({ mode: 'MANUAL', disabled: { category: 'insufficient-credits' } })
})

it('auto_syncs_official_selection', async () => {
 const h = await harness(depth('higher'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 expect(h.selections).toEqual([{ sessionId: h.agent.id, provider: 'test', model: 'claude-opus-5-5', reasoningEffort: 'high' }])
 // The same value is not pushed again; the official selection now carries it.
 h.selection.current = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('high') }
 await h.run('继续排查')
 expect(h.selections).toHaveLength(1)
 // MANUAL never writes the selection.
 await h.setMode('MANUAL'); await h.run('再继续')
 expect(h.selections).toHaveLength(1)
})


it('credential_store_rotation_and_deletion_apply_without_restart', async () => {
 const h = await harness(depth('lower'), { storedKey: 'key-A' })
 await h.setMode('AUTO'); await h.run('one')
 expect(h.jev.headers.at(-1)?.authorization).toBe('Bearer key-A')
 const result = await h.invoke('setKey', { value:'key-B' })
 expect(JSON.stringify(result)).not.toContain('key-B')
 await h.run('two')
 expect(h.jev.headers.at(-1)?.authorization).toBe('Bearer key-B')
 await h.invoke('setKey', { value:null }); await h.run('three')
 expect(h.jev.bodies).toHaveLength(2)
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({mode:'MANUAL',disabled:{category:'missing-credential'}})
})

it('new_session_default_auto_does_not_reapply_after_plugin_restart', async () => {
 const h = await harness(depth('lower'), { defaultAuto:true })
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({mode:'AUTO'})
 await h.run('one')
 expect(h.jev.bodies).toHaveLength(1)
 await h.setMode('MANUAL'); await h.restart()
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({mode:'MANUAL'})
})

it('empty_seed_is_not_a_fresh_auto_session', async () => {
 const h = await harness(depth('lower'), { defaultAuto:true, seed:[] })
 expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({mode:'MANUAL'})
 await h.run('one')
 expect(h.jev.bodies).toHaveLength(0)
})

it('default_auto_ignores_resume_clear_compact_and_subagents', async () => {
 const h = await harness(depth('lower'), { defaultAuto:true })
 await h.setMode('MANUAL')
 for (const source of ['resume','clear','compact'] as const) {
  await h.ctx.serial('agent/created', { agent:h.agent, source })
  expect(await h.invoke('state',{sessionId:h.agent.id})).toMatchObject({mode:'MANUAL'})
 }
 const child=await h.ctx.agents.create({sessionId:SessionId(`child-${Math.random()}`),meta:{origin:'subagent'},agentOptions:{provider:'test',model:'claude-opus-5-5'}})
 try {
  const stateFiles=join(h.home,'state/auto-model-routing/sessions')
  expect(readdirSync(stateFiles)).toHaveLength(1)
 } finally { await child.dispose() }
})
it('spec Scenario "旧判档账本不再增长且标注参数被拒"', async () => {
 const h = await harness(depth('baseline'), { answer: () => 'reply' })
 const ledger = join(h.home, 'state/auto-model-routing/judgements.jsonl')
 mkdirSync(join(h.home, 'state/auto-model-routing'), { recursive: true })
 const old = ['{"sessionId":"a","turn":1,"tier":"simple","model":"m","rubricVersion":"x"}', '{"sessionId":"a","turn":1,"label":"standard"}', '{"sessionId":"b","turn":2,"tier":"complex","model":"m","rubricVersion":"x"}'].join('\n') + '\n'
 writeFileSync(ledger, old)
 await h.setMode('AUTO'); await h.run('first'); await h.run('second')
 const m1 = lastAssistantId(h)
 const feedback = join(h.home, 'state/auto-model-routing/allocation-feedback.jsonl')
 const feedbackBefore = readFileSync(feedback, 'utf8')
 expect(readFileSync(ledger, 'utf8')).toBe(old)
 const response = await h.routes.get('/api/auto-model-routing.label')!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ sessionId: h.agent.id, messageId: m1, label: 'simple' }) }))
 expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500)
 expect(readFileSync(ledger, 'utf8')).toBe(old)
 expect(readFileSync(feedback, 'utf8')).toBe(feedbackBefore)
 // An unbound reply is rejected the same way: there is no tier label path any more.
 await h.setMode('MANUAL'); await h.run('manual')
 const unbound = await h.routes.get('/api/auto-model-routing.label')!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ sessionId: h.agent.id, messageId: lastAssistantId(h), label: 'simple' }) }))
 expect(unbound.status).toBe(400)
 expect(readFileSync(ledger, 'utf8')).toBe(old)
})
