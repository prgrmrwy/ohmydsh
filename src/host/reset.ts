/**
 * Using one Codex rate-limit reset: a manual, irreversible write.
 *
 * The policy is the subscriptions plugin's, kept deliberately close so the two
 * settings pages behave the same: a reset is offered only when the account's
 * weekly window is at least {@link RESET_MIN_WEEKLY_PERCENT} used, only the
 * credit that runs out first is spent, one operation runs at a time, and a
 * submission whose outcome cannot be read locks the account instead of being
 * retried. The browser's guard is only a hint — every check below re-reads the
 * card from the gateway first.
 */
import { randomUUID } from 'node:crypto'
import type { Operation } from './runtime.js'
import type { MagpieRuntime } from './runtime.js'
import type { Card } from '../client/view-model.js'
import type { CardsController, HostCredit } from './cards.js'

/** The weekly window the guard reads; the gateway names Codex windows by their span. */
export const RESET_WEEKLY_WINDOW = '7 days'
/** Same floor as the subscriptions plugin: a reset is wasted on a nearly idle week. */
export const RESET_MIN_WEEKLY_PERCENT = 80
/** How long a prepared confirmation stays usable. */
export const RESET_TICKET_TTL_MS = 60_000
/** Whole gateway budget: the gateway itself may spend 20s and then re-read for 15s. */
export const RESET_TIMEOUT_MS = 45_000

/** Why a card cannot spend a reset right now. */
export type ResetRefusal = 'no-card' | 'error' | 'no-weekly' | 'below-min' | 'window-over' | 'no-credit'
export type ResetPrep = { ok: true; weeklyUsedPercent: number; credit: HostCredit } | { ok: false; reason: ResetRefusal }
/** A decided gateway answer, in the terms the page speaks. */
export type ResetOutcome = 'reset' | 'kept' | 'no-credit' | 'already' | 'unknown'

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const usableAt = (credit: HostCredit, now: number): boolean => {
  if (!credit.id) return false
  if (credit.until === undefined) return true
  const at = Date.parse(credit.until)
  return !Number.isNaN(at) && at > now
}
/** Credits that can still be spent, soonest first; one that never runs out goes last. */
export function usableCredits(credits: readonly HostCredit[], now: number): HostCredit[] {
  const at = (credit: HostCredit) => credit.until === undefined ? Infinity : Date.parse(credit.until)
  return credits.filter(credit => usableAt(credit, now)).sort((a, b) => at(a) - at(b))
}

/** The weekly window of a Codex card, if the gateway reported one. */
export const weeklyWindow = (card: Card | undefined) => card?.windows?.find(window => window.name === RESET_WEEKLY_WINDOW)

/**
 * Is this card allowed to spend one of its credits, and which one? Pure: the
 * caller supplies the freshly read card and the credits the host lifted off it.
 */
export function resetPrep(card: Card | undefined, credits: readonly HostCredit[], now: number): ResetPrep {
  if (!card) return { ok: false, reason: 'no-card' }
  if (card.error) return { ok: false, reason: 'error' }
  const weekly = weeklyWindow(card)
  if (!weekly || typeof weekly.used !== 'number' || !Number.isFinite(weekly.used)) return { ok: false, reason: 'no-weekly' }
  if (weekly.used < RESET_MIN_WEEKLY_PERCENT) return { ok: false, reason: 'below-min' }
  // A window that has already reset tells nothing about the current period.
  const resetsAt = weekly.resetsAt === undefined ? NaN : Date.parse(weekly.resetsAt)
  if (Number.isNaN(resetsAt) || resetsAt <= now) return { ok: false, reason: 'window-over' }
  const usable = usableCredits(credits, now)
  if (!usable.length) return { ok: false, reason: 'no-credit' }
  return { ok: true, weeklyUsedPercent: weekly.used, credit: usable[0]! }
}

