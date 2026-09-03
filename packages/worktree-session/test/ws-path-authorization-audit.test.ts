import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { authorizeExplicitPath } from '../src/host/tool.js'

/**
 * Audit coverage against the REAL approval service, not a double: the
 * ask/decided pair, its turn-enclosure rule and the fail-closed default are
 * that service's contract, so proving this seam routes through it correctly is
 * what genuinely verifies the audit requirement. The service is served through
 * `ctx.get('approval')`, the reflection-safe cordis read used by the official
 * `ask` policy.
 */
const { default: ApprovalService } = await import('@deepseek-ai/dsh-user-approval')

/** Minimal session double exposing the append-only log the service reads. */
function sessionWithOpenTurn() {
  const events: { type: string; data?: unknown }[] = [{ type: 'turn/start' }]
  return {
    events,
    append(type: string, data: unknown) { events.push({ type, data }) },
  }
}

/**
 * Build the real service on a real Context, with one composed answerer
 * supplying the outcome. Composing an answerer (rather than stubbing the
 * service) keeps the audit path genuine.
 */
function serviceWith(outcome: string): InstanceType<typeof ApprovalService> {
  const ctx = new Context()
  const service = new ApprovalService(ctx, {})
  ctx.on('approval/request' as never, (async () => outcome) as never)
  return service
}

/** Context double serving the real service through the reflection-safe read. */
function ctxServing(service: InstanceType<typeof ApprovalService>) {
  return { get: (name: string) => (name === 'approval' ? service : undefined) }
}

describe('explicit-path authorization is audited on the calling session', () => {
  // 4.2 The ask and its outcome must appear as a pair, carrying the tool, the
  // call and a reason naming the exact path.
  it('logs approval/asked and approval/decided with the exact path', async () => {
    const session = sessionWithOpenTurn()
    const service = serviceWith('allowed-once')
    const agent = { session }
    const exec = { agent, callId: 'call-audit' }

    const authorized = await authorizeExplicitPath(
      ctxServing(service),
      exec,
      { action: 'clean', path: '/repo/main' },
    )

    expect(authorized).toBe('/repo/main')
    const asked = session.events.find(event => event.type === 'approval/asked')
    const decided = session.events.find(event => event.type === 'approval/decided')
    expect(asked).toBeDefined()
    expect(decided).toBeDefined()
    const askedData = asked!.data as { id: string; toolName: string; callId?: string; reason?: string }
    const decidedData = decided!.data as { id: string; outcome: string }
    expect(askedData.toolName).toBe('ws')
    expect(askedData.callId).toBe('call-audit')
    expect(askedData.reason).toContain('/repo/main')
    expect(askedData.reason).toContain('clean')
    // The pair is correlated by a single request id.
    expect(decidedData.id).toBe(askedData.id)
    expect(decidedData.outcome).toBe('allowed-once')
  })

  // A refusal is audited exactly the same way — the path is never adopted
  // without a logged decision.
  it('logs the pair for a refusal and refuses the path', async () => {
    const session = sessionWithOpenTurn()
    const service = serviceWith('rejected')
    const exec = { agent: { session }, callId: 'call-audit-refused' }

    await expect(authorizeExplicitPath(
      ctxServing(service),
      exec,
      { action: 'clean', path: '/repo/main' },
    )).rejects.toThrow(/not authorized by the user/)

    expect(session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    const decided = session.events.find(event => event.type === 'approval/decided')
    expect((decided!.data as { outcome: string }).outcome).toBe('rejected')
  })

  // An ask outside an open turn throws inside the service; the seam must treat
  // that as a refusal rather than letting the path through unaudited.
  it('refuses when the ask cannot be audited (no open turn)', async () => {
    const session = { events: [] as { type: string; data?: unknown }[], append() { /* never reached */ } }
    const service = serviceWith('allowed-once')
    const exec = { agent: { session }, callId: 'call-audit-no-turn' }

    await expect(authorizeExplicitPath(
      ctxServing(service),
      exec,
      { action: 'clean', path: '/repo/main' },
    )).rejects.toThrow(/not authorized by the user/)
    expect(session.events).toEqual([])
  })
})