import { afterEach, expect, it } from 'vitest'
import { routeSubagentTool } from '../src/subagent-tool.js'
import { JevClient } from '../src/jev.js'
import { RoutingState, type SessionState } from '../src/state.js'
import { fakeJev, json, tier, type Reply } from './fake-jev.js'

const env = { get: (name: string) => name === 'OPENROUTER_API_KEY' ? { value: 'sk-or-test' } : undefined }
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })
async function tool(reply: Reply) {
 const server = await fakeJev(reply); close = server.close
 return { server, def: routeSubagentTool(new JevClient(env, server.base, 300)) }
}
const exec = (signal = new AbortController().signal) => ({ signal }) as never

it('tool_returns_table_entry', async () => {
 const { def } = await tool(tier('complex'))
 expect(def.name).toBe('route_subagent')
 expect(def.description).toMatch(/OpenRouter/)
 expect(await def.execute({ task: '排查多个模块', provider: 'claude' }, exec())).toEqual({ tier: 'complex', provider: 'claude', model: 'claude-opus-5-5', reasoning_effort: 'xhigh' })
 expect(await def.execute({ task: '排查多个模块', provider: 'codex' }, exec())).toEqual({ tier: 'complex', provider: 'codex', model: 'gpt-6.1-sol', reasoning_effort: 'xhigh' })
})

it('tool_failure_reports_without_state_change', async () => {
 const disk = new Map<string, SessionState>()
 const state = new RoutingState({ get: id => disk.get(id), set: (id, v) => { disk.set(id, v) } })
 state.setMode('S1', 'AUTO')
 const before = structuredClone(disk.get('S1'))
 const { def } = await tool(json(402, {}))
 await expect(def.execute({ task: 'x', provider: 'claude' }, exec())).rejects.toThrow(/余额不足.*暂停委派并询问用户/)
 expect(disk.get('S1')).toEqual(before)
 const controller = new AbortController(); controller.abort()
 const held = await tool(() => {})
 const error = await held.def.execute({ task: 'x', provider: 'claude' }, exec(controller.signal)).catch((e: Error) => e)
 expect(String(error)).toMatch(/已取消/)
 expect(String(error)).not.toMatch(/余额|凭据|OPENROUTER/)
})