/** Map the gateway's `code` to the page's outcome; an unrecognized code is kept verbatim. */
export function resetOutcomeOf(code: string): ResetOutcome {
  if (code === 'reset') return 'reset'
  if (code === 'nothing_to_reset') return 'kept'
  if (code === 'no_credit') return 'no-credit'
  if (code === 'already_redeemed' || code === 'already_used') return 'already'
  return 'unknown'
}

interface Ticket { id: string; user: string; creditId: string; expiresAt: number }
export interface ResetOptions {
  now?: () => number
  /** Deterministic ticket seam for tests. */
  ticketId?: () => string
  timeoutMs?: number
}

const refusalCode = (reason: ResetRefusal): string =>
  reason === 'below-min' ? 'MAGPIE_RESET_GUARD' : reason === 'no-credit' ? 'MAGPIE_RESET_UNAVAILABLE' : 'MAGPIE_RESET_REFRESH'

/**
 * Prepare/consume for one reset. State is process-wide (one ticket, one
 * operation, one lock per account) and is intentionally not persisted: a lock is
 * a warning to check Magpie first, and the gateway refuses a concurrent spend on
 * the same account as its own second line of defence.
 */
export class ResetController {
  private ticket: Ticket | undefined
  private busy = false
  private readonly uncertain = new Set<string>()
  private readonly now: () => number
  private readonly ticketId: () => string
  private readonly timeoutMs: number
  constructor(private readonly runtime: MagpieRuntime, private readonly cards: CardsController, options: ResetOptions = {}) {
    this.now = options.now ?? Date.now
    this.ticketId = options.ticketId ?? randomUUID
    this.timeoutMs = options.timeoutMs ?? RESET_TIMEOUT_MS
  }

  async handle(body: unknown): Promise<Response> {
    if (!isRecord(body)) return invalid('Invalid reset request')
    const keys = Object.keys(body)
    const allowed = body.action === 'prepare' ? ['action', 'provider', 'user'] : body.action === 'consume' ? ['action', 'ticket'] : undefined
    if (!allowed) return invalid('Invalid reset action')
    if (keys.some(key => !allowed.includes(key))) return invalid('Invalid reset request')
    if (body.action === 'prepare') {
      if (body.provider !== 'codex') return invalid('Invalid reset provider')
      if (typeof body.user !== 'string' || body.user === '' || body.user.length > 320) return invalid('Invalid reset user')
      return this.prepare(body.user)
    }
    if (typeof body.ticket !== 'string' || body.ticket === '') return invalid('Invalid reset ticket')
    return this.consume(body.ticket)
  }

  private async prepare(user: string): Promise<Response> {
    if (this.busy) return conflict('MAGPIE_RESET_BUSY')
    if (this.uncertain.has(user.toLowerCase())) return conflict('MAGPIE_RESET_UNCERTAIN')
    this.busy = true
    try {
      const fresh = await this.cards.fresh({ provider: 'codex', user })
      if (!fresh.ok) return this.readFailed(fresh.error)
      const prep = resetPrep(fresh.card, fresh.credits, this.now())
      if (!prep.ok) return conflict(refusalCode(prep.reason))
      // Setting the only slot retires whatever ticket was waiting.
      this.ticket = { id: this.ticketId(), user, creditId: prep.credit.id, expiresAt: this.now() + RESET_TICKET_TTL_MS }
      return Response.json({
        ticket: this.ticket.id, expiresAt: new Date(this.ticket.expiresAt).toISOString(), weeklyUsedPercent: prep.weeklyUsedPercent,
        ...(prep.credit.until === undefined ? {} : { creditExpiresAt: prep.credit.until }),
      })
    } finally { this.busy = false }
  }

