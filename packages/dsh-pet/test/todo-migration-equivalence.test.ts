/**
 * `pet-locus-intent-triage` → "迁移前后待办行为等价" (equivalence-01..04).
 *
 * One script, run twice: once on the REAL legacy `TodoBackend` (Pet Domain
 * store), once on the REAL collab `TodoBackend` (real dsh-collab plugin and
 * collab-kernel with a temp-dir file store). Both runs share one fake clock
 * (`Date` is faked, so Pet's `now` and the kernel's commit `at` read the same
 * time) and one recording dispatch port shape.
 *
 * Compared, byte for byte after normalizing ONLY item ids:
 *  - what `pet_locus_track` / `pet_locus_request_execution` return to the
 *    model, executed through the real ToolRuntime;
 *  - the follow-up body the Host composes;
 *  - accept receipts (outcome and execution target);
 *  - the owner management view (`projectTodoForOwner`).
 * Evidence text and times are never normalized.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { legacyTodoBackend, type TodoBackend } from '../src/host/ledger/backend.js'
import { SharedFactLedgerStore } from '../src/host/ledger/store.js'
import { acceptTodo, requestTodoExecution, type AcceptTodoDeps } from '../src/host/ledger/dispatch.js'
import { projectTodoForOwner } from '../src/host/ledger/owner-view.js'
import { PET_LOCUS_REQUEST_EXECUTION_TOOL, PET_LOCUS_TRACK_TOOL, registerPetTools } from '../src/host/tools.js'
import type { ProxyLocusRecord } from '../src/host/collab/proxy.js'
import { authorizedFor, openTodoWorld, type TodoWorld } from './support/collab-todo.js'
import { openPetHarness, type PetHarness } from './harness.js'

const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
  createScope(ctx: Context, key: unknown): { ctx: Context }
}

const MAIN = 'session-main-equivalence'
const LOCI: readonly ProxyLocusRecord[] = [
  { id: 'rec-eq-a', generation: 2, endpoint: { chatId: 'oc-eq-a' }, parentSessionId: MAIN, childSessionId: 'child-eq-a', state: 'active' },
  { id: 'rec-eq-b', generation: 1, endpoint: { chatId: 'oc-eq-b', threadId: 'omt-eq-b' }, parentSessionId: MAIN, childSessionId: 'child-eq-b', state: 'active' },
]
const recordOfChild = (child: string) => LOCI.find(record => record.childSessionId === child)!
const recordOfLocus = (locusId: string) => LOCI.find(record => record.id === locusId)

type Kind = 'legacy' | 'collab'

/** Recording dispatch port; the target's liveness is scripted per step. */
function recordingPort() {
  const calls: { kind: string; sessionId: string; text?: string }[] = []
  let status: 'idle' | 'running' | 'archived' = 'idle'
  return {
    calls,
    setStatus(next: typeof status) { status = next },
    resolve(sessionId: string) {
      calls.push({ kind: 'resolve', sessionId })
      return status === 'archived' ? undefined : { status }
    },
    async resume(sessionId: string) {
      calls.push({ kind: 'resume', sessionId })
      throw new Error('session is archived')
    },
    followup(sessionId: string, text: string) { calls.push({ kind: 'followup', sessionId, text }) },
  }
}

interface Run {
  readonly backend: TodoBackend
  readonly port: ReturnType<typeof recordingPort>
  /** Execute a real Pet tool as a child through the real ToolRuntime; returns the model-visible text. */
  tool(child: string, name: string, args: Record<string, unknown>): Promise<string>
  acceptDeps(advance?: AcceptTodoDeps['advanceStatus']): AcceptTodoDeps
  close(): Promise<void>
}

let open: Run[] = []
afterEach(async () => {
  for (const run of open.splice(0)) await run.close()
  vi.useRealTimers()
})

