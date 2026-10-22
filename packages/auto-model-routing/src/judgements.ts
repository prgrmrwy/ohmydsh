import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Effort, Tier } from './effort.js'

/** A judged user turn as kept in memory for the reply button (no text, no context). */
export interface TurnRecord { turn: number; tier: Tier; effort?: Effort; label?: Tier }
export type JudgementLine = { sessionId: string; turn: number; tier: Tier; effort?: Effort; model: string; rubricVersion: string }
export type LabelLine = { sessionId: string; turn: number; label: Tier }

/**
 * Append-only `judgements.jsonl` plus the in-memory `messageId → turn` map (design D13).
 * Appends throw; callers decide whether a failure matters (judgement lines: log only; labels: 5xx).
 */
export class JudgementBook {
  private readonly turns = new Map<string, Map<number, TurnRecord>>()
  private readonly messages = new Map<string, Map<string, number>>()
  private readonly latestUserTurn = new Map<string, number>()
  constructor(private readonly file: string) {}

  append(line: JudgementLine | LabelLine): void {
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 })
  }

  judged(line: JudgementLine): void {
    this.turnsOf(line.sessionId).set(line.turn, { turn: line.turn, tier: line.tier, ...(line.effort ? { effort: line.effort } : {}) })
  }

  /** A user turn began (judged or not): later continued turns attach to it. */
  userTurn(sessionId: string, turn: number): void { this.latestUserTurn.set(sessionId, turn) }

  /** An assistant message: a continued turn's reply belongs to the latest user turn; mapped only when that turn was judged. */
  assistant(sessionId: string, messageId: string, turn: number): void {
    const latest = this.latestUserTurn.get(sessionId)
    if (latest === undefined || turn < latest || !this.turns.get(sessionId)?.has(latest)) return
    let map = this.messages.get(sessionId)
    if (!map) { map = new Map(); this.messages.set(sessionId, map) }
    map.set(messageId, latest)
  }

  lookup(sessionId: string, messageId: string): TurnRecord | undefined {
    const turn = this.messages.get(sessionId)?.get(messageId)
    const record = turn === undefined ? undefined : this.turns.get(sessionId)?.get(turn)
    return record && { ...record }
  }

  label(sessionId: string, turn: number, label: Tier): void {
    this.append({ sessionId, turn, label })
    const record = this.turns.get(sessionId)?.get(turn)
    if (record) record.label = label
  }

  private turnsOf(sessionId: string): Map<number, TurnRecord> {
    let map = this.turns.get(sessionId)
    if (!map) { map = new Map(); this.turns.set(sessionId, map) }
    return map
  }
}