  private async consume(id: string): Promise<Response> {
    const pending = this.ticket
    // A presented ticket that is not the waiting one changes nothing: only the real
    // confirmation can consume (or retire) the slot.
    if (!pending || pending.id !== id) return conflict('MAGPIE_RESET_TICKET_INVALID')
    // One use only, whatever the outcome: a retry must start over.
    this.ticket = undefined
    if (pending.expiresAt <= this.now()) return conflict('MAGPIE_RESET_TICKET_EXPIRED')
    if (this.busy) return conflict('MAGPIE_RESET_BUSY')
    const { user } = pending
    const account = user.toLowerCase()
    if (this.uncertain.has(account)) return conflict('MAGPIE_RESET_UNCERTAIN')
    this.busy = true
    try {
      // Everything that can refuse is checked against a card read now, not the one prepare saw.
      const fresh = await this.cards.fresh({ provider: 'codex', user })
      if (!fresh.ok) return this.readFailed(fresh.error)
      const prep = resetPrep(fresh.card, fresh.credits, this.now())
      if (!prep.ok) return conflict(refusalCode(prep.reason))
      if (!usableCredits(fresh.credits, this.now()).some(credit => credit.id === pending.creditId)) return conflict('MAGPIE_RESET_CREDIT_GONE')
      return await this.spend(user, account, pending.creditId)
    } finally { this.busy = false }
  }

  /**
   * Submit the spend. The account is marked uncertain *before* the request: a
   * transport failure, a timeout or an unreadable answer means the credit may
   * already be gone, so nothing may be retried until a human checked Magpie.
   */
  private async spend(user: string, account: string, creditId: string): Promise<Response> {
    let op: Operation
    try { op = await this.runtime.beginOperation() } catch (error) { return this.readFailed(this.runtime.redact(errorMessage(error))) }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    this.uncertain.add(account)
    try {
      let response: Response
      try {
        const path = `/magpie/quotas/codex-reset?user=${encodeURIComponent(user)}&credit=${encodeURIComponent(creditId)}`
        response = await this.runtime.transport.request(op, 'POST', path, { signal: AbortSignal.any([op.gen.bgAbort.signal, controller.signal]) })
      } catch (error) { return this.uncertainReply(this.runtime.redact(errorMessage(error))) }
      // A 4xx is the gateway refusing before it spent anything (missing key rights, a
      // concurrent spend, an ingress that does not route the path): safe to try again.
      if (response.status >= 400 && response.status < 500) {
        const text = this.runtime.formatErrorBody(await response.text())
        this.uncertain.delete(account)
        return Response.json({ outcome: 'unconsumed', error: `HTTP ${response.status}: ${text}` })
      }
      if (!response.ok) return this.uncertainReply(`HTTP ${response.status}`)
      let parsed: unknown
      try { parsed = await response.json() } catch { return this.uncertainReply('MAGPIE_RESET_UNREADABLE') }
      if (!isRecord(parsed) || typeof parsed.code !== 'string') return this.uncertainReply('MAGPIE_RESET_UNREADABLE')
      const code = parsed.code
      const windows = typeof parsed.windows === 'number' ? parsed.windows : undefined
      this.uncertain.delete(account)
      const outcome = resetOutcomeOf(code)
      const base = { outcome, code, ...(windows === undefined ? {} : { windows }) }
      if (outcome !== 'reset') return Response.json(base)
      // The gateway already re-read the account; one refresh puts that reading on the page.
      const refreshed = await this.cards.refresh({ provider: 'codex', user })
      if (!refreshed.ok) return Response.json(base)
      const body = await refreshed.json() as { cards?: Card[] }
      return Response.json(Array.isArray(body.cards) ? { ...base, cards: body.cards } : base)
    } finally { clearTimeout(timer); op.release() }
  }

  private readFailed(error: string) {
    return Response.json({ outcome: 'unconsumed', error: `MAGPIE_RESET_READ_FAILED: ${error}` }, { status: 502 })
  }
  private uncertainReply(error: string) {
    return Response.json({ outcome: 'uncertain', error: `MAGPIE_RESET_UNCERTAIN: ${error}` }, { status: 502 })
  }
}

const invalid = (error: string) => Response.json({ error }, { status: 400 })
const conflict = (error: string) => Response.json({ error }, { status: 409 })
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