async function openRun(kind: Kind): Promise<Run> {
  const harness: PetHarness = await openPetHarness()
  let world: TodoWorld | undefined
  let backend: TodoBackend
  if (kind === 'legacy') {
    backend = legacyTodoBackend(new SharedFactLedgerStore(harness.domain))
  } else {
    world = await openTodoWorld()
    for (const record of LOCI) world.addLocus(record)
    await world.loadMain(MAIN)
    backend = world.backend
  }
  const port = recordingPort()
  let seq = 0
  const acceptDeps = (advance?: AcceptTodoDeps['advanceStatus']): AcceptTodoDeps => ({
    readTodo: id => backend.getTodoItem(id),
    registrarFor: todo => ({ childCanExecute: false, childSessionId: recordOfLocus(todo.locusId)?.childSessionId ?? '' }),
    contextFor: () => ({ mainWasBriefedStandby: true }),
    port,
    advanceStatus: advance ?? ((id, to) => backend.advanceStatus(id, to, Date.now())),
    log: () => {},
  })

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const intentTriage = {
    loci: { findByChildSessionId: () => [] },
    currentCapability: (child: string) => ({
      deliveryId: `delivery-om-${recordOfChild(child).id}`, executionId: 'exec', turnId: `${child}#1`, source: 'delivery' as const,
    }),
    authorizeCurrentDelivery: async ({ childSessionId }: { childSessionId: string }) => authorizedFor(recordOfChild(childSessionId)),
    track: { store: backend, now: () => Date.now(), newItemId: () => `todo-${++seq}` },
    requestExecution: async (input: { itemId: string; callerChildSessionId: string }) => {
      const result = await requestTodoExecution(input, {
        ...acceptDeps(),
        lookupRegistrarChild: todo => recordOfLocus(todo.locusId)?.childSessionId ?? '',
      })
      return result.ok ? { ok: true as const, outcome: result.outcome } : { ok: false as const, reason: result.reason }
    },
  }
  const keys = new Map(LOCI.map(record => [record.childSessionId!, { id: record.childSessionId }]))
  for (const record of LOCI) {
    const scope = createScope(ctx, keys.get(record.childSessionId!))
    await new Promise<void>((resolve, reject) => {
      scope.ctx.inject(['tools'], toolCtx => {
        try { registerPetTools(toolCtx, { repository: harness.repository, intentTriage: intentTriage as never }); resolve() } catch (error) { reject(error) }
      })
    })
  }
  const run: Run = {
    backend, port, acceptDeps,
    async tool(child, name, args) {
      const result = await ctx.tools.execute({
        agent: keys.get(child) as never, name, callId: `${name}-${child}` as never, arguments: args, signal: new AbortController().signal,
      }) as unknown as { content?: readonly { text?: string }[]; isError?: boolean }
      return `${result.isError === true ? 'ERROR ' : ''}${(result.content ?? []).map(part => part.text ?? '').join('\n')}`
    },
    async close() {
      await ctx.fiber.dispose()
      await world?.world.stop()
      await harness.close()
    },
  }
  open.push(run)
  return run
}

/** Replace each distinct `todo-<n>` item id with its first-seen ordinal. Nothing else is touched. */
function normalizeItemIds(value: unknown): string {
  const seen = new Map<string, string>()
  return JSON.stringify(value, null, 2).replace(/todo-\d+/g, id => {
    if (!seen.has(id)) seen.set(id, `item#${seen.size + 1}`)
    return seen.get(id)!
  })
}

/** Run one script on both backends under one fake clock; returns both normalized transcripts. */
async function both(script: (run: Run, tick: () => void) => Promise<unknown>) {
  const out: Record<Kind, string> = { legacy: '', collab: '' }
  for (const kind of ['legacy', 'collab'] as const) {
    vi.useFakeTimers({ toFake: ['Date'] })
    let clock = 1_700_000_000_000
    vi.setSystemTime(clock)
    const tick = () => { clock += 1_000; vi.setSystemTime(clock) }
    const run = await openRun(kind)
    out[kind] = normalizeItemIds(await script(run, tick))
    vi.useRealTimers()
  }
  return out
}

const view = async (run: Run) => (await run.backend.listForParent(MAIN)).map(projectTodoForOwner)
const followups = (run: Run) => run.port.calls.filter(call => call.kind === 'followup')
const receipt = (result: Awaited<ReturnType<typeof acceptTodo>>) => ({
  ok: result.ok,
  ...(result.ok ? { record: projectTodoForOwner(result.record) } : { reason: result.reason }),
  dispatch: result.dispatch === undefined ? undefined : { outcome: result.dispatch.outcome, reason: result.dispatch.reason, executionTarget: result.dispatch.executionTarget },
})

