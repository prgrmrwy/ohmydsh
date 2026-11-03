import { afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

it('spec Scenario "步骤被拒时不请求 Jev"', async () => {
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

it('spec Scenario "等待期间切换模式丢弃结果"', async () => {
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

it('spec Scenario "停用后不再调用 Jev 且不改写"', async () => {
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
it('spec Scenario "用户重新点 AUTO 清除停用"', async () => {
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

it('spec Scenario "用户取消不是失败"', async () => {
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

it('spec Scenario "凭据与响应体不泄漏"', async () => {
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

it('failure produces no new decision and the switch only gates the hint (host)', async () => {
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


it('spec Scenario "凭据从存储读取且换 key 立即生效"', async () => {
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
it('spec Scenario "旧绑定的 label 响应不暴露历史版本键"', async () => {
 const h = await harness(depth('baseline'), { answer: () => 'reply' })
 await h.setMode('AUTO'); await h.run('first')
 const m0 = lastAssistantId(h)
 const ledger = join(h.home, 'state/auto-model-routing/allocation-feedback.jsonl')
 // Replace the ledger with an upgrade-time history for m0: old snapshot, "appropriate", version:1 exposure.
 const old = { sessionId: h.agent.id, messageId: m0, decisionId: 77, depth: 'baseline', model: 'claude-opus-5-5', effort: 'medium', snapshot: { decidedAt: 1, appliedAt: 2, policyVersion: 'policy-v2-d774ffe6', mappingVersion: 'capability-slots-2-magpie', decisionProvider: 'openrouter', decisionModel: 'typesafe/jev-1.13', ms: 5, provider: 'test', requestSeq: 3 }, boundAt: 4 }
 const bindingLine = JSON.stringify(old)
 writeFileSync(ledger, [bindingLine, JSON.stringify({ type: 'feedback', version: 2, sessionId: h.agent.id, messageId: m0, decisionId: 77, at: 5, feedback: 'appropriate' }), JSON.stringify({ type: 'fact', version: 1, sessionId: h.agent.id, decisionId: 77, fact: 'exposed', at: 6 })].join('\n') + '\n')
 await h.restart()
 const keys = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keys) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]) : []
 const responses = [
  await h.invoke('label', { sessionId: h.agent.id, messageId: m0 }),
  await h.invoke('label', { sessionId: h.agent.id, messageId: m0, feedback: 'too-high' }),
  await h.invoke('label', { sessionId: h.agent.id, messageId: m0, feedback: null }),
 ]
 expect(responses[0]).toMatchObject({ depth: 'baseline', feedback: 'appropriate', snapshot: { decisionProvider: 'openrouter', requestSeq: 3 } })
 expect(responses[1]).toMatchObject({ feedback: 'too-high' })
 expect(responses[2]).toMatchObject({ feedback: null })
 for (const r of responses) for (const key of ['policy', 'policyVersion', 'mappingVersion', 'version', 'strategy']) expect(keys(r), key).not.toContain(key)
 const rows = readFileSync(ledger, 'utf8').trim().split('\n')
 expect(rows[0]).toBe(bindingLine)
 const added = rows.slice(3).map(l => JSON.parse(l))
 expect(added.map(r => r.type)).toEqual(['feedback', 'feedback'])
 for (const r of added) expect(r).not.toHaveProperty('version')
 const { FeedbackBook } = await import('../src/feedback.js')
 expect(new FeedbackBook(ledger).facts(h.agent.id, 77)).toEqual({ exposed: 6 })
 expect(new FeedbackBook(ledger).lookup(h.agent.id, m0)!.snapshot).toMatchObject({ policyVersion: 'policy-v2-d774ffe6' })
 // The report groups linked calls; this harness writes no session log, so check the grouping input it uses.
 expect(new FeedbackBook(ledger).entries().find(b => b.messageId === m0)!.snapshot).toMatchObject({ policyVersion: 'policy-v2-d774ffe6', mappingVersion: 'capability-slots-2-magpie' })
})
it('spec Scenario "MANUAL 请求原样通过"', async () => {
 const h = await harness(depth('higher'))
 await h.run('manual')
 expect(h.calls.at(-1)).toMatchObject({ provider: 'test', model: 'claude-opus-5-5', reasoningEffort: 'medium' })
 expect(h.jev.bodies).toHaveLength(0)
})
it('spec Scenario "AUTO 只改 effort"', async () => {
 const h = await harness(depth('higher'))
 await h.setMode('AUTO'); await h.run('排查多个模块')
 expect(h.calls.at(-1)).toMatchObject({ provider: 'test', model: 'claude-opus-5-5', reasoningEffort: 'high' })
})
it('spec Scenario "同回合与重试复用决定"', async () => {
 let tools = 4
 const h = await harness(depth('higher'), { toolCalls: () => tools-- })
 await h.setMode('AUTO'); await h.run('排查多个模块')
 expect(h.calls).toHaveLength(5)
 expect(h.calls.map(c => c.reasoningEffort)).toEqual(['high', 'high', 'high', 'high', 'high'])
 expect(h.jev.bodies).toHaveLength(1)
})
it('spec Scenario "非用户回合沿用上一 depth"', async () => {
 const h = await harness(depth('higher'))
 await h.setMode('AUTO'); await h.run('排查多个模块')
 // The official selection now carries high; let the next assembly start from medium again.
 h.selection.current = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }
 h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '子会话完成' }], source: { kind: 'plugin' } as never })); await h.agent.whenIdle()
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 expect(h.jev.bodies).toHaveLength(1)
})
it('spec Scenario "请求内容受限"', async () => {
 const replies = ['我先看了登录代码。要我开始实施吗？', '好的']
 const h = await harness(depth('baseline'), { answer: () => replies.shift() ?? '' })
 await h.setMode('AUTO')
 await h.run('修一下登录')
 await h.run('继续')
 const body = h.jev.bodies[1] as { model: string; state: string; questions: Record<string, unknown> }
 expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
 expect(body.model).toBe('typesafe/jev-1.13')
 const rubric = (await import('../src/rubric.json', { with: { type: 'json' } })).default as Record<string, unknown>
 expect(body.questions).toEqual({ depth: rubric.depth })
 expect(body.state.split('\n')[0]).toBe('Previous user-turn tier: none')
 const at = (needle: string) => body.state.indexOf(needle)
 expect(at('修一下登录')).toBeGreaterThan(0)
 expect(at('要我开始实施吗？')).toBeGreaterThan(at('修一下登录'))
 expect(body.state.endsWith('New user message:\n继续')).toBe(true)
 expect(body.state).not.toContain(h.agent.id)
 expect(h.jev.headers[1]!.authorization).toBe(`Bearer ${SECRET}`)
 h.jev.set(json(500, {}))
 const sent = h.jev.bodies.length
 await h.setMode('AUTO'); await h.run('再来')
 expect(h.jev.bodies).toHaveLength(sent + 1)
})
it('spec Scenario "首个用户回合不带上一轮上下文"', async () => {
 const h = await harness(depth('baseline'))
 await h.setMode('AUTO'); await h.run('看下这个报错')
 expect((h.jev.bodies[0] as { state: string }).state).toBe('Previous user-turn tier: none\nUser message:\n看下这个报错')
})
it('spec Scenario "快速切回 AUTO 不恢复旧决定"', async () => {
 let tools = 0
 const h = await harness(depth('higher'), { toolCalls: () => tools-- })
 await h.setMode('AUTO'); await h.run('first')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 // Mid-turn: the first request asks for a tool; flip MANUAL→AUTO before the second request of the same turn.
 tools = 1
 h.ctx.on('tools/execute', async (_exec, next) => { await h.setMode('MANUAL'); await h.setMode('AUTO'); h.selection.current = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }; return next() })
 await h.run('second')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 const judged = h.jev.bodies.length
 tools = 0
 await h.run('third')
 expect(h.jev.bodies).toHaveLength(judged + 1)
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
})
it('spec Scenario "新会话按默认模式创建"', async () => {
 const h = await harness(depth('lower'), { defaultAuto: true })
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ mode: 'AUTO' })
 await h.run('one')
 expect(h.jev.bodies).toHaveLength(1)
 await closeHarness()
 const unsupported = await harness(depth('lower'), { defaultAuto: true, model: 'deepseek-v4.1-flash' })
 expect(await unsupported.invoke('state', { sessionId: unsupported.agent.id })).toMatchObject({ mode: 'MANUAL' })
 const child = await unsupported.ctx.agents.create({ sessionId: SessionId(`child-${Math.random()}`), meta: { origin: 'subagent' }, agentOptions: { provider: 'test', model: 'claude-opus-5-5' } })
 // S2 (unsupported default model) and C1 (a child) produce no state file at all.
 try { expect(existsSync(join(unsupported.home, 'state/auto-model-routing/sessions'))).toBe(false) } finally { await child.dispose() }
 await closeHarness()
 // S0: an existing session with no recorded mode is announced as resumed (not freshly created): it stays MANUAL.
 const resumed = await harness(depth('lower'), { defaultAuto: true, seed: [] })
 await resumed.ctx.serial('agent/created', { agent: resumed.agent, source: 'resume' })
 expect(await resumed.invoke('state', { sessionId: resumed.agent.id })).toMatchObject({ mode: 'MANUAL' })
 await resumed.run('one')
 expect(resumed.jev.bodies).toHaveLength(0)
})
it('spec Scenario "修改默认模式不影响已有会话"', async () => {
 const h = await harness(depth('lower'), { defaultAuto: true })
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ mode: 'AUTO' })
 await h.setMode('MANUAL')
 await h.invoke('saveSettings', { defaultMode: 'MANUAL' }); await h.invoke('saveSettings', { defaultMode: 'AUTO' })
 await h.restart()
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ mode: 'MANUAL' })
 const s2 = await h.ctx.agents.create({ sessionId: SessionId(`s2-${Math.random()}`), agentOptions: { provider: 'test', model: 'claude-opus-5-5' } })
 try {
  const { FileStateStore } = await import('../src/state.js')
  expect(new FileStateStore(join(h.home, 'state/auto-model-routing/sessions')).get(s2.agent.id)).toMatchObject({ mode: 'AUTO' })
 } finally { await s2.dispose() }
})
it('spec Scenario "各状态码映射为闭集类别"', async () => {
 const cases: [Parameters<typeof harness>[0] | 'no-key', string][] = [
  [json(402, {}), 'insufficient-credits'], [json(401, {}), 'unauthorized'], [json(403, {}), 'unauthorized'], [json(429, {}), 'rate-limited'],
  [json(451, {}), 'region-blocked'], [json(404, {}), 'rejected'], [json(500, {}), 'unavailable'], [(req) => { req.socket.destroy() }, 'unavailable'],
  [() => { /* never */ }, 'timeout'], [(_req, res) => { res.writeHead(200); res.end('not json') }, 'invalid-response'], [depth('huge'), 'invalid-response'],
  [json(200, { error: { code: 402 } }), 'insufficient-credits'], ['no-key', 'missing-credential'],
 ]
 for (const [reply, category] of cases) {
  const h = await harness(reply === 'no-key' ? depth('higher') : reply, reply === 'no-key' ? { storedKey: '' } : {})
  await h.setMode('AUTO'); await h.run('任务')
  expect((await h.invoke('state', { sessionId: h.agent.id })).disabled?.category, category).toBe(category)
  if (reply === 'no-key') expect(h.jev.bodies).toHaveLength(0)
  await closeHarness()
 }
}, 60_000)
it('spec Scenario "主会话判断提示"', async () => {
 const h = await harness(depth('higher', { confidence: 0.4 }))
 h.toast(true)
 await h.setMode('AUTO'); await h.run('排查多个模块')
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state).toMatchObject({ decisionToast: true, decision: { source: 'main', depth: 'higher', effort: 'high', status: 'applied', confidence: 0.4, decisionProvider: 'openrouter', decisionModel: 'typesafe/jev-1.13', provider: 'test', model: 'claude-opus-5-5' } })
 const { toastText } = await import('../src/client/control.js')
 const lines = toastText(state.decision)
 expect(lines[0]).toBe('主会话 · 已应用')
 expect(lines).toContain('投入 higher · 判定确定度 40%')
 expect(lines).toContain('test / claude-opus-5-5 · high')
 expect(lines.some((l: string) => /^openrouter \/ typesafe\/jev-1\.13 · \d+\.\d{2}s$/.test(l))).toBe(true)
})