describe('迁移前后待办行为等价', () => {
  it('equivalence-01：同一流程在新旧存储上输出一致', async () => {
    const { legacy, collab } = await both(async (run, tick) => {
      const steps: unknown[] = []
      steps.push({ trackA: await run.tool('child-eq-a', PET_LOCUS_TRACK_TOOL, { summary: '按钮点击无反应', detail: '定位到 handler 未绑定' }) })
      tick()
      steps.push({ trackB: await run.tool('child-eq-b', PET_LOCUS_TRACK_TOOL, { summary: '导出 CSV 乱码', detail: '编码应为 UTF-8 BOM' }) })
      tick()
      steps.push({ trackA2: await run.tool('child-eq-a', PET_LOCUS_TRACK_TOOL, { summary: '另一个问题', detail: '日志在 a.log' }) })
      tick()
      // Owner accepts T1 while the target is idle.
      run.port.setStatus('idle')
      steps.push({ acceptT1: receipt(await acceptTodo('todo-1', run.acceptDeps())) })
      tick()
      // A asks for its other todo to be executed while the target is busy.
      run.port.setStatus('running')
      steps.push({ requestA2: await run.tool('child-eq-a', PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: 'todo-3' }) })
      tick()
      // Owner drops T2.
      steps.push({ dropT2: projectTodoForOwner(await run.backend.advanceStatus('todo-2', 'dropped', Date.now())) })
      steps.push({ followups: followups(run), view: await view(run) })
      return steps
    })
    expect(collab).toBe(legacy)
  })

  it('equivalence-02：证据边界值在新旧存储上逐字段一致', async () => {
    const cases = [
      { summary: '长'.repeat(300), detail: 'd' },
      { summary: '第一行\n第二行', detail: '' },
      { summary: '引号与反斜杠', detail: '行一\n行二 "引号" \'单引\' \\反斜杠\\ \t制表' },
      { summary: '详情为空', detail: '' },
      { summary: 's'.repeat(512), detail: '恰好 512' },
    ]
    const { legacy, collab } = await both(async (run, tick) => {
      const texts: string[] = []
      for (const evidence of cases) {
        texts.push(await run.tool('child-eq-a', PET_LOCUS_TRACK_TOOL, evidence))
        tick()
      }
      run.port.setStatus('idle')
      const accepted = receipt(await acceptTodo('todo-3', run.acceptDeps()))
      return { texts, accepted, followups: followups(run), view: await view(run) }
    })
    expect(collab).toBe(legacy)
  })

  it('equivalence-03：并发受理在新旧存储上一致', async () => {
    const { legacy, collab } = await both(async (run, tick) => {
      await run.tool('child-eq-a', PET_LOCUS_TRACK_TOOL, { summary: '并发受理', detail: '' })
      tick()
      run.port.setStatus('idle')
      // Both accepts pass the open gate and dispatch; only then do they write.
      let arrived = 0
      let release!: () => void
      const bothDispatched = new Promise<void>(resolve => { release = resolve })
      const advance: AcceptTodoDeps['advanceStatus'] = async (id, to) => {
        arrived += 1
        if (arrived === 2) release()
        await bothDispatched
        return run.backend.advanceStatus(id, to, Date.now())
      }
      const results = await Promise.all([
        acceptTodo('todo-1', run.acceptDeps(advance)),
        acceptTodo('todo-1', run.acceptDeps(advance)),
      ])
      const receipts = results.map(receipt).sort((a, b) => Number(b.ok) - Number(a.ok))
      return { receipts, dispatched: followups(run).length, view: await view(run) }
    })
    expect(collab).toBe(legacy)
    // And the expected shape, not merely "the same": exactly one wins.
    const parsed = JSON.parse(legacy) as { receipts: { ok: boolean; reason?: string }[]; dispatched: number; view: { status: string }[] }
    expect(parsed.receipts.map(r => r.ok)).toEqual([true, false])
    expect(parsed.receipts[1]!.reason).toBe('跟进任务已投递，但状态写入失败；该待办仍显示为待处理。')
    expect(parsed.dispatched).toBe(2)
    expect(parsed.view[0]!.status).toBe('accepted')
  })

  it('equivalence-04：失败路径在新旧存储上一致', async () => {
    // Migration-era note: the guidance sentence in these failure texts read
    // `pet_locus_ledger_read` before this change and was rewritten to
    // `collab_read` per design D6. Both backends share `dispatch.ts`, so here
    // the two runs are byte-identical — stricter than the one textual
    // difference the spec allows.
    const { legacy, collab } = await both(async (run, tick) => {
      await run.tool('child-eq-a', PET_LOCUS_TRACK_TOOL, { summary: '主会话已归档', detail: '' })
      tick()
      await run.tool('child-eq-b', PET_LOCUS_TRACK_TOOL, { summary: '已受理过', detail: '' })
      tick()
      run.port.setStatus('idle')
      expect((await acceptTodo('todo-2', run.acceptDeps())).ok).toBe(true)
      tick()
      const before = { calls: run.port.calls.length, view: await view(run) }
      // The owning main session is archived: it cannot be resumed.
      run.port.setStatus('archived')
      const archived = receipt(await acceptTodo('todo-1', run.acceptDeps()))
      const already = receipt(await acceptTodo('todo-2', run.acceptDeps()))
      const childArchived = await run.tool('child-eq-a', PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: 'todo-1' })
      const childAlready = await run.tool('child-eq-b', PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: 'todo-2' })
      const childUnknown = await run.tool('child-eq-a', PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: 'todo-99' })
      const childForeign = await run.tool('child-eq-a', PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: 'todo-2' })
      const after = await view(run)
      return {
        archived, already, childArchived, childAlready, childUnknown, childForeign, view: after,
        statusesUnchanged: JSON.stringify(after) === JSON.stringify(before.view),
        noNewFollowup: run.port.calls.slice(before.calls).every(call => call.kind !== 'followup'),
      }
    })
    expect(collab).toBe(legacy)
    const parsed = JSON.parse(legacy) as { statusesUnchanged: boolean; noNewFollowup: boolean; archived: { ok: boolean }; already: { ok: boolean } }
    expect(parsed).toMatchObject({ statusesUnchanged: true, noNewFollowup: true, archived: { ok: false }, already: { ok: false } })
  })
})
